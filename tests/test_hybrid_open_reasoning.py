"""
Integration test: open reasoning tier — ticket description is unclassifiable,
triggering confidence < 0.75 and open reasoning mode.

Expected:
- execution_tier == "open_reasoning"
- No crash (any rca_code is acceptable)
- deviation_log has entries (Claude's tool call log)
- Agent calls at least one tool (checks_performed is not empty)
"""
import pytest


@pytest.mark.asyncio
async def test_hybrid_open_reasoning_unclassifiable_ticket(agent_client):
    """
    An unclassifiable ticket triggers the open reasoning tier.
    The agent must reason freely and produce a non-crashing result.
    """
    payload = {
        "sys_id": "INC0006001",
        "number": "INC0006001",
        "caller_id": {"user_name": "john.doe"},
        "short_description": "thing broken pls fix asap ref ticket 4422",
        "description": "",
        "category": "",
        "u_affected_app": "",
        "scenario": "",   # No scenario — open reasoning with default mock data
    }

    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    rca = resp.json()

    # Must be open_reasoning tier
    assert rca.get("execution_tier") == "open_reasoning", (
        f"Expected execution_tier=open_reasoning, got: {rca.get('execution_tier')}"
    )

    # Must have a valid rca_code (anything — even UNKNOWN_STATUS is fine)
    assert "rca_code" in rca and rca["rca_code"], "Expected a non-empty rca_code"

    # deviation_log must have entries (Claude's tool call decisions)
    deviation_log = rca.get("deviation_log", [])
    assert len(deviation_log) >= 1, (
        f"Expected at least one deviation_log entry, got: {deviation_log}"
    )

    # Agent must have called at least one tool
    checks_performed = rca.get("checks_performed", [])
    assert len(checks_performed) >= 1, (
        f"Expected at least one tool call in checks_performed, got: {checks_performed}"
    )

    # sequence_hint must be empty (no tree was used)
    assert rca.get("sequence_hint") == [], (
        f"Expected empty sequence_hint for open_reasoning, got: {rca.get('sequence_hint')}"
    )

    # Standard fields
    assert rca["rca_duration_ms"] > 0
    assert "evidence" in rca


@pytest.mark.asyncio
async def test_hybrid_open_reasoning_has_all_report_fields(agent_client):
    """
    Open reasoning result must include all three new hybrid report fields.
    """
    payload = {
        "sys_id": "INC0006002",
        "number": "INC0006002",
        "caller_id": {"user_name": "john.doe"},
        "short_description": "something wrong with my stuff 9999",
        "description": "",
        "category": "",
        "u_affected_app": "",
        "scenario": "",
    }

    resp = await agent_client.post("/webhook/incident", json=payload)
    assert resp.status_code == 200

    rca = resp.json()
    assert "execution_tier" in rca
    assert "deviation_log" in rca
    assert "sequence_hint" in rca
