// ─── IIQ REST API Router ──────────────────────────────────────────────────────
// Mounted at /identityiq/rest
// Implements the IIQ REST endpoints used by the RCA agent tools.

import { Router, Request, Response } from 'express';
import { getTransactionsByIdentity, getTransactionById, getAllTransactions, TRANSACTIONS } from '../fixtures/provisioning';
import { getTaskResults, TASK_RESULTS } from '../fixtures/tasks';
import { getRestWorkflowById } from '../fixtures/workflows';
import { getScenario } from '../fixtures/scenarios';
import { shouldBreak } from '../break-tool';

const router = Router();

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response): boolean {
  const auth = req.headers['authorization'];
  if (!auth) {
    res.status(401).json({
      status: 401,
      message: 'Authorization header is required.',
    });
    return false;
  }
  return true;
}

// ─── Inline Access Request Fixtures ──────────────────────────────────────────
// Access requests are defined here (not in a separate fixture file)
// because they are only consumed by the REST router.

interface AccessRequestItem {
  type: string;
  name: string;
  application?: string;
  operation: string;
  approvalState: string;
  currentApprover?: string;
}

interface ApprovalHistory {
  approver: string;
  displayName: string;
  decision: 'Approved' | 'Rejected' | 'Pending' | 'Expired';
  timestamp?: string;
  comments?: string;
}

interface AccessRequest {
  id: string;
  status: string;
  created: string;
  requester: { id: string; userName: string; displayName: string };
  target: { id: string; userName: string; displayName: string };
  items: AccessRequestItem[];
  workflowCaseId?: string;
  priority: string;
  comments?: string;
  approvalHistory?: ApprovalHistory[];
}

const ACCESS_REQUESTS: Record<string, AccessRequest> = {
  // ── Scenario 1: access_request_stuck_approval ─────────────────────────────
  // AR-77777: john.doe, SAP ECC, Finance User, Pending, WF-12345 (stuck 125h)
  'AR-77777': {
    id: 'AR-77777',
    status: 'Pending',
    created: new Date(Date.now() - 125 * 60 * 60 * 1000).toISOString(),
    requester: {
      id: 'user-uuid-john-doe-001',
      userName: 'john.doe',
      displayName: 'John Doe',
    },
    target: {
      id: 'user-uuid-john-doe-001',
      userName: 'john.doe',
      displayName: 'John Doe',
    },
    items: [
      {
        type: 'Role',
        name: 'Finance User',
        application: 'SAP ECC',
        operation: 'Add',
        approvalState: 'Pending',
        currentApprover: 'jane.manager',
      },
    ],
    workflowCaseId: 'WF-12345',
    priority: 'Normal',
    comments: 'Requesting access for Q1 reporting responsibilities.',
    approvalHistory: [
      {
        approver: 'jane.manager',
        displayName: 'Jane Manager',
        decision: 'Pending',
      },
    ],
  },

  // ── Scenario 2: provisioning_connector_error ──────────────────────────────
  // AR-77778: john.doe, Active Directory, Finance User, Approved, WF-22222 (failed provision)
  'AR-77778': {
    id: 'AR-77778',
    status: 'Approved',
    created: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    requester: {
      id: 'user-uuid-john-doe-001',
      userName: 'john.doe',
      displayName: 'John Doe',
    },
    target: {
      id: 'user-uuid-john-doe-001',
      userName: 'john.doe',
      displayName: 'John Doe',
    },
    items: [
      {
        type: 'Role',
        name: 'Finance User',
        application: 'Active Directory',
        operation: 'Add',
        approvalState: 'Approved',
      },
    ],
    workflowCaseId: 'WF-22222',
    priority: 'Normal',
    approvalHistory: [
      {
        approver: 'jane.manager',
        displayName: 'Jane Manager',
        decision: 'Approved',
        timestamp: new Date(Date.now() - 70 * 60 * 60 * 1000).toISOString(),
        comments: 'Approved for Finance team access.',
      },
    ],
  },

  // ── Scenario 3: github_api_limit ──────────────────────────────────────────
  // AR-88888: mary.johnson, GitHub Enterprise, engineering-team, Approved, WF-33333 (failed)
  'AR-88888': {
    id: 'AR-88888',
    status: 'Approved',
    created: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    requester: {
      id: 'user-uuid-mary-johnson-002',
      userName: 'mary.johnson',
      displayName: 'Mary Johnson',
    },
    target: {
      id: 'user-uuid-mary-johnson-002',
      userName: 'mary.johnson',
      displayName: 'Mary Johnson',
    },
    items: [
      {
        type: 'Entitlement',
        name: 'engineering-team',
        application: 'GitHub Enterprise',
        operation: 'Add',
        approvalState: 'Approved',
      },
    ],
    workflowCaseId: 'WF-33333',
    priority: 'Normal',
    approvalHistory: [
      {
        approver: 'bob.lead',
        displayName: 'Bob Lead',
        decision: 'Approved',
        timestamp: new Date(Date.now() - 46 * 60 * 60 * 1000).toISOString(),
        comments: 'Approved for Engineering team GitHub access.',
      },
    ],
  },

  // ── Scenario 8: unknown_all_checks_pass ───────────────────────────────────
  // AR-99999: bob.smith, SAP ECC, Finance User role, Approved, WF-55555 (complete)
  'AR-99999': {
    id: 'AR-99999',
    status: 'Approved',
    created: new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString(),
    requester: {
      id: 'user-uuid-bob-smith-003',
      userName: 'bob.smith',
      displayName: 'Bob Smith',
    },
    target: {
      id: 'user-uuid-bob-smith-003',
      userName: 'bob.smith',
      displayName: 'Bob Smith',
    },
    items: [
      {
        type: 'Role',
        name: 'Finance User',
        application: 'SAP ECC',
        operation: 'Add',
        approvalState: 'Approved',
      },
    ],
    workflowCaseId: 'WF-55555',
    priority: 'Normal',
    approvalHistory: [
      {
        approver: 'it.manager',
        displayName: 'IT Manager',
        decision: 'Approved',
        timestamp: new Date(Date.now() - 94 * 60 * 60 * 1000).toISOString(),
        comments: 'Approved for Finance reporting access.',
      },
    ],
  },
};

// ─── Scenario → Access Request ID mapping ─────────────────────────────────────
// Maps scenario name to the single "primary" access request that should be
// returned for that scenario (when filtering by identity + scenario).

const SCENARIO_AR_MAP: Record<string, string[]> = {
  access_request_stuck_approval: ['AR-77777'],
  provisioning_connector_error: ['AR-77778'],
  github_api_limit: ['AR-88888'],
  unknown_all_checks_pass: ['AR-99999'],
  // These scenarios return no access requests:
  aggregation_stale: [],
  identity_not_found: [],
  joiner_not_started: [],
  leaver_access_not_revoked: [],
};

// Default identity → access request IDs (used when no scenario param present)
const IDENTITY_AR_MAP: Record<string, string[]> = {
  'john.doe': ['AR-77777', 'AR-77778'],
  'mary.johnson': ['AR-88888'],
  'bob.smith': ['AR-99999'],
};

// ─── GET /accessRequests ──────────────────────────────────────────────────────

router.get('/accessRequests', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  if (shouldBreak(['B1', 'B2'])) {
    return res.status(500).json({ error: 'Simulated tool failure for testing (break_tool=B1/B2)' });
  }

  const identity = req.query['identity'] as string | undefined;
  const status = req.query['status'] as string | undefined;
  const scenario = req.query['scenario'] as string | undefined;

  const scenarioData = scenario ? getScenario(scenario) : undefined;

  // noAccessRequest scenario: return empty list immediately
  if (scenarioData?.noAccessRequest) {
    return res.json({ count: 0, accessRequests: [] });
  }

  let results: AccessRequest[] = [];

  if (scenario && SCENARIO_AR_MAP[scenario] !== undefined) {
    // Scenario-aware routing: return only the AR(s) for this scenario
    const arIds = SCENARIO_AR_MAP[scenario];
    results = arIds
      .map((id) => ACCESS_REQUESTS[id])
      .filter((ar): ar is AccessRequest => ar !== undefined);
  } else if (identity) {
    // Identity-based lookup (no scenario override)
    const arIds = IDENTITY_AR_MAP[identity] ?? [];
    results = arIds
      .map((id) => ACCESS_REQUESTS[id])
      .filter((ar): ar is AccessRequest => ar !== undefined);
  } else {
    results = Object.values(ACCESS_REQUESTS);
  }

  if (status) {
    results = results.filter((ar) => ar.status.toLowerCase() === status.toLowerCase());
  }

  return res.json({ count: results.length, accessRequests: results });
});

// ─── GET /accessRequests/:id ──────────────────────────────────────────────────

router.get('/accessRequests/:id', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  if (shouldBreak(['B1', 'B2'])) {
    return res.status(500).json({ error: 'Simulated tool failure for testing (break_tool=B1/B2)' });
  }

  const id = req.params['id'];
  if (!id) return res.status(400).json({ message: 'Missing access request id.' });

  const ar = ACCESS_REQUESTS[id];
  if (!ar) {
    return res.status(404).json({ status: 404, message: `Access request ${id} not found.` });
  }

  return res.json(ar);
});

// ─── GET /workflowInstances/:id ───────────────────────────────────────────────
// Returns the REST-shape workflow (with steps array, ageHours).
// Scenario routing:
//   WF-12345: Running, stuck in approval at 125 hours (access_request_stuck_approval)
//   WF-22222: Failed at Provision step (provisioning_connector_error)
//   WF-33333: Failed at GitHub provisioning step (github_api_limit)
//   WF-44444: Failed at de-provisioning step (leaver_access_not_revoked)
//   WF-55555: Complete / success (unknown_all_checks_pass)

router.get('/workflowInstances/:id', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  if (shouldBreak(['C1'])) {
    return res.status(500).json({ error: 'Simulated tool failure for testing (break_tool=C1)' });
  }

  const id = req.params['id'];
  if (!id) return res.status(400).json({ message: 'Missing workflow instance id.' });

  const wf = getRestWorkflowById(id);
  if (!wf) {
    return res.status(404).json({ status: 404, message: `Workflow instance ${id} not found.` });
  }

  return res.json(wf);
});

// ─── GET /provisioningTransactions ────────────────────────────────────────────
// Scenario routing by `scenario` query param:
//   provisioning_connector_error → [PT-55555] (john.doe, AD LDAP error code 50)
//   github_api_limit             → [PT-66666] (mary.johnson, GitHub API limit)
//   leaver_access_not_revoked    → [PT-77777] (terminated.user, AD disable timeout)
//   all other scenarios          → []         (no failed transactions)

router.get('/provisioningTransactions', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  if (shouldBreak(['D1', 'D2'])) {
    return res.status(500).json({ error: 'Simulated tool failure for testing (break_tool=D1/D2)' });
  }

  const identity = req.query['identity'] as string | undefined;
  const status = req.query['status'] as string | undefined;
  const application = req.query['application'] as string | undefined;
  const scenario = req.query['scenario'] as string | undefined;

  // Scenarios that have failed provisioning transactions
  const SCENARIO_TX_MAP: Record<string, string[]> = {
    provisioning_connector_error: ['PT-55555'],
    github_api_limit: ['PT-66666'],
    leaver_access_not_revoked: ['PT-77777'],
  };

  // Scenarios that explicitly have NO failed transactions (return empty)
  const NO_TRANSACTION_SCENARIOS = new Set([
    'access_request_stuck_approval',
    'aggregation_stale',
    'identity_not_found',
    'joiner_not_started',
    'unknown_all_checks_pass',
  ]);

  let results = identity
    ? getTransactionsByIdentity(identity, status, application, scenario)
    : getAllTransactions();

  if (scenario) {
    if (NO_TRANSACTION_SCENARIOS.has(scenario)) {
      // Explicitly return empty for these scenarios
      return res.json({ count: 0, provisioningTransactions: [] });
    }
    if (SCENARIO_TX_MAP[scenario]) {
      // Return only the specific transaction(s) for this scenario
      const txIds = SCENARIO_TX_MAP[scenario];
      results = txIds
        .map((id) => TRANSACTIONS[id])
        .filter((tx): tx is NonNullable<typeof tx> => tx !== undefined);

      // Apply status filter if requested
      if (status && status !== 'All') {
        results = results.filter((tx) => tx.status === status);
      }
      // Apply application filter if requested
      if (application) {
        results = results.filter(
          (tx) => tx.applicationName.toLowerCase() === application.toLowerCase()
        );
      }
      return res.json({ count: results.length, provisioningTransactions: results });
    }
  }

  // Default: use identity-based lookup
  if (status && !identity) {
    results = results.filter((tx) => tx.status.toLowerCase() === status.toLowerCase());
  }

  if (application && !identity) {
    results = results.filter(
      (tx) => tx.applicationName.toLowerCase() === application.toLowerCase()
    );
  }

  return res.json({ count: results.length, provisioningTransactions: results });
});

// ─── GET /provisioningTransactions/:id ───────────────────────────────────────

router.get('/provisioningTransactions/:id', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  if (shouldBreak(['D1', 'D2'])) {
    return res.status(500).json({ error: 'Simulated tool failure for testing (break_tool=D1/D2)' });
  }

  const id = req.params['id'];
  if (!id) return res.status(400).json({ message: 'Missing transaction id.' });

  const tx = getTransactionById(id);
  if (!tx) {
    return res.status(404).json({ status: 404, message: `Transaction ${id} not found.` });
  }

  return res.json(tx);
});

// ─── GET /taskResults ─────────────────────────────────────────────────────────
// Scenario routing by `scenario` and `application` params:
//   aggregation_stale + GitHub Enterprise → stale tasks (50h ago, consecutive failures)
//   joiner_not_started + Workday          → error tasks (401 auth failure)
//   unknown_all_checks_pass + SAP ECC     → fresh successful tasks
//   default                               → tasks for the requested application

router.get('/taskResults', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  if (shouldBreak(['F1', 'F2'])) {
    return res.status(500).json({ error: 'Simulated tool failure for testing (break_tool=F1/F2)' });
  }

  const type = req.query['type'] as string | undefined;
  const application = req.query['application'] as string | undefined;
  const statusFilter = req.query['status'] as string | undefined;
  const limitStr = req.query['limit'] as string | undefined;
  const scenario = req.query['scenario'] as string | undefined;

  const limit = limitStr ? parseInt(limitStr, 10) : 5;

  let results: ReturnType<typeof getTaskResults> = [];

  if (scenario === 'aggregation_stale' && (!application || application === 'GitHub Enterprise')) {
    // Return GitHub stale data: last success was 50h ago, 2 consecutive failures
    results = TASK_RESULTS['GitHub Enterprise'] ?? [];
  } else if (scenario === 'joiner_not_started' && (!application || application === 'Workday' || application === 'Active Directory')) {
    // Return Workday error tasks with auth failure (401 Unauthorized)
    results = TASK_RESULTS['Workday'] ?? [];
  } else if (scenario === 'unknown_all_checks_pass') {
    // All checks should pass — return fresh Active Directory tasks regardless of application
    results = TASK_RESULTS['Active Directory'] ?? [];
  } else if (application) {
    results = getTaskResults(application, type, scenario);
  } else {
    // Aggregate all task results
    for (const tasks of Object.values(TASK_RESULTS)) {
      results.push(...tasks);
    }
    if (type) {
      results = results.filter((t) => t.type === type);
    }
  }

  if (statusFilter) {
    results = results.filter(
      (t) => t.status.toLowerCase() === statusFilter.toLowerCase()
    );
  }

  // Apply limit
  results = results.slice(0, limit);

  return res.json({ count: results.length, taskResults: results });
});

export default router;
