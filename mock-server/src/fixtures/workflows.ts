// ─── Workflow Fixtures ────────────────────────────────────────────────────────
// Two shapes are maintained per workflow:
//   1. SCIM LaunchedWorkflow — returned by GET /scim/v2/LaunchedWorkflows
//   2. REST workflowInstance  — returned by GET /rest/workflowInstances/:id
// Both shapes are defined and exported here.

// ─── Timestamp Helpers ────────────────────────────────────────────────────────
// Computed at module load time so offsets are accurate at runtime.

const hoursAgo = (h: number): string =>
  new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

const WF12345_LAUNCHED = hoursAgo(125); // stuck approval — 125 h ago
const WF22222_LAUNCHED = hoursAgo(72);  // failed provisioning — 3 days ago
const WF33333_LAUNCHED = hoursAgo(48);  // mary.johnson GitHub failure
const WF44444_LAUNCHED = hoursAgo(360); // terminated.user leaver failure — 15 days ago
const WF55555_LAUNCHED = hoursAgo(96);  // bob.smith complete — 4 days ago
const WF55555_COMPLETED = hoursAgo(93); // completed 3 h after launch

// ─── SCIM LaunchedWorkflow Shape ─────────────────────────────────────────────

export interface ScimWorkflowApproval {
  status: 'Pending' | 'Approved' | 'Rejected' | 'Expired';
  approvers: Array<{ id: string; displayName: string; decision?: string }>;
}

export interface ScimWorkflowRequestedItem {
  type: 'Role' | 'Entitlement' | 'Account';
  name: string;
  operation: 'Add' | 'Remove' | 'Modify';
}

export interface ScimLaunchedWorkflow {
  id: string;
  workflowName: string;
  launcher: string;
  target: { id: string; userName: string; displayName: string };
  launched: string;
  completed: string | null;
  completionStatus: 'Pending' | 'Success' | 'Failed' | 'Error' | 'Complete';
  currentStep: string;
  requestedItems: ScimWorkflowRequestedItem[];
  approvalSummary: ScimWorkflowApproval;
  errorMessages: string[];
}

// ─── REST workflowInstance Shape ─────────────────────────────────────────────

export interface RestWorkflowStep {
  name: string;
  status: 'Complete' | 'Failed' | 'Waiting' | 'Running' | 'Skipped';
  completedAt?: string;
  error?: string;
  waitingOn?: string;
}

export interface RestWorkflowInstance {
  id: string;
  name: string;
  status: 'Running' | 'Complete' | 'Failed' | 'Terminated';
  currentStep: string;
  launched: string;
  completed?: string;
  target: { name: string };
  steps: RestWorkflowStep[];
  errorMessages?: string[];
  ageHours?: number;
}

// ─── SCIM Workflow Records ────────────────────────────────────────────────────

export const SCIM_WORKFLOWS: Record<string, ScimLaunchedWorkflow> = {
  'WF-12345': {
    id: 'WF-12345',
    workflowName: 'LCM Provisioning',
    launcher: 'john.doe',
    target: {
      id: 'user-uuid-john-doe-001',
      userName: 'john.doe',
      displayName: 'John Doe',
    },
    launched: WF12345_LAUNCHED,
    completed: null,
    completionStatus: 'Pending',
    currentStep: 'Wait for Approval',
    requestedItems: [
      { type: 'Role', name: 'Finance User', operation: 'Add' },
    ],
    approvalSummary: {
      status: 'Pending',
      approvers: [
        { id: 'user-uuid-jane-manager-010', displayName: 'Jane Manager', decision: 'Pending' },
      ],
    },
    errorMessages: [],
  },

  'WF-22222': {
    id: 'WF-22222',
    workflowName: 'LCM Provisioning',
    launcher: 'john.doe',
    target: {
      id: 'user-uuid-john-doe-001',
      userName: 'john.doe',
      displayName: 'John Doe',
    },
    launched: WF22222_LAUNCHED,
    completed: hoursAgo(70),
    completionStatus: 'Failed',
    currentStep: 'Provision',
    requestedItems: [
      { type: 'Role', name: 'Finance User', operation: 'Add' },
    ],
    approvalSummary: {
      status: 'Approved',
      approvers: [
        { id: 'user-uuid-jane-manager-010', displayName: 'Jane Manager', decision: 'Approved' },
      ],
    },
    errorMessages: [
      'Provisioning to Active Directory failed: javax.naming.NoPermissionException: [LDAP: error code 50]',
    ],
  },

  'WF-33333': {
    id: 'WF-33333',
    workflowName: 'LCM Provisioning',
    launcher: 'mary.johnson',
    target: {
      id: 'user-uuid-mary-johnson-002',
      userName: 'mary.johnson',
      displayName: 'Mary Johnson',
    },
    launched: WF33333_LAUNCHED,
    completed: hoursAgo(46),
    completionStatus: 'Failed',
    currentStep: 'Provision',
    requestedItems: [
      { type: 'Entitlement', name: 'engineering-team', operation: 'Add' },
    ],
    approvalSummary: {
      status: 'Approved',
      approvers: [
        { id: 'user-uuid-bob-lead-011', displayName: 'Bob Lead', decision: 'Approved' },
      ],
    },
    errorMessages: [
      'Provisioning to GitHub Enterprise failed: API_ERROR: Organization member limit reached (500/500)',
    ],
  },

  'WF-44444': {
    id: 'WF-44444',
    workflowName: 'LCM Provisioning',
    launcher: 'system',
    target: {
      id: 'user-uuid-terminated-005',
      userName: 'terminated.user',
      displayName: 'Terminated User',
    },
    launched: WF44444_LAUNCHED,
    completed: hoursAgo(358),
    completionStatus: 'Failed',
    currentStep: 'Provision',
    requestedItems: [
      { type: 'Account', name: 'Disable Active Directory Account', operation: 'Modify' },
    ],
    approvalSummary: {
      status: 'Approved',
      approvers: [],
    },
    errorMessages: [
      'De-provisioning to Active Directory failed: Connection timeout after 30 seconds',
    ],
  },

  'WF-55555': {
    id: 'WF-55555',
    workflowName: 'LCM Provisioning',
    launcher: 'bob.smith',
    target: {
      id: 'user-uuid-bob-smith-003',
      userName: 'bob.smith',
      displayName: 'Bob Smith',
    },
    launched: WF55555_LAUNCHED,
    completed: WF55555_COMPLETED,
    completionStatus: 'Complete',
    currentStep: 'Complete',
    requestedItems: [
      { type: 'Entitlement', name: 'SAP_IT_USER', operation: 'Add' },
    ],
    approvalSummary: {
      status: 'Approved',
      approvers: [
        { id: 'user-uuid-it-manager-012', displayName: 'IT Manager', decision: 'Approved' },
      ],
    },
    errorMessages: [],
  },
};

// ─── REST Workflow Instance Records ──────────────────────────────────────────

export const REST_WORKFLOWS: Record<string, RestWorkflowInstance> = {
  'WF-12345': {
    id: 'WF-12345',
    name: 'LCM Provisioning',
    status: 'Running',
    currentStep: 'Wait for Approval',
    launched: WF12345_LAUNCHED,
    target: { name: 'john.doe' },
    steps: [
      {
        name: 'Initialize',
        status: 'Complete',
        completedAt: new Date(new Date(WF12345_LAUNCHED).getTime() + 30000).toISOString(),
      },
      {
        name: 'Compile Provisioning Request',
        status: 'Complete',
        completedAt: new Date(new Date(WF12345_LAUNCHED).getTime() + 60000).toISOString(),
      },
      {
        name: 'Get Approvals',
        status: 'Waiting',
        waitingOn: 'jane.manager',
      },
      {
        name: 'Provision',
        status: 'Waiting',
      },
      {
        name: 'Notify',
        status: 'Waiting',
      },
    ],
    errorMessages: [],
    ageHours: 125,
  },

  'WF-22222': {
    id: 'WF-22222',
    name: 'LCM Provisioning',
    status: 'Failed',
    currentStep: 'Provision',
    launched: WF22222_LAUNCHED,
    completed: hoursAgo(70),
    target: { name: 'john.doe' },
    steps: [
      {
        name: 'Initialize',
        status: 'Complete',
        completedAt: new Date(new Date(WF22222_LAUNCHED).getTime() + 30000).toISOString(),
      },
      {
        name: 'Compile Provisioning Request',
        status: 'Complete',
        completedAt: new Date(new Date(WF22222_LAUNCHED).getTime() + 60000).toISOString(),
      },
      {
        name: 'Get Approvals',
        status: 'Complete',
        completedAt: new Date(new Date(WF22222_LAUNCHED).getTime() + 3600000).toISOString(),
      },
      {
        name: 'Provision',
        status: 'Failed',
        error:
          'Provisioning to Active Directory failed: javax.naming.NoPermissionException: [LDAP: error code 50] Insufficient access rights to create account in OU=Finance,DC=company,DC=com',
        completedAt: hoursAgo(70),
      },
    ],
    errorMessages: [
      'Provisioning to Active Directory failed: javax.naming.NoPermissionException: [LDAP: error code 50]',
    ],
    ageHours: 72,
  },

  'WF-33333': {
    id: 'WF-33333',
    name: 'LCM Provisioning',
    status: 'Failed',
    currentStep: 'Provision',
    launched: WF33333_LAUNCHED,
    completed: hoursAgo(46),
    target: { name: 'mary.johnson' },
    steps: [
      {
        name: 'Initialize',
        status: 'Complete',
        completedAt: new Date(new Date(WF33333_LAUNCHED).getTime() + 30000).toISOString(),
      },
      {
        name: 'Compile Provisioning Request',
        status: 'Complete',
        completedAt: new Date(new Date(WF33333_LAUNCHED).getTime() + 60000).toISOString(),
      },
      {
        name: 'Get Approvals',
        status: 'Complete',
        completedAt: new Date(new Date(WF33333_LAUNCHED).getTime() + 7200000).toISOString(),
      },
      {
        name: 'Provision',
        status: 'Failed',
        error:
          'Provisioning to GitHub Enterprise failed: API_ERROR: Organization member limit reached (500/500). Upgrade plan or remove inactive members.',
        completedAt: hoursAgo(46),
      },
    ],
    errorMessages: [
      'Provisioning to GitHub Enterprise failed: API_ERROR: Organization member limit reached (500/500)',
    ],
    ageHours: 48,
  },

  'WF-44444': {
    id: 'WF-44444',
    name: 'LCM Provisioning',
    status: 'Failed',
    currentStep: 'Provision',
    launched: WF44444_LAUNCHED,
    completed: hoursAgo(358),
    target: { name: 'terminated.user' },
    steps: [
      {
        name: 'Initialize',
        status: 'Complete',
        completedAt: new Date(new Date(WF44444_LAUNCHED).getTime() + 30000).toISOString(),
      },
      {
        name: 'De-provision',
        status: 'Failed',
        error: 'Connection timeout after 30 seconds communicating with AD_Connector_PROD',
        completedAt: hoursAgo(358),
      },
    ],
    errorMessages: ['De-provisioning failed: Connection timeout after 30 seconds'],
    ageHours: 360,
  },

  'WF-55555': {
    id: 'WF-55555',
    name: 'LCM Provisioning',
    status: 'Complete',
    currentStep: 'Complete',
    launched: WF55555_LAUNCHED,
    completed: WF55555_COMPLETED,
    target: { name: 'bob.smith' },
    steps: [
      {
        name: 'Initialize',
        status: 'Complete',
        completedAt: new Date(new Date(WF55555_LAUNCHED).getTime() + 30000).toISOString(),
      },
      {
        name: 'Compile Provisioning Request',
        status: 'Complete',
        completedAt: new Date(new Date(WF55555_LAUNCHED).getTime() + 60000).toISOString(),
      },
      {
        name: 'Get Approvals',
        status: 'Complete',
        completedAt: new Date(new Date(WF55555_LAUNCHED).getTime() + 1800000).toISOString(),
      },
      {
        name: 'Provision',
        status: 'Complete',
        completedAt: new Date(new Date(WF55555_LAUNCHED).getTime() + 10800000).toISOString(),
      },
      {
        name: 'Notify',
        status: 'Complete',
        completedAt: WF55555_COMPLETED,
      },
    ],
    errorMessages: [],
    ageHours: 96,
  },
};

// ─── Lookup Helpers ───────────────────────────────────────────────────────────

// Map from identityUserName → workflow IDs
const IDENTITY_WORKFLOW_MAP: Record<string, string[]> = {
  'john.doe': ['WF-12345', 'WF-22222'],
  'mary.johnson': ['WF-33333'],
  'terminated.user': ['WF-44444'],
  'bob.smith': ['WF-55555'],
};

/**
 * Returns SCIM LaunchedWorkflow objects for a given identity.
 * For the access_request_stuck_approval scenario, ensures WF-12345 is returned.
 */
export function getWorkflowsByIdentity(
  identityId: string,
  scenario?: string
): ScimLaunchedWorkflow[] {
  const wfIds = IDENTITY_WORKFLOW_MAP[identityId] ?? [];
  return wfIds
    .map((id) => SCIM_WORKFLOWS[id])
    .filter((wf): wf is ScimLaunchedWorkflow => wf !== undefined);
}

/**
 * Returns a single SCIM LaunchedWorkflow by ID, or null if not found.
 */
export function getWorkflowById(
  workflowId: string,
  scenario?: string
): ScimLaunchedWorkflow | null {
  return SCIM_WORKFLOWS[workflowId] ?? null;
}

/**
 * Returns the REST workflowInstance for a given ID, or null if not found.
 */
export function getRestWorkflowById(workflowId: string): RestWorkflowInstance | null {
  return REST_WORKFLOWS[workflowId] ?? null;
}

/**
 * Returns all SCIM workflows as an array.
 */
export function getAllWorkflows(): ScimLaunchedWorkflow[] {
  return Object.values(SCIM_WORKFLOWS);
}
