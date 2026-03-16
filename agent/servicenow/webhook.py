"""
FastAPI webhook receiver.
POST /webhook/incident  — accepts a ServiceNow incident payload,
                          runs RCA, writes results back to ServiceNow.
GET  /health            — liveness probe.
"""
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import traceback

from ..agent.rca_agent import RCAAgent
from .client import ServiceNowClient
from .writeback import write_rca_result
from ..config import settings


app = FastAPI(title="IIQ RCA Agent", version="1.0.0")

# These are set at startup from main.py
_rca_agent: Optional[RCAAgent] = None
_snow_client: Optional[ServiceNowClient] = None


def set_dependencies(agent: RCAAgent, snow: ServiceNowClient) -> None:
    global _rca_agent, _snow_client
    _rca_agent = agent
    _snow_client = snow


class IncidentPayload(BaseModel):
    sys_id: str
    number: Optional[str] = None
    caller_id: dict = {}            # {"user_name": "john.doe", ...}
    short_description: str = ""
    description: Optional[str] = ""
    category: Optional[str] = ""
    u_affected_app: Optional[str] = ""  # ServiceNow custom field: affected application
    scenario: Optional[str] = ""        # For testing: pass scenario name to use mock fixtures
    force_confidence: Optional[float] = None  # For testing: override classifier confidence


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "agent": "iiq-rca-agent", "version": "1.0.0"}


@app.post("/webhook/incident")
async def handle_incident(payload: IncidentPayload) -> JSONResponse:
    """
    Webhook endpoint called by ServiceNow (or test harness) when an IAM
    incident is created or assigned to the IAM team.

    Workflow:
    1. Extract caller username + application from payload
    2. Run RCA via the MCP-backed agent
    3. Write results back to ServiceNow
    4. Return the RCA report as JSON
    """
    if _rca_agent is None:
        raise HTTPException(status_code=503, detail="Agent not initialized")

    caller_id = payload.caller_id.get("user_name", "") or payload.caller_id.get("userName", "")
    application = payload.u_affected_app or ""
    incident_id = payload.number or payload.sys_id

    if not caller_id:
        raise HTTPException(status_code=400, detail="caller_id.user_name is required")

    try:
        # Run RCA
        rca_report = await _rca_agent.perform_rca(
            caller_id=caller_id,
            short_description=payload.short_description,
            description=payload.description or "",
            category=payload.category or "",
            application=application,
            scenario=payload.scenario or "",
            force_confidence=payload.force_confidence,
        )

        # Write back to ServiceNow
        try:
            await write_rca_result(_snow_client, payload.sys_id, rca_report)
        except Exception as snow_err:
            # SNOW write-back failure is logged but does not fail the response
            print(f"[webhook] ServiceNow write-back failed: {snow_err}")
            rca_report["snow_writeback_error"] = str(snow_err)

        return JSONResponse(content=rca_report, status_code=200)

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[webhook] RCA failed for incident {incident_id}: {exc}\n{tb}")
        raise HTTPException(status_code=500, detail=f"RCA failed: {str(exc)}")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    print(f"[webhook] Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)},
    )
