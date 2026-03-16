// ─── SailPoint IdentityIQ TypeScript Interfaces ───────────────────────────────
// All types used across MCP tools, the IIQ client, and RCA engine outputs.
// Based on Part 5 of the SailPoint RCA Agent project documentation.

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Primitives
// ═══════════════════════════════════════════════════════════════════════════════

export interface IIQIdentityRef {
  id: string;
  userName: string;
  displayName: string;
}

export interface IIQApplicationRef {
  id: string;
  displayName: string;
}

export interface IIQRole {
  id: string;
  displayName: string;
  type: 'business' | 'it';
}

export interface IIQEntitlement {
  id: string;
  displayName: string;
  value: string;
  application: IIQApplicationRef;
  type: 'group' | 'role' | 'profile' | 'permission';
}

export interface IIQApproval {
  approver: string;
  displayName: string;
  decision: 'Approved' | 'Rejected' | 'Pending' | 'Expired';
  timestamp?: string;
  comments?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RCA Output — the top-level report returned by the RCA engine
// ═══════════════════════════════════════════════════════════════════════════════

export interface RCAReport {
  /** One of the 8 canonical RCA codes (or UNKNOWN / NO_ISSUE) */
  rca_code: string;
  /** Confidence in the diagnosis */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** 1-2 sentence human-readable summary */
  summary: string;
  /** Detailed root cause explanation */
  root_cause: string;
  /** Key evidence collected during investigation (tool outputs) */
  evidence: Record<string, unknown>;
  /** Actionable remediation steps */
  recommendation: string;
  /** Whether the agent can resolve this automatically */
  auto_resolvable: boolean;
  /** Action to take if auto_resolvable (e.g. 'escalate_approval', 'retry_provisioning') */
  auto_resolution_action?: string;
  /** Who/what team to escalate to if not auto-resolvable */
  escalation_path?: string;
  /** List of tool names called during investigation */
  checks_performed: string[];
  /** Total wall-clock time of the RCA investigation in milliseconds */
  rca_duration_ms: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool A1 / A2 — Identity Profile
// ═══════════════════════════════════════════════════════════════════════════════

export interface IIQIdentityProfile {
  id: string;
  userName: string;
  displayName: string;
  active: boolean;
  emails: Array<{ value: string; type: string; primary: boolean }>;
  employeeNumber?: string;
  department?: string;
  title?: string;
  location?: string;
  manager?: IIQIdentityRef;
  lifecycleState?: string;
  workerType?: string;
  riskScore?: number;
  roles?: IIQRole[];
  entitlements?: IIQEntitlement[];
  /** ISO date string for pre-hire identities (JOINER scenario) */
  startDate?: string;
  /** ISO date string for terminated identities (LEAVER scenario) */
  terminationDate?: string;
  meta: {
    resourceType: string;
    created: string;
    lastModified: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool B1 — Access Request
// ═══════════════════════════════════════════════════════════════════════════════

export interface IIQAccessRequestItem {
  type: string;
  name: string;
  application?: string;
  operation: string;
  approvalState: string;
  currentApprover?: string;
}

export interface IIQAccessRequest {
  id: string;
  status: string;
  created: string;
  requester: IIQIdentityRef;
  target: IIQIdentityRef;
  items: IIQAccessRequestItem[];
  workflowCaseId?: string;
  priority: string;
  comments?: string;
  approvalHistory?: IIQApproval[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool C1 — Workflow Instance
// ═══════════════════════════════════════════════════════════════════════════════

export interface IIQWorkflowStep {
  name: string;
  status: 'Complete' | 'Failed' | 'Waiting' | 'Running' | 'Skipped';
  completedAt?: string;
  error?: string;
  waitingOn?: string;
  approvals?: IIQApproval[];
}

export interface IIQWorkflowInstance {
  id: string;
  name: string;
  status: 'Running' | 'Complete' | 'Failed' | 'Terminated';
  currentStep: string;
  launched: string;
  completed?: string;
  target: { name: string };
  steps: IIQWorkflowStep[];
  errorMessages?: string[];
  /** Convenience field: age of the workflow in hours */
  ageHours?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool D1 / D2 — Provisioning Transactions
// ═══════════════════════════════════════════════════════════════════════════════

export interface IIQAttributeRequest {
  name: string;
  value: string | string[];
  operation: 'Set' | 'Add' | 'Remove';
}

export interface IIQProvisioningTransaction {
  id: string;
  identityName: string;
  applicationName: string;
  operation: string;
  status: string;
  created: string;
  nativeIdentity?: string | null;
  integrationConfig: string;
  errorMessages: string[];
  accountRequest: {
    application: string;
    nativeIdentity?: string | null;
    operation: string;
    attributeRequests: IIQAttributeRequest[];
  };
  retryCount: number;
  workflowCaseId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool E1 — Entitlements Output
// ═══════════════════════════════════════════════════════════════════════════════

export interface E1Output {
  identity: { id: string; userName: string };
  entitlements: IIQEntitlement[];
  total: number;
  /** Entitlements grouped by application displayName */
  by_application: Record<string, IIQEntitlement[]>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool F1 — Task Results Output
// ═══════════════════════════════════════════════════════════════════════════════

export interface IIQTaskResult {
  id: string;
  name: string;
  type: string;
  status: 'Success' | 'Error' | 'Warning' | 'Running';
  application: string;
  launched: string;
  completed?: string | null;
  durationMillis: number;
  statistics: {
    total: number;
    created: number;
    updated: number;
    deleted: number;
    errors: number;
  };
  messages: Array<{ type: string; text: string }>;
}

export interface F1Output {
  tasks: IIQTaskResult[];
  total: number;
  /** ISO timestamp of the most recent successful task completion */
  last_success?: string;
  /** ISO timestamp of the most recent failed task completion */
  last_error?: string;
  /** How many consecutive failures appear before any success */
  consecutive_failures: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool F2 — Aggregation Freshness Output
// ═══════════════════════════════════════════════════════════════════════════════

export interface F2Output {
  application: string;
  /** True if the most recent aggregation is within the staleness threshold */
  is_fresh: boolean;
  /** ISO timestamp of the last aggregation completion */
  last_aggregation?: string;
  /** Age of the last aggregation in hours */
  age_hours?: number;
  /** Expected aggregation frequency for this application (hours) */
  expected_frequency_hours: number;
  /** Threshold beyond which data is considered stale (hours) */
  staleness_threshold_hours: number;
  /** Freshness assessment */
  assessment: 'FRESH' | 'STALE' | 'NEVER_RUN' | 'RUNNING';
  /** Consecutive failures before the last successful aggregation */
  consecutive_failures: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCIM API Response Shapes (used by IIQ client)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ScimListResponse<T> {
  totalResults: number;
  itemsPerPage: number;
  startIndex: number;
  schemas: string[];
  Resources: T[];
}

export interface ScimError {
  schemas: string[];
  status: string;
  detail: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// IIQ REST API Response Shapes
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProvisioningTransactionsResponse {
  count: number;
  provisioningTransactions: IIQProvisioningTransaction[];
}

export interface TaskResultsResponse {
  count: number;
  taskResults: IIQTaskResult[];
}

export interface AccessRequestsResponse {
  count: number;
  accessRequests: IIQAccessRequest[];
}
