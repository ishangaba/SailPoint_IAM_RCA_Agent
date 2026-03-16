from dataclasses import dataclass
from typing import Optional, Any


@dataclass
class RCACodeDefinition:
    code: str
    category: str          # "identity" | "request" | "provisioning" | "aggregation" | "joiner" | "system" | "inconclusive"
    default_confidence: str  # "HIGH" | "MEDIUM" | "LOW"
    auto_resolvable: bool
    auto_resolution_action: Optional[str]
    escalation_path: str
    description: str       # Short description of the root cause


# Complete catalog — all codes from Part 6 of the docs
RCA_CATALOG: dict[str, RCACodeDefinition] = {
    # Identity Issues
    "IDENTITY_NOT_FOUND": RCACodeDefinition(
        code="IDENTITY_NOT_FOUND",
        category="identity",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops → HR-Integration",
        description="No IIQ identity found for this username — not yet aggregated from HR"
    ),
    "IDENTITY_INACTIVE": RCACodeDefinition(
        code="IDENTITY_INACTIVE",
        category="identity",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops → HR-System",
        description="Identity exists but lifecycle state = inactive/terminated"
    ),
    # Access Request Issues
    "NO_ACCESS_REQUEST_FOUND": RCACodeDefinition(
        code="NO_ACCESS_REQUEST_FOUND",
        category="request",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="Help user submit request via self-service portal",
        description="No access request found in IIQ — user needs to submit via portal"
    ),
    "REQUEST_REJECTED": RCACodeDefinition(
        code="REQUEST_REJECTED",
        category="request",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="Route back to requester with rejection reason",
        description="Access request was rejected by approver"
    ),
    "REQUEST_EXPIRED": RCACodeDefinition(
        code="REQUEST_EXPIRED",
        category="request",
        default_confidence="HIGH",
        auto_resolvable=True,
        auto_resolution_action="resubmit_request",
        escalation_path="IAM-Ops",
        description="Access request was not approved within the SLA window"
    ),
    "APPROVAL_PENDING_MANAGER": RCACodeDefinition(
        code="APPROVAL_PENDING_MANAGER",
        category="request",
        default_confidence="HIGH",
        auto_resolvable=True,
        auto_resolution_action="send_approval_reminder",
        escalation_path="Manager → IAM-Ops (escalate if > 72h)",
        description="Workflow stuck — manager has not approved"
    ),
    "APPROVAL_PENDING_APP_OWNER": RCACodeDefinition(
        code="APPROVAL_PENDING_APP_OWNER",
        category="request",
        default_confidence="HIGH",
        auto_resolvable=True,
        auto_resolution_action="send_approval_reminder",
        escalation_path="App-Owner → IAM-Ops",
        description="Workflow stuck — app owner has not approved"
    ),
    "APPROVAL_NO_APPROVER": RCACodeDefinition(
        code="APPROVAL_NO_APPROVER",
        category="request",
        default_confidence="MEDIUM",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops → HR-System",
        description="Approver not set or approver account inactive"
    ),
    # Provisioning Failures
    "PROVISIONING_CONNECTOR_ERROR": RCACodeDefinition(
        code="PROVISIONING_CONNECTOR_ERROR",
        category="provisioning",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops → App-Admin",
        description="Connector returned error (permissions, config, or network issue)"
    ),
    "PROVISIONING_API_LIMIT": RCACodeDefinition(
        code="PROVISIONING_API_LIMIT",
        category="provisioning",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops → App-Admin",
        description="Target system API rate limit or quota exceeded"
    ),
    "PROVISIONING_ACCOUNT_EXISTS": RCACodeDefinition(
        code="PROVISIONING_ACCOUNT_EXISTS",
        category="provisioning",
        default_confidence="MEDIUM",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops (manual correlation)",
        description="Account already exists in target — correlation may have failed"
    ),
    "PROVISIONING_TIMEOUT": RCACodeDefinition(
        code="PROVISIONING_TIMEOUT",
        category="provisioning",
        default_confidence="MEDIUM",
        auto_resolvable=True,
        auto_resolution_action="retry_provisioning",
        escalation_path="IAM-Ops if recurs",
        description="Connector timed out — transient or target system slow"
    ),
    "PROVISIONING_SOD_VIOLATION": RCACodeDefinition(
        code="PROVISIONING_SOD_VIOLATION",
        category="provisioning",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="Security-Team → Business",
        description="Provisioning blocked by Segregation of Duties policy"
    ),
    # Aggregation Issues
    "AGGREGATION_STALE_DATA": RCACodeDefinition(
        code="AGGREGATION_STALE_DATA",
        category="aggregation",
        default_confidence="MEDIUM",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops",
        description="Last aggregation > 1.5x expected frequency — IIQ may not reflect current state"
    ),
    "AGGREGATION_REPEATED_FAILURES": RCACodeDefinition(
        code="AGGREGATION_REPEATED_FAILURES",
        category="aggregation",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops → App-Admin",
        description="3+ consecutive aggregation failures — connector likely broken"
    ),
    "AGGREGATION_NEVER_RUN": RCACodeDefinition(
        code="AGGREGATION_NEVER_RUN",
        category="aggregation",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops (setup required)",
        description="No aggregation task has ever run for this application"
    ),
    # Joiner/Mover/Leaver
    "JOINER_NOT_YET_STARTED": RCACodeDefinition(
        code="JOINER_NOT_YET_STARTED",
        category="joiner",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="Expected behavior",
        description="Start date is in the future — provisioning not yet triggered"
    ),
    "JOINER_IDENTITY_MISSING": RCACodeDefinition(
        code="JOINER_IDENTITY_MISSING",
        category="joiner",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="HR-Integration",
        description="HR system has not pushed the new hire record to IIQ"
    ),
    "JOINER_COMPLETE": RCACodeDefinition(
        code="JOINER_COMPLETE",
        category="joiner",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="Verify user can log in",
        description="Joiner provisioning already completed successfully"
    ),
    "LEAVER_ACCESS_NOT_REVOKED": RCACodeDefinition(
        code="LEAVER_ACCESS_NOT_REVOKED",
        category="joiner",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="URGENT: IAM-Ops + Security",
        description="Termination event received but de-provisioning failed"
    ),
    # System Issues
    "IIQ_API_UNREACHABLE": RCACodeDefinition(
        code="IIQ_API_UNREACHABLE",
        category="system",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops + Infra",
        description="Cannot connect to IIQ server"
    ),
    "IIQ_API_AUTH_FAILURE": RCACodeDefinition(
        code="IIQ_API_AUTH_FAILURE",
        category="system",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-Ops (rotate credentials)",
        description="Service account credentials rejected"
    ),
    # Inconclusive
    "UNKNOWN_STATUS": RCACodeDefinition(
        code="UNKNOWN_STATUS",
        category="inconclusive",
        default_confidence="LOW",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="IAM-L3-Team",
        description="All checks passed — no root cause identified"
    ),
    "INSUFFICIENT_TICKET_DATA": RCACodeDefinition(
        code="INSUFFICIENT_TICKET_DATA",
        category="inconclusive",
        default_confidence="HIGH",
        auto_resolvable=False,
        auto_resolution_action=None,
        escalation_path="Return to submitter for clarification",
        description="Ticket lacks actionable entities — no identity, application, or description to investigate"
    ),
}


def evaluate_free(
    latest_result: Any,
    all_evidence: dict[str, Any],
) -> Optional[tuple[str, str]]:
    """
    Used by adaptive and open reasoning tiers.
    Inspects the most recent tool result (and accumulated evidence) to determine
    if a root cause can now be identified.

    Returns (rca_code, confidence) or None if inconclusive.
    Tool result keys in these tiers are MCP tool names, not step IDs.
    """
    if not isinstance(latest_result, dict):
        return None

    # ── Identity not found ──────────────────────────────────────────────────
    if latest_result.get("exists") is False:
        return ("IDENTITY_NOT_FOUND", "HIGH")

    # ── Approval pending (workflow stuck in approval) ───────────────────────
    wf_status = latest_result.get("status", "")
    wf_step = latest_result.get("currentStep", "").lower()
    wf_age = latest_result.get("ageHours", 0) or 0
    if wf_status == "Running" and ("approval" in wf_step or "wait" in wf_step) and wf_age > 48:
        return ("APPROVAL_PENDING_MANAGER", "HIGH")

    # ── Provisioning failure (transactions result) ──────────────────────────
    txns = latest_result.get("transactions", [])
    if txns:
        tx = txns[0]
        if tx.get("status") == "Failed":
            err = " ".join(tx.get("errorMessages", [])).lower()
            if "member limit" in err or "quota" in err or "api_error" in err:
                return ("PROVISIONING_API_LIMIT", "HIGH")
            if "timeout" in err or "timed out" in err:
                return ("PROVISIONING_TIMEOUT", "MEDIUM")
            if "duplicate" in err or "already exists" in err:
                return ("PROVISIONING_ACCOUNT_EXISTS", "MEDIUM")
            if "sod" in err or "segregation" in err:
                return ("PROVISIONING_SOD_VIOLATION", "HIGH")
            return ("PROVISIONING_CONNECTOR_ERROR", "HIGH")

    # ── Aggregation freshness ───────────────────────────────────────────────
    assessment = latest_result.get("assessment", "")
    if assessment == "STALE":
        return ("AGGREGATION_STALE_DATA", "MEDIUM")
    if assessment == "NEVER_RUN":
        return ("AGGREGATION_NEVER_RUN", "HIGH")

    # ── Aggregation repeated failures (task results) ────────────────────────
    consecutive = latest_result.get("consecutive_failures", 0)
    if consecutive >= 3:
        return ("AGGREGATION_REPEATED_FAILURES", "HIGH")
    tasks = latest_result.get("tasks", [])
    for task in tasks:
        msgs = " ".join(m.get("text", "") for m in task.get("messages", []))
        if "401" in msgs or "unauthorized" in msgs.lower():
            return ("AGGREGATION_REPEATED_FAILURES", "HIGH")

    # ── Leaver: terminated user still has entitlements ──────────────────────
    # Correlate across evidence: look for an inactive identity + active entitlements
    inactive_identity: Optional[dict] = None
    for val in all_evidence.values():
        if isinstance(val, dict):
            if val.get("active") is False and val.get("lifecycleState") in ("terminated", "inactive"):
                inactive_identity = val
                break
    if inactive_identity:
        for val in all_evidence.values():
            if isinstance(val, dict) and val.get("total", 0) > 0 and "entitlements" in val:
                return ("LEAVER_ACCESS_NOT_REVOKED", "HIGH")

    return None
