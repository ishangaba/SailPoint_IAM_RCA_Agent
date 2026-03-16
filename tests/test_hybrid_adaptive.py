"""
Integration test: adaptive tier — A1 tool returns HTTP 500, agent skips it
and still finds PROVISIONING_CONNECTOR_ERROR via D1.

Expected:
- execution_tier == "adaptive"
- rca_code == "PROVISIONING_CONNECTOR_ERROR"
- deviation_log contains at least one entry mentioning A1
"""
import pytest
from .conftest import make_incident_payload


@pytest.mark.asyncio
async def test_hybrid_adaptive_skips_broken_tool(agent_client, mock_client):
    """
    With A1 broken (mock returns 500), the guided sequence deviates but
    continues and finds the provisioning error via D1.
    execution_tier should be 'adaptive' due to the mid-sequence deviation.
    """
    # Set break_tool on the mock server — A1 will return HTTP 500
    set_resp = await mock_client.post("/config/break-tool", json={"tool": "A1"})
    assert set_resp.status_code == 200, f"Failed to set break_tool: {set_resp.text}"

    try:
        payload = make_incident_payload(
            scenario="provisioning_connector_error",
            caller_id="john.doe",
            short_description="My access request was approved but I still cannot access Active Directory",
            application="Active Directory",
            sys_id="INC0005001",
        )
        resp = await agent_client.post("/webhook/incident", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        rca = resp.json()

        # Core assertions
        assert rca["rca_code"] == "PROVISIONING_CONNECTOR_ERROR", (
            f"Expected PROVISIONING_CONNECTOR_ERROR, got: {rca['rca_code']}"
        )
        assert rca["execution_tier"] == "adaptive", (
            f"Expected execution_tier=adaptive (A1 errored mid-sequence), got: {rca['execution_tier']}"
        )

        # deviation_log must mention A1
        deviation_log = rca.get("deviation_log", [])
        assert len(deviation_log) >= 1, "Expected at least one deviation_log entry"
        a1_mentioned = any("A1" in entry for entry in deviation_log)
        assert a1_mentioned, (
            f"Expected deviation_log to mention A1, got: {deviation_log}"
        )

        # Standard report fields must still be present
        assert "checks_performed" in rca
        assert "D1" in rca["checks_performed"], "D1 should have run (found provisioning error)"
        assert rca["rca_duration_ms"] > 0

    finally:
        # Always clear break_tool so subsequent tests are unaffected
        await mock_client.delete("/config/break-tool")


@pytest.mark.asyncio
async def test_break_tool_config_endpoints(mock_client):
    """Verify the break_tool config endpoints themselves work correctly."""
    # Set
    resp = await mock_client.post("/config/break-tool", json={"tool": "D1"})
    assert resp.status_code == 200
    assert resp.json()["break_tool"] == "D1"

    # Clear
    resp = await mock_client.delete("/config/break-tool")
    assert resp.status_code == 200
    assert resp.json()["break_tool"] is None
