// ─── SCIM v2 Router ───────────────────────────────────────────────────────────
// Mounted at /identityiq/scim/v2
// Implements the SailPoint IdentityIQ SCIM v2 API surface used by the RCA agent.

import { Router, Request, Response } from 'express';
import {
  IDENTITIES,
  getAllIdentities,
  getIdentityByUserName,
  getAccountsByIdentity,
  getAllAccounts,
  ScimUser,
  ScimAccount,
} from '../fixtures/identities';
import { getWorkflowsByIdentity, getAllWorkflows, SCIM_WORKFLOWS } from '../fixtures/workflows';
import { getTaskResults } from '../fixtures/tasks';
import { getScenario } from '../fixtures/scenarios';
import { shouldBreak } from '../break-tool';

const router = Router();

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response): boolean {
  const auth = req.headers['authorization'];
  if (!auth) {
    res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'Authorization header is required.',
    });
    return false;
  }
  return true;
}

// ─── SCIM ListResponse Builder ────────────────────────────────────────────────

function listResponse<T>(resources: T[]): object {
  return {
    totalResults: resources.length,
    itemsPerPage: resources.length,
    startIndex: 1,
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    Resources: resources,
  };
}

// ─── Simple SCIM Filter Parser ────────────────────────────────────────────────
// Supports: attr eq "value", attr co "value", attr gt "value"
// Returns { attribute, operator, value } or null if unparseable.

interface ParsedFilter {
  attribute: string;
  operator: 'eq' | 'co' | 'gt' | 'lt' | 'ge' | 'le' | 'ne';
  value: string;
}

function parseFilter(filter: string | undefined): ParsedFilter | null {
  if (!filter) return null;
  const match = filter.match(/^(\S+)\s+(eq|co|gt|lt|ge|le|ne)\s+"(.*)"/i);
  if (!match) return null;
  return {
    attribute: match[1].toLowerCase(),
    operator: match[2].toLowerCase() as ParsedFilter['operator'],
    value: match[3],
  };
}

// ─── GET /ServiceProviderConfig ───────────────────────────────────────────────

router.get('/ServiceProviderConfig', (_req: Request, res: Response) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://community.sailpoint.com/docs/SCIM',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        name: 'OAuth Bearer Token',
        description: 'Authentication scheme using the OAuth Bearer Token standard',
        specUri: 'http://www.rfc-editor.org/info/rfc6750',
        type: 'oauthbearertoken',
        primary: true,
      },
    ],
  });
});

// ─── GET /Users ───────────────────────────────────────────────────────────────

router.get('/Users', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  if (shouldBreak(['A1', 'A2'])) {
    return res.status(500).json({ error: 'Simulated tool failure for testing (break_tool=A1/A2)' });
  }

  const scenario = req.query['scenario'] as string | undefined;
  const filter = req.query['filter'] as string | undefined;
  const attributes = req.query['attributes'] as string | undefined;

  const parsed = parseFilter(filter);
  let results: ScimUser[] = getAllIdentities();

  if (parsed) {
    const attr = parsed.attribute;
    const val = parsed.value.toLowerCase();

    if (attr === 'username') {
      // Scenario override: identity_not_found always returns empty
      if (scenario === 'identity_not_found') {
        return res.json(listResponse([]));
      }
      const identity = getIdentityByUserName(parsed.value, scenario);
      results = identity ? [identity] : [];
    } else if (attr === 'employeenumber') {
      results = results.filter(
        (u) =>
          u['urn:ietf:params:scim:schemas:sailpoint:1.0:User'].employeeNumber?.toLowerCase() === val
      );
    } else if (attr === 'emails.value') {
      results = results.filter((u) =>
        u.emails.some((e) => e.value.toLowerCase() === val)
      );
    } else if (attr === 'active') {
      const activeVal = val === 'true';
      results = results.filter((u) => u.active === activeVal);
    }
  }

  // If attributes param requests entitlements specifically for a scenario
  if (scenario === 'aggregation_stale' && attributes?.includes('entitlements')) {
    results = results.map((u) => ({
      ...u,
      'urn:ietf:params:scim:schemas:sailpoint:1.0:User': {
        ...u['urn:ietf:params:scim:schemas:sailpoint:1.0:User'],
        entitlements: [],
      },
    }));
  }

  return res.json(listResponse(results));
});

// ─── GET /Users/:id ───────────────────────────────────────────────────────────

router.get('/Users/:id', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  if (shouldBreak(['A1', 'A2'])) {
    return res.status(500).json({ error: 'Simulated tool failure for testing (break_tool=A1/A2)' });
  }

  const scenario = req.query['scenario'] as string | undefined;
  const attributes = req.query['attributes'] as string | undefined;
  const id = req.params['id'];

  if (!id) {
    return res.status(400).json({ status: '400', detail: 'Missing user id.' });
  }

  // Try by id first, then by userName
  let user: ScimUser | null = null;

  // Look up by UUID
  const byId = Object.values(IDENTITIES).find((u) => u.id === id);
  if (byId) {
    user = byId;
  } else {
    // Try as userName
    user = getIdentityByUserName(id, scenario);
  }

  if (!user) {
    return res.status(404).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '404',
      detail: `User ${id} not found`,
    });
  }

  // For entitlements-only requests in aggregation_stale scenario
  if (scenario === 'aggregation_stale' && attributes?.includes('entitlements')) {
    const stripped = {
      ...user,
      'urn:ietf:params:scim:schemas:sailpoint:1.0:User': {
        ...user['urn:ietf:params:scim:schemas:sailpoint:1.0:User'],
        entitlements: [],
      },
    };
    return res.json(stripped);
  }

  return res.json(user);
});

// ─── GET /Accounts ────────────────────────────────────────────────────────────

router.get('/Accounts', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  if (shouldBreak(['E1', 'E2'])) {
    return res.status(500).json({ error: 'Simulated tool failure for testing (break_tool=E1/E2)' });
  }

  const scenario = req.query['scenario'] as string | undefined;
  const filter = req.query['filter'] as string | undefined;
  const parsed = parseFilter(filter);

  let results: ScimAccount[] = getAllAccounts();

  if (parsed) {
    const attr = parsed.attribute;
    const val = parsed.value.toLowerCase();

    if (attr === 'identity.id') {
      results = getAccountsByIdentity(parsed.value, scenario);
    } else if (attr === 'identity.username') {
      results = getAccountsByIdentity(parsed.value, scenario);
    } else if (attr === 'application.name') {
      results = results.filter(
        (a) => a.application.displayName.toLowerCase() === val
      );
    } else if (attr === 'identity.id' && parsed.value === 'null') {
      // Orphan accounts: no identity
      results = [];
    }
  }

  return res.json(listResponse(results));
});

// ─── GET /LaunchedWorkflows ───────────────────────────────────────────────────

router.get('/LaunchedWorkflows', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const scenario = req.query['scenario'] as string | undefined;
  const filter = req.query['filter'] as string | undefined;
  const parsed = parseFilter(filter);

  let results = getAllWorkflows();

  if (parsed) {
    const attr = parsed.attribute;
    const val = parsed.value.toLowerCase();

    if (attr === 'target.username') {
      results = getWorkflowsByIdentity(parsed.value, scenario);
    } else if (attr === 'completionstatus') {
      results = results.filter((w) => w.completionStatus.toLowerCase() === val);
    } else if (attr === 'launched' && parsed.operator === 'gt') {
      const cutoff = new Date(parsed.value).getTime();
      results = results.filter((w) => new Date(w.launched).getTime() > cutoff);
    }
  }

  return res.json(listResponse(results));
});

// ─── POST /LaunchedWorkflows ──────────────────────────────────────────────────

router.post('/LaunchedWorkflows', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const body = req.body as Record<string, unknown>;
  const newId = `WF-${Date.now()}`;
  const now = new Date().toISOString();

  const newWorkflow = {
    id: newId,
    workflowName: (body['workflowName'] as string) ?? 'LCM Provisioning',
    launcher: (body['launcher'] as string) ?? 'unknown',
    target: (body['target'] as object) ?? {},
    launched: now,
    completed: null,
    completionStatus: 'Pending',
    currentStep: 'Initialize',
    requestedItems: (body['requestedItems'] as unknown[]) ?? [],
    approvalSummary: { status: 'Pending', approvers: [] },
    errorMessages: [],
  };

  return res.status(201).json(newWorkflow);
});

// ─── GET /TaskResults ─────────────────────────────────────────────────────────

router.get('/TaskResults', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const scenario = req.query['scenario'] as string | undefined;
  const filter = req.query['filter'] as string | undefined;
  const parsed = parseFilter(filter);

  const scenarioData = scenario ? getScenario(scenario) : undefined;

  let results: ReturnType<typeof getTaskResults> = [];

  if (parsed) {
    const attr = parsed.attribute;
    const val = parsed.value;

    if (attr === 'taskname' && parsed.operator === 'co') {
      // Find by application name keyword in task name
      for (const [appName, tasks] of Object.entries(
        await_task_results_all()
      )) {
        if (appName.toLowerCase().includes(val.toLowerCase())) {
          results.push(...tasks);
        }
      }
    } else if (attr === 'completionstatus') {
      for (const tasks of Object.values(await_task_results_all())) {
        results.push(...tasks.filter((t) => t.status.toLowerCase() === val.toLowerCase()));
      }
    } else if (attr === 'completed' && parsed.operator === 'gt') {
      const cutoff = new Date(parsed.value).getTime();
      for (const tasks of Object.values(await_task_results_all())) {
        results.push(
          ...tasks.filter(
            (t) => t.completed && new Date(t.completed).getTime() > cutoff
          )
        );
      }
    }
  } else {
    // No filter — return all
    for (const tasks of Object.values(await_task_results_all())) {
      results.push(...tasks);
    }
  }

  // For aggregation_stale scenario, inject stale GitHub data
  if (scenarioData?.taskStale) {
    results = getTaskResults('GitHub Enterprise', undefined, scenario);
  }

  return res.json(listResponse(results));
});

// ─── Internal Helper ──────────────────────────────────────────────────────────

import { TASK_RESULTS } from '../fixtures/tasks';

function await_task_results_all(): typeof TASK_RESULTS {
  return TASK_RESULTS;
}

export default router;
