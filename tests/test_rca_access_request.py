"""
Integration test: access_request_stuck_approval scenario.
Expected RCA code: APPROVAL_PENDING_MANAGER
"""
import pytest
from .conftest import make_incident_payload


@pytest.mark.asyncio
async def test_access_request_stuck_approval(agent_client):
    """User submitted access request 5 days ago, still pending manager approval."""
    payload = make_incident_payload(
        scenario="access_request_stuck_approval",
        caller_id="john.doe",
        short_description="I submitted an access request for SAP Finance 5 days ago but still do not have access",
        application="SAP ECC",
        sys_id="INC0001234",
    )
    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    rca = resp.json()
    assert rca["rca_code"] == "APPROVAL_PENDING_MANAGER", f"Expected APPROVAL_PENDING_MANAGER, got: {rca['rca_code']}"
    assert rca["confidence"] == "HIGH"
    assert "checks_performed" in rca
    assert "A1" in rca["checks_performed"]
    assert rca["rca_duration_ms"] > 0
    assert rca["auto_resolvable"] is True  # Can send reminder
    assert "approval" in rca["summary"].lower() or "pending" in rca["summary"].lower()


@pytest.mark.asyncio
async def test_health_endpoint(agent_client):
    """Agent health check should return 200."""
    resp = await agent_client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
