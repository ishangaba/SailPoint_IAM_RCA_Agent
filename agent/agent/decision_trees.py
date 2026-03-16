from dataclasses import dataclass
from .incident_classifier import IncidentType


@dataclass
class ToolAction:
    """Represents a single tool call decision from adaptive/open reasoning."""
    tool_name: str    # MCP tool name or "DONE" to signal investigation complete
    tool_input: dict  # Arguments to pass to the tool
    rationale: str    # Why this tool was chosen (for deviation_log)

# Each step: { "tool": tool_name, "stop_if": condition_description }
# The RCA agent interprets stop_if conditions in rca_agent.py

DECISION_TREES: dict[IncidentType, list[dict]] = {
    IncidentType.ACCESS_REQUEST: [
        {"step": "A1", "tool": "iiq_identity_get", "required": True,
         "stop_conditions": ["identity_not_found", "identity_inactive"]},
        {"step": "B1", "tool": "iiq_request_search", "required": True,
         "stop_conditions": ["no_request", "request_rejected", "request_expired"]},
        {"step": "C1", "tool": "iiq_workflow_get_status", "required": True,
         "depends_on": "B1.workflowCaseId",
         "stop_conditions": ["approval_pending", "approval_rejected", "approval_no_approver"]},
        {"step": "D1", "tool": "iiq_provisioning_search_transactions", "required": False,
         "stop_conditions": ["provisioning_failed"]},
        {"step": "E1", "tool": "iiq_entitlement_get_all", "required": False,
         "stop_conditions": ["access_already_present"]},
        {"step": "F2", "tool": "iiq_task_check_freshness", "required": False,
         "stop_conditions": ["aggregation_stale"]},
    ],
    IncidentType.GROUP_MEMBERSHIP: [
        {"step": "A1", "tool": "iiq_identity_get", "required": True,
         "stop_conditions": ["identity_not_found", "identity_inactive"]},
        {"step": "D1", "tool": "iiq_provisioning_search_transactions", "required": False,
         "stop_conditions": ["provisioning_failed"]},
        {"step": "E1", "tool": "iiq_entitlement_get_all", "required": False,
         "stop_conditions": ["access_already_present"]},
        {"step": "F2", "tool": "iiq_task_check_freshness", "required": False,
         "stop_conditions": ["aggregation_stale"]},
    ],
    IncidentType.JOINER: [
        {"step": "A1", "tool": "iiq_identity_get", "required": False,
         "stop_conditions": ["identity_not_found_joiner", "joiner_not_started", "joiner_complete"]},
        {"step": "F1", "tool": "iiq_task_get_results", "required": True,
         "stop_conditions": ["hr_aggregation_failed"]},
        {"step": "D1", "tool": "iiq_provisioning_search_transactions", "required": False,
         "stop_conditions": ["provisioning_failed"]},
    ],
    IncidentType.AGGREGATION_HEALTH: [
        {"step": "F1", "tool": "iiq_task_get_results", "required": True,
         "stop_conditions": ["aggregation_repeated_failures", "aggregation_never_run"]},
        {"step": "F2", "tool": "iiq_task_check_freshness", "required": True,
         "stop_conditions": ["aggregation_stale"]},
        {"step": "E1", "tool": "iiq_entitlement_get_all", "required": False,
         "stop_conditions": []},
    ],
    IncidentType.LEAVER: [
        {"step": "A1", "tool": "iiq_identity_get", "required": True,
         "stop_conditions": ["identity_not_found"]},  # Don't stop on terminated — continue to E1
        {"step": "E1", "tool": "iiq_entitlement_get_all", "required": True,
         "stop_conditions": ["leaver_access_not_revoked"]},
    ],
    IncidentType.POLICY_VIOLATION: [
        {"step": "A1", "tool": "iiq_identity_get", "required": True,
         "stop_conditions": ["identity_not_found", "identity_inactive"]},
        {"step": "E1", "tool": "iiq_entitlement_get_all", "required": True,
         "stop_conditions": ["policy_violation_detected"]},
    ],
}
