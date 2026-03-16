"""
Integration tests: leaver and unknown scenarios.
"""
import pytest
from .conftest import make_incident_payload


@pytest.mark.asyncio
async def test_leaver_access_not_revoked(agent_client):
    """Terminated user still has active entitlements — URGENT."""
    payload = make_incident_payload(
        scenario="leaver_access_not_revoked",
        caller_id="terminated.user",
        short_description="Terminated employee still has active SAP and AD accounts",
        application="Active Directory",
        sys_id="INC0001240",
    )
    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

    rca = resp.json()
    assert rca["rca_code"] == "LEAVER_ACCESS_NOT_REVOKED", f"Got: {rca['rca_code']}"
    assert rca["confidence"] == "HIGH"
    assert rca["auto_resolvable"] is False
    assert "URGENT" in rca["escalation_path"] or "Security" in rca["escalation_path"]


@pytest.mark.asyncio
async def test_unknown_all_checks_pass(agent_client):
    """All checks pass with no root cause — should escalate."""
    payload = make_incident_payload(
        scenario="unknown_all_checks_pass",
        caller_id="bob.smith",
        short_description="Cannot access SAP but all checks seem to pass",
        application="SAP ECC",
        sys_id="INC0001241",
    )
    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

    rca = resp.json()
    assert rca["rca_code"] == "UNKNOWN_STATUS", f"Got: {rca['rca_code']}"
    assert rca["confidence"] == "LOW"
    assert "L3" in rca["escalation_path"] or "IAM-L3" in rca["escalation_path"]
