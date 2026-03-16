"""
ServiceNow write-back: format RCA results as work notes and PATCH the incident.
Three template types:
  1. Standard RCA    → state=2 (In Progress), assignment_group=IAM-Ops
  2. Auto-Resolved   → state=6 (Resolved), resolution_code set
  3. Escalated       → state=2 (In Progress), assignment_group=IAM-L3, escalation=1
"""
import json
from datetime import datetime, timezone
from typing import Any
from .client import ServiceNowClient
from ..config import settings


def _format_evidence(evidence: dict[str, Any]) -> str:
    """Format evidence dict as a readable bullet list."""
    lines = []
    # Key fields to highlight
    priority_keys = [
        "caller_id", "application", "incident_type",
        "identity_active", "identity_lifecycle",
        "request_found", "request_status", "workflow_status",
        "provisioning_error", "approval_age_hours", "approver",
    ]
    printed = set()
    for key in priority_keys:
        if key in evidence:
            lines.append(f"• {key.replace('_', ' ').title()}: {evidence[key]}")
            printed.add(key)
    # Any remaining non-check keys
    for key, val in evidence.items():
        if key not in printed and not key.startswith("check_"):
            if isinstance(val, (str, int, float, bool)):
                lines.append(f"• {key.replace('_', ' ').title()}: {val}")
    return "\n".join(lines) if lines else "No structured evidence available."


def format_standard_rca(rca: dict[str, Any], incident_id: str) -> str:
    """
    Standard RCA work note — written when root cause is identified but manual
    action is required.
    """
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    checks = ", ".join(rca.get("checks_performed", []))
    duration_s = rca.get("rca_duration_ms", 0) / 1000

    tier = rca.get("execution_tier", "guided")
    return f"""[code]RCA Engine — Automated Analysis [tier: {tier}]
Incident: {incident_id} | Analyzed: {ts}

RCA Code: {rca["rca_code"]}
Confidence: {rca["confidence"]}
RCA Time: {duration_s:.1f} seconds
Checks Performed: {checks}

SUMMARY:
{rca["summary"]}

ROOT CAUSE:
{rca["root_cause"]}

EVIDENCE:
{_format_evidence(rca.get("evidence", {}))}

RECOMMENDATION:
{rca["recommendation"]}

AUTO-RESOLVABLE: {"YES" if rca["auto_resolvable"] else "NO"}
ESCALATION PATH: {rca.get("escalation_path", "IAM-Ops-Team")}
[/code]"""


def format_auto_resolved(rca: dict[str, Any], incident_id: str, action_taken: str) -> str:
    """
    Auto-resolved work note — written when the agent resolved the issue automatically
    (e.g. sent approval reminder).
    """
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return f"""[code]RCA Engine - Auto-Resolved
Incident: {incident_id} | Resolved: {ts}

RCA Code: {rca["rca_code"]}
Action Taken: {action_taken}
Resolution: {rca["recommendation"]}
[/code]"""


def format_escalated(rca: dict[str, Any], incident_id: str, reason: str) -> str:
    """
    Escalated work note — written when no root cause was identified or the issue
    requires L3 investigation.
    """
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    checks = ", ".join(rca.get("checks_performed", []))

    return f"""[code]RCA Engine - Escalated
Incident: {incident_id} | Escalated: {ts}

RCA Code: {rca["rca_code"]}
Reason: {reason}
Checks Performed: {checks}

EVIDENCE COLLECTED:
{_format_evidence(rca.get("evidence", {}))}

RECOMMENDATION:
{rca["recommendation"]}
[/code]"""


async def write_rca_result(
    snow_client: ServiceNowClient,
    incident_sys_id: str,
    rca: dict[str, Any],
) -> dict[str, Any]:
    """
    Decide which template to use and write the work note back to ServiceNow.
    Returns the PATCH response.

    Logic:
    - auto_resolvable=True  → use auto-resolved template, state=6 (Resolved)
    - rca_code=UNKNOWN_STATUS or confidence=LOW → use escalated template, assign to L3
    - everything else → use standard RCA template, state=2 (In Progress), assign to IAM-Ops
    """
    rca_code = rca.get("rca_code", "UNKNOWN_STATUS")
    auto_resolvable = rca.get("auto_resolvable", False)
    confidence = rca.get("confidence", "LOW")

    if auto_resolvable and rca.get("auto_resolution_action"):
        # Auto-resolved path
        action = rca["auto_resolution_action"].replace("_", " ").title()
        work_notes = format_auto_resolved(rca, incident_sys_id, action)
        return await snow_client.update_incident(
            sys_id=incident_sys_id,
            work_notes=work_notes,
            state="6",
            resolution_code="Solved Remotely (by phone/email/IM)",
            resolution_notes=f"Auto-resolved by RCA Engine: {rca['recommendation']}",
        )

    if rca_code in ("UNKNOWN_STATUS", "VERIFICATION_NEEDED") or confidence == "LOW":
        # Escalated path
        reason = (
            "No root cause identified after all automated checks."
            if rca_code == "UNKNOWN_STATUS"
            else rca["summary"]
        )
        work_notes = format_escalated(rca, incident_sys_id, reason)
        return await snow_client.update_incident(
            sys_id=incident_sys_id,
            work_notes=work_notes,
            state="2",
            assignment_group=settings.snow_l3_assignment_group,
        )

    # Standard RCA path
    work_notes = format_standard_rca(rca, incident_sys_id)
    return await snow_client.update_incident(
        sys_id=incident_sys_id,
        work_notes=work_notes,
        state="2",
        assignment_group=settings.snow_iam_assignment_group,
    )
