"""
Integration test: confidence boundary — same scenario, two different tiers.

Run access_request_stuck_approval twice:
  1. Normal: confidence >= 0.75 → execution_tier == "guided"
  2. Forced confidence = 0.5: below threshold → execution_tier == "open_reasoning"

Both runs must produce APPROVAL_PENDING_MANAGER.
"""
import pytest
from .conftest import make_incident_payload


@pytest.mark.asyncio
async def test_guided_tier_high_confidence(agent_client):
    """
    Normal ticket with clear access-request language → high confidence → guided tier.
    """
    payload = make_incident_payload(
        scenario="access_request_stuck_approval",
        caller_id="john.doe",
        short_description="I submitted an access request for SAP Finance 5 days ago but still do not have access",
        application="SAP ECC",
        sys_id="INC0007001",
    )

    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    rca = resp.json()
    assert rca["rca_code"] == "APPROVAL_PENDING_MANAGER", (
        f"Expected APPROVAL_PENDING_MANAGER, got: {rca['rca_code']}"
    )
    assert rca["execution_tier"] == "guided", (
        f"Expected guided tier for high-confidence ticket, got: {rca['execution_tier']}"
    )
    assert rca["deviation_log"] == [], (
        f"Expected empty deviation_log for clean guided run, got: {rca['deviation_log']}"
    )
    assert len(rca.get("sequence_hint", [])) > 0, "Expected non-empty sequence_hint for guided tier"


@pytest.mark.asyncio
async def test_open_reasoning_tier_forced_low_confidence(agent_client):
    """
    Same scenario but with force_confidence=0.5 → below threshold → open reasoning tier.
    Claude must still identify APPROVAL_PENDING_MANAGER by reasoning through the evidence.
    """
    payload = {
        "sys_id": "INC0007002",
        "number": "INC0007002",
        "caller_id": {"user_name": "john.doe"},
        "short_description": "I submitted an access request for SAP Finance 5 days ago but still do not have access",
        "description": "",
        "category": "Access",
        "u_affected_app": "SAP ECC",
        "scenario": "access_request_stuck_approval",
        "force_confidence": 0.5,   # Inject: force open_reasoning tier
    }

    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    rca = resp.json()
    assert rca["execution_tier"] == "open_reasoning", (
        f"Expected open_reasoning tier with force_confidence=0.5, got: {rca['execution_tier']}"
    )
    assert rca["rca_code"] == "APPROVAL_PENDING_MANAGER", (
        f"Expected APPROVAL_PENDING_MANAGER from open reasoning, got: {rca['rca_code']}"
    )
    assert rca.get("sequence_hint") == [], (
        "Expected empty sequence_hint for open_reasoning tier"
    )
    deviation_log = rca.get("deviation_log", [])
    assert len(deviation_log) >= 1, "Expected deviation_log entries for open_reasoning tier"
