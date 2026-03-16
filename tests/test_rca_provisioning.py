"""
Integration tests: provisioning failure scenarios.
"""
import pytest
from .conftest import make_incident_payload


@pytest.mark.asyncio
async def test_provisioning_connector_error(agent_client):
    """Access was approved but AD provisioning failed with NoPermissionException."""
    payload = make_incident_payload(
        scenario="provisioning_connector_error",
        caller_id="john.doe",
        short_description="My access request was approved a week ago but I still cannot log in to Active Directory",
        application="Active Directory",
        sys_id="INC0001235",
    )
    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

    rca = resp.json()
    assert rca["rca_code"] == "PROVISIONING_CONNECTOR_ERROR", f"Got: {rca['rca_code']}"
    assert rca["confidence"] == "HIGH"
    assert rca["auto_resolvable"] is False
    assert "IAM-Ops" in rca["escalation_path"]


@pytest.mark.asyncio
async def test_github_api_limit(agent_client):
    """GitHub org member limit reached during provisioning."""
    payload = make_incident_payload(
        scenario="github_api_limit",
        caller_id="mary.johnson",
        short_description="I was not added to the GitHub Engineering team even though my request was approved",
        application="GitHub Enterprise",
        sys_id="INC0001236",
    )
    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

    rca = resp.json()
    assert rca["rca_code"] == "PROVISIONING_API_LIMIT", f"Got: {rca['rca_code']}"
    assert rca["confidence"] == "HIGH"
    assert "limit" in rca["summary"].lower() or "quota" in rca["summary"].lower()
