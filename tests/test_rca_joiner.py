"""
Integration tests: joiner scenarios.
"""
import pytest
from .conftest import make_incident_payload


@pytest.mark.asyncio
async def test_identity_not_found(agent_client):
    """User does not exist in IIQ at all."""
    payload = make_incident_payload(
        scenario="identity_not_found",
        caller_id="nonexistent.user",
        short_description="New hire cannot log in, account does not exist",
        application="Active Directory",
        sys_id="INC0001238",
    )
    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

    rca = resp.json()
    assert rca["rca_code"] in ("IDENTITY_NOT_FOUND", "JOINER_IDENTITY_MISSING"), \
        f"Got: {rca['rca_code']}"
    assert rca["confidence"] == "HIGH"


@pytest.mark.asyncio
async def test_joiner_not_started(agent_client):
    """New hire has a future start date — provisioning not yet triggered."""
    payload = make_incident_payload(
        scenario="joiner_not_started",
        caller_id="future.hire",
        short_description="New hire onboarding — no accounts created yet",
        application="Active Directory",
        sys_id="INC0001239",
    )
    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

    rca = resp.json()
    assert rca["rca_code"] == "JOINER_NOT_YET_STARTED", f"Got: {rca['rca_code']}"
    assert rca["confidence"] == "HIGH"
    assert rca["auto_resolvable"] is False
