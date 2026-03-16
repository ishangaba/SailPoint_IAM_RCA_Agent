"""
Integration test: aggregation_stale scenario.
Expected RCA code: AGGREGATION_STALE_DATA
"""
import pytest
from .conftest import make_incident_payload


@pytest.mark.asyncio
async def test_aggregation_stale(agent_client):
    """GitHub aggregation data is 50 hours stale — entitlements may not reflect reality."""
    payload = make_incident_payload(
        scenario="aggregation_stale",
        caller_id="bob.smith",
        short_description="GitHub aggregation has been failing for 2 days, data is stale",
        application="GitHub Enterprise",
        sys_id="INC0001237",
    )
    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

    rca = resp.json()
    assert rca["rca_code"] in ("AGGREGATION_STALE_DATA", "AGGREGATION_REPEATED_FAILURES"), \
        f"Got: {rca['rca_code']}"
    assert rca["confidence"] in ("HIGH", "MEDIUM")
    assert rca["rca_duration_ms"] > 0
