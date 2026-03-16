"""
RCA Agent: Hybrid three-tier execution model.

Tier 1 — Guided:    Confidence ≥ 0.75 and decision-tree resolves the incident.
Tier 2 — Adaptive:  Confidence ≥ 0.75 but guided path yields UNKNOWN_STATUS
                    (or had a tool error mid-sequence), so Claude picks next checks.
Tier 3 — Open:      Confidence < 0.75 or incident_type = "unknown". Claude reasons
                    freely across all 12 tools with no sequence hint.
"""
import asyncio
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from .incident_classifier import Classification, IncidentType, classify_incident
from .decision_trees import DECISION_TREES, ToolAction
from .rca_codes import RCA_CATALOG, RCACodeDefinition, evaluate_free
from ..mcp_client import MCPClient

# ── Tuning constants (overridable via env) ─────────────────────────────────────
CONFIDENCE_THRESHOLD_GUIDED: float = float(
    os.getenv("CONFIDENCE_THRESHOLD_GUIDED", "0.75")
)
MAX_ADAPTIVE_TOOL_CALLS: int = int(os.getenv("MAX_ADAPTIVE_TOOL_CALLS", "10"))
MAX_OPEN_REASONING_TOOL_CALLS: int = int(
    os.getenv("MAX_OPEN_REASONING_TOOL_CALLS", "20")
)

# ── Available MCP tools with descriptions (for Claude prompts) ─────────────────
ALL_TOOL_DESCRIPTIONS: list[dict] = [
    {"name": "iiq_identity_get",
     "description": "Get full identity profile. Args: identity_id (str), include_roles (bool), include_entitlements (bool), scenario (str, optional)"},
    {"name": "iiq_identity_check_exists",
     "description": "Check if identity exists. Args: identity_id (str), scenario (str, optional)"},
    {"name": "iiq_request_search",
     "description": "Search access requests for a user. Args: identity_id (str), status (str: All/Pending/Approved/Rejected), days_back (int), application (str, optional), scenario (str, optional)"},
    {"name": "iiq_request_get_details",
     "description": "Get access request details. Args: request_id (str), scenario (str, optional)"},
    {"name": "iiq_workflow_get_status",
     "description": "Get workflow/approval status by workflow ID. Args: workflow_id (str), scenario (str, optional)"},
    {"name": "iiq_workflow_list_active",
     "description": "List active workflows for a user. Args: identity_id (str), scenario (str, optional)"},
    {"name": "iiq_provisioning_search_transactions",
     "description": "Search provisioning transactions. Args: identity_id (str), status (str: Failed/Pending/All), days_back (int), application (str, optional), scenario (str, optional)"},
    {"name": "iiq_provisioning_get_transaction",
     "description": "Get provisioning transaction detail. Args: transaction_id (str), scenario (str, optional)"},
    {"name": "iiq_entitlement_get_all",
     "description": "Get all entitlements for a user. Args: identity_id (str), application (str, optional), scenario (str, optional)"},
    {"name": "iiq_entitlement_check_specific",
     "description": "Check if user has a specific entitlement. Args: identity_id (str), entitlement_name (str), application (str, optional), scenario (str, optional)"},
    {"name": "iiq_task_get_results",
     "description": "Get aggregation task results. Args: application (str), task_type (str: Aggregation/Refresh/Provisioning), limit (int), scenario (str, optional)"},
    {"name": "iiq_task_check_freshness",
     "description": "Check if aggregation data is fresh. Args: application (str), expected_frequency_hours (int), scenario (str, optional)"},
]

ALL_TOOL_NAMES = [t["name"] for t in ALL_TOOL_DESCRIPTIONS]


@dataclass
class _ToolResult:
    is_error: bool
    data: Any
    error_message: str = ""


class RCAAgent:
    def __init__(self, mcp_client: MCPClient):
        self.mcp = mcp_client
        self._anthropic_client = None  # lazy-initialized

    # ── Public entry point ─────────────────────────────────────────────────────

    async def perform_rca(
        self,
        caller_id: str,
        short_description: str,
        description: str = "",
        category: str = "",
        application: str = "",
        scenario: str = "",
        force_confidence: Optional[float] = None,
    ) -> dict:
        """
        Main RCA entry point — selects tier and returns a structured RCA report.
        force_confidence: override classifier confidence (test injection only).
        """
        start_time = time.monotonic()

        # Assemble ticket dict for Claude prompts
        ticket = {
            "short_description": short_description,
            "description": description,
            "category": category,
            "caller_id": caller_id,
            "application": application,
            "scenario": scenario,
        }

        # Step 1: Classify
        classification = classify_incident(short_description, description, category)
        if force_confidence is not None:
            # Test injection: override confidence without changing the type
            classification = Classification(
                incident_type=classification.incident_type,
                confidence=force_confidence,
                raw_scores=classification.raw_scores,
                incident_type_enum=classification.incident_type_enum,
            )

        incident_type_enum = classification.incident_type_enum or IncidentType.ACCESS_REQUEST

        print(
            f"[rca_agent] Classified as {classification.incident_type} "
            f"(confidence={classification.confidence:.3f})",
            file=sys.stderr,
        )

        # Step 2: Select tier
        tier = self._select_tier(classification)
        print(f"[rca_agent] Execution tier: {tier}", file=sys.stderr)

        # Step 3: Run selected tier
        if tier in ("guided", "adaptive"):
            guided = await self._run_guided(
                incident_type_enum, caller_id, application, scenario, classification
            )

            rca_code = guided["rca_code"]

            if rca_code and rca_code != "UNKNOWN_STATUS":
                # Root cause found in guided pass
                effective_tier = "adaptive" if guided["had_deviation"] else "guided"
                duration_ms = int((time.monotonic() - start_time) * 1000)
                return self._build_final_report(
                    guided, effective_tier, duration_ms, classification
                )

            # Guided exhausted — escalate to adaptive
            print("[rca_agent] Guided pass exhausted, switching to adaptive", file=sys.stderr)
            adaptive = await self._run_adaptive(
                caller_id, application, scenario, guided, ticket
            )
            duration_ms = int((time.monotonic() - start_time) * 1000)
            return self._build_final_report(adaptive, "adaptive", duration_ms, classification)

        else:
            # Tier 3: open reasoning
            open_result = await self._run_open_reasoning(
                caller_id, application, scenario, ticket
            )
            duration_ms = int((time.monotonic() - start_time) * 1000)
            return self._build_final_report(open_result, "open_reasoning", duration_ms, classification)

    # ── Tier selection ─────────────────────────────────────────────────────────

    def _select_tier(self, classification: Classification) -> str:
        if (
            classification.confidence >= CONFIDENCE_THRESHOLD_GUIDED
            and classification.incident_type != "unknown"
        ):
            return "guided"
        return "open_reasoning"

    # ── Tier 1: Guided ────────────────────────────────────────────────────────

    async def _run_guided(
        self,
        incident_type: IncidentType,
        caller_id: str,
        application: str,
        scenario: str,
        classification: Classification,
    ) -> dict:
        """
        Execute the decision-tree sequence for this incident type.
        Returns an intermediate result dict — not the final report.
        had_deviation=True if any tool errored mid-sequence.
        """
        check_sequence = DECISION_TREES.get(
            incident_type, DECISION_TREES[IncidentType.ACCESS_REQUEST]
        )
        sequence_hint = [c["step"] for c in check_sequence]

        evidence: dict[str, Any] = {
            "caller_id": caller_id,
            "application": application,
            "scenario": scenario,
            "incident_type": incident_type.value,
            "classification_confidence": classification.confidence,
        }
        context: dict[str, Any] = {
            "caller_id": caller_id,
            "application": application,
            "scenario": scenario,
            "incident_type": incident_type,
        }
        checks_performed: list[str] = []
        deviation_log: list[str] = []
        had_deviation = False
        rca_code: Optional[str] = None
        rca_detail: dict = {}

        if incident_type == IncidentType.AGGREGATION_HEALTH:
            # F1 and F2 can run in parallel; E1 follows sequentially
            agg_f1 = next((c for c in check_sequence if c["step"] == "F1"), None)
            agg_f2 = next((c for c in check_sequence if c["step"] == "F2"), None)
            agg_e1 = next((c for c in check_sequence if c["step"] == "E1"), None)

            if agg_f1 and agg_f2:
                checks_performed.extend(["F1", "F2"])
                parallel = await self._execute_parallel_checks(
                    steps=[("F1", agg_f1["tool"]), ("F2", agg_f2["tool"])],
                    context=context,
                    check_defs=[agg_f1, agg_f2],
                )
                for step_id, check_def in [("F1", agg_f1), ("F2", agg_f2)]:
                    result = parallel.get(step_id, {})
                    if isinstance(result, dict) and "error" in result:
                        had_deviation = True
                        deviation_log.append(
                            f"Guided: skipped check {step_id} — error: {result['error']}"
                        )
                        continue
                    evidence[f"check_{step_id}"] = result
                    context[f"result_{step_id}"] = result
                    if not rca_code:
                        rca_code, rca_detail = self._evaluate_stop_conditions(
                            step_id, result, check_def, context
                        )

            if not rca_code and agg_e1:
                step = "E1"
                checks_performed.append(step)
                try:
                    result = await self._execute_check(step, agg_e1["tool"], context, agg_e1)
                    evidence[f"check_{step}"] = result
                    context[f"result_{step}"] = result
                    rca_code, rca_detail = self._evaluate_stop_conditions(
                        step, result, agg_e1, context
                    )
                except Exception as exc:
                    had_deviation = True
                    deviation_log.append(f"Guided: skipped check {step} — error: {exc}")
        else:
            for check_def in check_sequence:
                step = check_def["step"]
                tool_name = check_def["tool"]
                checks_performed.append(step)
                try:
                    result = await self._execute_check(step, tool_name, context, check_def)
                    evidence[f"check_{step}"] = result
                    context[f"result_{step}"] = result
                    rca_code, rca_detail = self._evaluate_stop_conditions(
                        step, result, check_def, context
                    )
                    if rca_code:
                        break
                except Exception as exc:
                    had_deviation = True
                    deviation_log.append(f"Guided: skipped check {step} — error: {exc}")
                    # Continue (don't abort) — adaptive tier handles unresolved cases

        if not rca_code:
            rca_code = "UNKNOWN_STATUS"
            rca_detail = {"message": "Guided sequence exhausted, no root cause found"}

        return {
            "rca_code": rca_code,
            "rca_detail": rca_detail,
            "evidence": evidence,
            "checks_performed": checks_performed,
            "deviation_log": deviation_log,
            "sequence_hint": sequence_hint,
            "had_deviation": had_deviation,
            "context": context,
        }

    # ── Tier 2: Adaptive ──────────────────────────────────────────────────────

    async def _run_adaptive(
        self,
        caller_id: str,
        application: str,
        scenario: str,
        guided: dict,
        ticket: dict,
    ) -> dict:
        """
        Guided pass returned UNKNOWN_STATUS. Ask Claude which additional
        tools to call. Bounded to MAX_ADAPTIVE_TOOL_CALLS extra calls.
        """
        evidence = dict(guided["evidence"])
        checks_performed = list(guided["checks_performed"])
        deviation_log = list(guided["deviation_log"])
        deviation_log.append("Entered adaptive tier: guided path returned UNKNOWN_STATUS")
        remaining = MAX_ADAPTIVE_TOOL_CALLS

        actions = await self._ask_claude_for_next_checks(
            ticket=ticket,
            evidence=evidence,
            already_checked=checks_performed,
            budget=remaining,
            mode="adaptive",
        )

        for action in actions:
            if action.tool_name == "DONE":
                deviation_log.append(f"Adaptive: Claude signalled DONE — {action.rationale}")
                break
            if remaining <= 0:
                deviation_log.append("Adaptive: budget exhausted")
                break

            result = await self._call_tool_safe_raw(action.tool_name, action.tool_input)
            remaining -= 1
            checks_performed.append(action.tool_name)
            deviation_log.append(
                f"Adaptive: called {action.tool_name} — {action.rationale}"
            )

            if result.is_error:
                deviation_log.append(f"  └─ error: {result.error_message}")
                continue

            evidence[action.tool_name] = result.data
            found = evaluate_free(result.data, evidence)
            if found:
                rca_code, confidence_str = found
                return {
                    "rca_code": rca_code,
                    "rca_detail": result.data,
                    "evidence": evidence,
                    "checks_performed": checks_performed,
                    "deviation_log": deviation_log,
                    "sequence_hint": guided["sequence_hint"],
                    "had_deviation": True,
                }

        return {
            "rca_code": "UNKNOWN_STATUS",
            "rca_detail": {},
            "evidence": evidence,
            "checks_performed": checks_performed,
            "deviation_log": deviation_log,
            "sequence_hint": guided["sequence_hint"],
            "had_deviation": True,
        }

    # ── Tier 3: Open reasoning ────────────────────────────────────────────────

    def _has_minimum_entities(self, caller_id: str, application: str, ticket: dict) -> bool:
        """
        Returns True if the ticket has at least one entity useful enough to
        form a meaningful tool call. Tickets that are complete gibberish with
        no extractable entities cannot be investigated and should return
        INSUFFICIENT_TICKET_DATA instead of making vacuous API calls.
        """
        if caller_id:
            return True
        if application:
            return True
        desc = (
            ticket.get("short_description", "") + " " +
            ticket.get("description", "") + " " +
            ticket.get("category", "")
        ).strip()
        return len(desc) > 10

    def _get_fallback_action(
        self,
        caller_id: str,
        application: str,
        scenario: str,
        evidence: dict,
        checks_performed: list[str],
    ) -> Optional[ToolAction]:
        """
        Structured fallback sequence used when Claude is unavailable.
        Follows the most common IAM investigation path: identity → requests →
        workflow status → provisioning transactions. Returns None when the
        sequence is exhausted.
        """
        checked = set(checks_performed)
        scenario_kw = {"scenario": scenario} if scenario else {}

        # Step 1: Identity check
        if "iiq_identity_get" not in checked and "iiq_identity_check_exists" not in checked:
            return ToolAction(
                "iiq_identity_get",
                {"identity_id": caller_id, "include_roles": True, **scenario_kw},
                "Fallback: initial identity check",
            )

        # Step 2: Access request search (only if identity is active or unknown)
        if "iiq_request_search" not in checked:
            identity = evidence.get("iiq_identity_get", {})
            if identity.get("active") is not False:
                args: dict = {
                    "identity_id": caller_id,
                    "status": "All",
                    "days_back": 30,
                    **scenario_kw,
                }
                if application:
                    args["application"] = application
                return ToolAction("iiq_request_search", args, "Fallback: check access requests")

        # Step 3: Workflow status (if a pending request with a workflowCaseId was found)
        if "iiq_workflow_get_status" not in checked:
            b1 = evidence.get("iiq_request_search", {})
            requests = b1.get("requests", [])
            if requests:
                workflow_id = requests[0].get("workflowCaseId")
                if workflow_id:
                    return ToolAction(
                        "iiq_workflow_get_status",
                        {"workflow_id": workflow_id, **scenario_kw},
                        "Fallback: check workflow status for pending request",
                    )

        # Step 4: Provisioning transactions (if no workflow found or workflow failed)
        if "iiq_provisioning_search_transactions" not in checked:
            args = {
                "identity_id": caller_id,
                "status": "Failed",
                "days_back": 14,
                **scenario_kw,
            }
            if application:
                args["application"] = application
            return ToolAction(
                "iiq_provisioning_search_transactions",
                args,
                "Fallback: check failed provisioning transactions",
            )

        return None  # Fallback sequence exhausted

    async def _run_open_reasoning(
        self,
        caller_id: str,
        application: str,
        scenario: str,
        ticket: dict,
    ) -> dict:
        """
        No classification confidence — Claude reasons freely from scratch.
        Hard cap: MAX_OPEN_REASONING_TOOL_CALLS.
        """
        # Pre-flight: return early for tickets with no actionable entities
        if not self._has_minimum_entities(caller_id, application, ticket):
            return {
                "rca_code": "INSUFFICIENT_TICKET_DATA",
                "rca_detail": {},
                "evidence": {"caller_id": caller_id, "application": application, "scenario": scenario},
                "checks_performed": [],
                "deviation_log": [
                    "Open reasoning skipped: ticket lacks minimum extractable entities "
                    "(no identity, application, or actionable description). "
                    "Manual triage required."
                ],
                "sequence_hint": [],
                "had_deviation": False,
            }

        evidence: dict[str, Any] = {
            "caller_id": caller_id,
            "application": application,
            "scenario": scenario,
        }
        checks_performed: list[str] = []
        deviation_log: list[str] = [
            "Entered open reasoning tier: classification confidence below threshold"
        ]
        tool_calls_used = 0

        while tool_calls_used < MAX_OPEN_REASONING_TOOL_CALLS:
            actions = await self._ask_claude_for_next_checks(
                ticket=ticket,
                evidence=evidence,
                already_checked=checks_performed,
                budget=MAX_OPEN_REASONING_TOOL_CALLS - tool_calls_used,
                mode="open",
            )

            if not actions or actions[0].tool_name == "DONE":
                # Claude returned DONE (or is unavailable). Try a structured fallback
                # before giving up — this keeps the agent functional even without an API key.
                fallback = self._get_fallback_action(
                    caller_id, application, scenario, evidence, checks_performed
                )
                if fallback:
                    deviation_log.append(
                        f"Open: Claude unavailable/DONE, using fallback: {fallback.tool_name}"
                    )
                    actions = [fallback]
                else:
                    deviation_log.append(
                        f"Open: Claude signalled DONE — "
                        f"{actions[0].rationale if actions else 'no action'}"
                    )
                    break

            action = actions[0]  # open mode: one tool at a time
            result = await self._call_tool_safe_raw(action.tool_name, action.tool_input)
            tool_calls_used += 1
            checks_performed.append(action.tool_name)
            deviation_log.append(
                f"Open [{tool_calls_used}]: {action.tool_name} — {action.rationale}"
            )

            if result.is_error:
                deviation_log.append(f"  └─ error: {result.error_message}")
                continue

            evidence[action.tool_name] = result.data
            found = evaluate_free(result.data, evidence)
            if found:
                rca_code, confidence_str = found
                return {
                    "rca_code": rca_code,
                    "rca_detail": result.data,
                    "evidence": evidence,
                    "checks_performed": checks_performed,
                    "deviation_log": deviation_log,
                    "sequence_hint": [],
                    "had_deviation": False,
                }

        if tool_calls_used >= MAX_OPEN_REASONING_TOOL_CALLS:
            deviation_log.append(
                f"Open: budget exhausted ({MAX_OPEN_REASONING_TOOL_CALLS} calls)"
            )

        return {
            "rca_code": "UNKNOWN_STATUS",
            "rca_detail": {},
            "evidence": evidence,
            "checks_performed": checks_performed,
            "deviation_log": deviation_log,
            "sequence_hint": [],
            "had_deviation": False,
        }

    # ── Claude integration ────────────────────────────────────────────────────

    async def _ask_claude_for_next_checks(
        self,
        ticket: dict,
        evidence: dict,
        already_checked: list[str],
        budget: int,
        mode: str = "adaptive",
    ) -> list[ToolAction]:
        """
        Call Claude to decide which tool(s) to call next.
        Returns a list of ToolAction; may return [ToolAction("DONE",...)] to stop.
        """
        if self._anthropic_client is None:
            import anthropic
            self._anthropic_client = anthropic.AsyncAnthropic()

        system_prompt = f"""You are an IAM incident analyst for a SailPoint IdentityIQ RCA engine.
Your task is to determine which diagnostic tool(s) to call next to identify the root cause of an IAM incident.

Mode: {mode.upper()}
{"The standard decision-tree sequence ran but found no root cause. Reason about what to check next based on the evidence." if mode == "adaptive" else "No standard sequence applies. Reason from scratch about what to investigate."}

Available tools:
{json.dumps(ALL_TOOL_DESCRIPTIONS, indent=2)}

Rules:
- Only call tools from the list above
- Always include the 'scenario' value from the ticket in tool_input if it is non-empty
- Do not repeat tools already in already_checked unless the first call returned an error
- NEVER return DONE unless you have called at least one tool OR the evidence already contains a clear root cause
- For iiq_workflow_get_status, extract workflow_id from the workflowCaseId field in access request evidence

Investigation strategy by symptom:
1. "no access" / "access request" / "pending" / "not approved":
   iiq_identity_get → iiq_request_search → iiq_workflow_get_status (using workflowCaseId from request) → iiq_provisioning_search_transactions
2. "aggregation" / "stale data" / "sync" / "task fail":
   iiq_task_get_results → iiq_task_check_freshness
3. "new hire" / "onboarding" / "joiner":
   iiq_identity_get → iiq_task_get_results
4. "terminated" / "leaver" / "deprovision":
   iiq_identity_get → iiq_entitlement_get_all
5. Vague / unclear ticket:
   Start with iiq_identity_get for the caller_id, then follow clues in the result

Respond ONLY with a JSON array. Each element must be:
  {{"tool_name": "<name>", "tool_input": {{...}}, "rationale": "<why>"}}

To signal investigation complete (only after calling at least one tool):
  [{{"tool_name": "DONE", "tool_input": {{}}, "rationale": "<explanation>"}}]

No markdown, no text outside the JSON array."""

        user_message = f"""TICKET:
{json.dumps(ticket, indent=2)}

EVIDENCE COLLECTED SO FAR:
{json.dumps(evidence, indent=2)}

ALREADY CHECKED (avoid repeating unless errored):
{json.dumps(already_checked)}

REMAINING TOOL CALL BUDGET: {budget}

Which tool(s) should be called next? Return JSON array only."""

        try:
            response = await self._anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            text = response.content[0].text.strip()
            # Strip markdown code fences if present
            if text.startswith("```"):
                text = re.sub(r"^```\w*\n?", "", text)
                text = re.sub(r"\n?```$", "", text)
                text = text.strip()
            actions = json.loads(text)
            return [
                ToolAction(
                    tool_name=a["tool_name"],
                    tool_input=a.get("tool_input", {}),
                    rationale=a.get("rationale", ""),
                )
                for a in actions
            ]
        except Exception as exc:
            print(f"[rca_agent] _ask_claude_for_next_checks failed: {exc}", file=sys.stderr)
            return [ToolAction("DONE", {}, f"Claude call failed: {exc}")]

    # ── Tool call helpers ──────────────────────────────────────────────────────

    async def _call_tool_safe_raw(
        self, tool_name: str, tool_input: dict
    ) -> _ToolResult:
        """Directly call an MCP tool by name with caller-supplied args."""
        try:
            data = await self.mcp.call_tool(tool_name, tool_input)
            return _ToolResult(is_error=False, data=data)
        except Exception as exc:
            return _ToolResult(is_error=True, data={}, error_message=str(exc))

    async def _execute_parallel_checks(
        self,
        steps: list[tuple[str, str]],
        context: dict,
        check_defs: list[dict],
    ) -> dict[str, Any]:
        """Execute multiple independent checks concurrently."""
        async def run_one(step: str, tool_name: str, check_def: dict) -> tuple[str, Any]:
            try:
                result = await self._execute_check(step, tool_name, context, check_def)
                return step, result
            except Exception as exc:
                return step, {"error": str(exc)}

        tasks = [run_one(s, t, cd) for (s, t), cd in zip(steps, check_defs)]
        results = await asyncio.gather(*tasks, return_exceptions=False)
        return dict(results)

    async def _execute_check(
        self,
        step: str,
        tool_name: str,
        context: dict,
        check_def: dict,
    ) -> Any:
        """Execute a single MCP tool call, building args from context."""
        caller_id = context.get("caller_id", "")
        application = context.get("application", "")
        scenario = context.get("scenario", "")

        if step == "A1":
            args = {"identity_id": caller_id, "include_roles": True, "include_entitlements": False}
        elif step == "A2":
            args = {"identity_id": caller_id}
        elif step == "B1":
            args = {
                "identity_id": caller_id,
                "status": "All",
                "days_back": 30,
                **({"application": application} if application else {}),
                **({"scenario": scenario} if scenario else {}),
            }
        elif step == "B2":
            b1 = context.get("result_B1", {})
            requests = b1.get("requests", [])
            if not requests:
                return {"error": "No request found to get details for"}
            args = {"request_id": requests[0].get("id")}
        elif step == "C1":
            b1 = context.get("result_B1", {})
            requests = b1.get("requests", [])
            if not requests:
                return {"error": "No workflow ID available"}
            workflow_id = requests[0].get("workflowCaseId")
            if not workflow_id:
                return {"error": "No workflow ID in request"}
            args = {"workflow_id": workflow_id}
        elif step == "D1":
            args = {
                "identity_id": caller_id,
                "status": "Failed",
                "days_back": 14,
                **({"application": application} if application else {}),
                **({"scenario": scenario} if scenario else {}),
            }
        elif step == "D2":
            d1 = context.get("result_D1", {})
            transactions = d1.get("transactions", [])
            if not transactions:
                return {"error": "No transaction to get details for"}
            args = {"transaction_id": transactions[0]["id"]}
        elif step == "E1":
            args = {
                "identity_id": caller_id,
                **({"application": application} if application else {}),
            }
        elif step == "E2":
            args = {
                "identity_id": caller_id,
                "entitlement_name": context.get("target_entitlement", ""),
                "application": application,
            }
        elif step == "F1":
            target_app = application or context.get("hr_system", "Workday")
            args = {
                "application": target_app,
                "task_type": "Aggregation",
                "limit": 5,
                **({"scenario": scenario} if scenario else {}),
            }
        elif step == "F2":
            target_app = application or ""
            if not target_app:
                d1 = context.get("result_D1", {})
                txns = d1.get("transactions", [])
                if txns:
                    target_app = txns[0].get("applicationName", "")
            args = {
                "application": target_app,
                "expected_frequency_hours": 24,
                **({"scenario": scenario} if scenario else {}),
            }
        else:
            args = {}

        return await self.mcp.call_tool(tool_name, args)

    # ── Stop condition evaluation (Tier 1) ────────────────────────────────────

    def _evaluate_stop_conditions(
        self,
        step: str,
        result: Any,
        check_def: dict,
        context: dict,
    ) -> tuple[Optional[str], dict]:
        """
        Evaluate whether this check result matches a stop condition.
        Returns (rca_code, detail_dict) or (None, {}) to continue.
        """
        stop_conditions = check_def.get("stop_conditions", [])
        if not stop_conditions:
            return None, {}

        if step == "A1":
            if isinstance(result, dict):
                if not result.get("exists", True) and result.get("exists") is False:
                    incident_type = context.get("incident_type")
                    if incident_type == IncidentType.JOINER:
                        return "JOINER_IDENTITY_MISSING", result
                    return "IDENTITY_NOT_FOUND", result
                if not result.get("active", True):
                    incident_type = context.get("incident_type")
                    start_date_str = result.get("startDate")
                    if start_date_str:
                        try:
                            start_date = datetime.fromisoformat(start_date_str.replace("Z", "+00:00"))
                            if start_date.tzinfo is None:
                                start_date = start_date.replace(tzinfo=timezone.utc)
                            if start_date > datetime.now(timezone.utc):
                                return "JOINER_NOT_YET_STARTED", {"start_date": start_date_str}
                        except (ValueError, TypeError):
                            pass
                    lifecycle = result.get("lifecycleState", "")
                    if lifecycle in ("terminated", "inactive", "pre-hire"):
                        if incident_type == IncidentType.JOINER:
                            return "JOINER_NOT_YET_STARTED", result
                        if incident_type == IncidentType.LEAVER:
                            pass  # Continue to E1 — need to check for active entitlements
                        else:
                            return "IDENTITY_INACTIVE", result

        elif step == "B1":
            if isinstance(result, dict):
                requests = result.get("requests", [])
                if not requests or result.get("total", 0) == 0:
                    return "NO_ACCESS_REQUEST_FOUND", result
                req = requests[0]
                status = req.get("status", "").lower()
                if status == "rejected":
                    return "REQUEST_REJECTED", req
                if req.get("workflowCaseId"):
                    context["workflow_id"] = req["workflowCaseId"]

        elif step == "C1":
            if isinstance(result, dict) and "error" not in result:
                status = result.get("status", "").lower()
                current_step = result.get("currentStep", "").lower()
                age_hours = result.get("ageHours", 0) or 0
                if status == "running" and ("approval" in current_step or "wait" in current_step):
                    steps = result.get("steps", [])
                    waiting_on = None
                    for s in steps:
                        if s.get("status") == "Waiting":
                            waiting_on = s.get("waitingOn")
                            break
                    context["approver"] = waiting_on
                    context["approval_age_hours"] = age_hours
                    return "APPROVAL_PENDING_MANAGER", {
                        "approver": waiting_on,
                        "age_hours": age_hours,
                        "workflow_id": result.get("id"),
                    }
                if status == "failed":
                    pass  # Fall through to D1

        elif step == "D1":
            if isinstance(result, dict):
                transactions = result.get("transactions", [])
                if transactions:
                    tx = transactions[0]
                    error_msgs = tx.get("errorMessages", [])
                    error_text = " ".join(error_msgs).lower()
                    if "member limit" in error_text or "quota" in error_text or "api_error" in error_text:
                        return "PROVISIONING_API_LIMIT", tx
                    if "timeout" in error_text or "timed out" in error_text:
                        return "PROVISIONING_TIMEOUT", tx
                    if "duplicate" in error_text or "already exists" in error_text:
                        return "PROVISIONING_ACCOUNT_EXISTS", tx
                    if "sod" in error_text or "segregation" in error_text:
                        return "PROVISIONING_SOD_VIOLATION", tx
                    if tx.get("status") == "Failed":
                        return "PROVISIONING_CONNECTOR_ERROR", tx

        elif step == "E1":
            if isinstance(result, dict):
                total = result.get("total", 0)
                entitlements = result.get("entitlements", [])
                a1 = context.get("result_A1", {})
                if not a1.get("active", True) and total > 0:
                    lifecycle = a1.get("lifecycleState", "")
                    if lifecycle in ("terminated", "inactive"):
                        return "LEAVER_ACCESS_NOT_REVOKED", {
                            "entitlements_count": total,
                            "entitlements": entitlements[:5],
                        }

        elif step == "F1":
            if isinstance(result, dict):
                consecutive = result.get("consecutive_failures", 0)
                tasks = result.get("tasks", [])
                total = result.get("total", 0)
                if total == 0:
                    return "AGGREGATION_NEVER_RUN", result
                if consecutive >= 3:
                    return "AGGREGATION_REPEATED_FAILURES", {
                        "consecutive_failures": consecutive,
                        "last_error": result.get("last_error"),
                    }
                for task in tasks:
                    msgs = " ".join(m.get("text", "") for m in task.get("messages", []))
                    if "401" in msgs or "unauthorized" in msgs.lower() or "authentication" in msgs.lower():
                        return "AGGREGATION_REPEATED_FAILURES", {
                            "error": "Authentication failure on HR aggregation",
                            "task": task.get("name"),
                        }

        elif step == "F2":
            if isinstance(result, dict):
                assessment = result.get("assessment", "")
                if assessment == "NEVER_RUN":
                    return "AGGREGATION_NEVER_RUN", result
                if assessment == "STALE":
                    return "AGGREGATION_STALE_DATA", {
                        "age_hours": result.get("age_hours"),
                        "expected_frequency_hours": result.get("expected_frequency_hours"),
                        "application": result.get("application"),
                    }
                if result.get("consecutive_failures", 0) >= 3:
                    return "AGGREGATION_REPEATED_FAILURES", result

        return None, {}

    # ── Report builder ────────────────────────────────────────────────────────

    def _build_final_report(
        self,
        result: dict,
        execution_tier: str,
        duration_ms: int,
        classification: Classification,
    ) -> dict:
        rca_code = result["rca_code"]
        rca_def = RCA_CATALOG.get(rca_code, RCA_CATALOG["UNKNOWN_STATUS"])
        context = result.get("context", result.get("evidence", {}))

        report = {
            "rca_code": rca_code,
            "confidence": rca_def.default_confidence,
            "summary": self._build_summary(rca_code, rca_def, context),
            "root_cause": rca_def.description,
            "evidence": result["evidence"],
            "recommendation": self._build_recommendation(
                rca_code, rca_def, context, result.get("rca_detail", {})
            ),
            "auto_resolvable": rca_def.auto_resolvable,
            "auto_resolution_action": rca_def.auto_resolution_action,
            "escalation_path": rca_def.escalation_path,
            "checks_performed": result["checks_performed"],
            "rca_duration_ms": duration_ms,
            # New hybrid fields
            "execution_tier": execution_tier,
            "deviation_log": result.get("deviation_log", []),
            "sequence_hint": result.get("sequence_hint", []),
        }
        return report

    # ── Summary and recommendation builders (unchanged) ───────────────────────

    def _build_summary(self, rca_code: str, rca_def: RCACodeDefinition, context: dict) -> str:
        caller = context.get("caller_id", "the user")
        app = context.get("application", "the requested application")

        summaries = {
            "IDENTITY_NOT_FOUND": f"Identity '{caller}' does not exist in IdentityIQ.",
            "IDENTITY_INACTIVE": f"Identity '{caller}' is inactive or terminated in IdentityIQ.",
            "NO_ACCESS_REQUEST_FOUND": f"No access request found in IdentityIQ for '{caller}'.",
            "REQUEST_REJECTED": f"The access request for '{caller}' was rejected by an approver.",
            "APPROVAL_PENDING_MANAGER": (
                f"The access request for '{caller}' is waiting for manager approval "
                f"(approver: {context.get('approver', 'unknown')})."
            ),
            "PROVISIONING_CONNECTOR_ERROR": (
                f"Provisioning to {app} failed due to a connector error "
                f"(insufficient permissions or misconfiguration)."
            ),
            "PROVISIONING_API_LIMIT": (
                f"Provisioning to {app} failed because the target system quota or API limit was reached."
            ),
            "PROVISIONING_TIMEOUT": (
                f"Provisioning to {app} timed out — likely a transient connectivity issue."
            ),
            "AGGREGATION_STALE_DATA": (
                f"Aggregation data for {app} is stale — IIQ may not reflect the current state "
                f"of the target system."
            ),
            "AGGREGATION_REPEATED_FAILURES": (
                f"Aggregation for {app} has failed 3 or more consecutive times — "
                f"the connector is likely broken."
            ),
            "AGGREGATION_NEVER_RUN": (
                f"No aggregation has ever run for {app} — setup may be incomplete."
            ),
            "JOINER_NOT_YET_STARTED": (
                f"The new hire '{caller}' has a future start date — "
                f"provisioning has not yet been triggered."
            ),
            "JOINER_IDENTITY_MISSING": (
                f"New hire '{caller}' has not been synced from the HR system to IdentityIQ."
            ),
            "LEAVER_ACCESS_NOT_REVOKED": (
                f"Terminated user '{caller}' still has active entitlements — de-provisioning failed."
            ),
            "UNKNOWN_STATUS": (
                f"All checks for '{caller}' passed — no root cause identified. "
                f"Manual investigation required."
            ),
            "INSUFFICIENT_TICKET_DATA": (
                "The ticket does not contain enough information to run automated diagnostics. "
                "Please resubmit with a valid username, application name, or a clearer description."
            ),
        }
        return summaries.get(rca_code, rca_def.description)

    def _build_recommendation(
        self, rca_code: str, rca_def: RCACodeDefinition, context: dict, detail: dict
    ) -> str:
        app = context.get("application", "the application")

        recommendations = {
            "IDENTITY_NOT_FOUND": (
                "Verify the username is correct. Check if the HR aggregation task has run recently. "
                "If the user is new, wait for the next HR sync or trigger an on-demand aggregation."
            ),
            "IDENTITY_INACTIVE": (
                "Verify with HR if this is an intentional termination or leave. "
                "If incorrect, update the HR record and re-run identity aggregation."
            ),
            "NO_ACCESS_REQUEST_FOUND": (
                "Direct the user to submit an access request via the IIQ self-service portal "
                "or ServiceNow catalog item."
            ),
            "REQUEST_REJECTED": (
                "Review the rejection reason in IIQ and advise the user. "
                "They must submit a new request with proper business justification."
            ),
            "APPROVAL_PENDING_MANAGER": (
                f"Send an approval reminder to the manager ({context.get('approver', 'approver')}). "
                f"If no action after 72 hours, escalate to IAM-Ops."
            ),
            "PROVISIONING_CONNECTOR_ERROR": (
                f"Check the IIQ service account permissions on {app}. "
                f"Review the connector configuration and retry the provisioning transaction."
            ),
            "PROVISIONING_API_LIMIT": (
                f"Contact the {app} administrator to increase the quota or remove inactive members. "
                f"Once resolved, retry the provisioning transaction."
            ),
            "PROVISIONING_TIMEOUT": (
                f"The provisioning timed out — this may be transient. Retry the transaction. "
                f"If it recurs, check network connectivity to {app}."
            ),
            "AGGREGATION_STALE_DATA": (
                f"Trigger an on-demand aggregation for {app} and wait 15 minutes. "
                f"Re-check the user's entitlements after aggregation completes."
            ),
            "AGGREGATION_REPEATED_FAILURES": (
                f"Investigate the aggregation task errors for {app}. "
                f"Check connectivity, service account credentials, and connector configuration."
            ),
            "AGGREGATION_NEVER_RUN": (
                f"An aggregation task has never run for {app}. "
                f"Verify the application is configured in IIQ and schedule an aggregation task."
            ),
            "JOINER_NOT_YET_STARTED": (
                "Provisioning will be triggered automatically on the employee's start date. "
                "No action required at this time."
            ),
            "JOINER_IDENTITY_MISSING": (
                "Verify the employee record exists in the HR system. "
                "Trigger an HR aggregation task to sync the new hire to IIQ."
            ),
            "LEAVER_ACCESS_NOT_REVOKED": (
                "URGENT: Manually disable all accounts for this terminated user immediately. "
                "Investigate why the automated de-provisioning workflow failed."
            ),
            "UNKNOWN_STATUS": (
                "All automated checks passed without identifying a root cause. "
                "Escalate to the IAM-L3 team for manual investigation with the collected evidence."
            ),
            "INSUFFICIENT_TICKET_DATA": (
                "Return the ticket to the submitter and request: (1) the affected username, "
                "(2) the application name, and (3) a description of the specific issue. "
                "Once the ticket has actionable entities, resubmit for automated analysis."
            ),
        }
        return recommendations.get(rca_code, f"Follow escalation path: {rca_def.escalation_path}")
