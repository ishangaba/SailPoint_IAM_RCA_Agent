// ─── ServiceNow Mock Router ───────────────────────────────────────────────────
// Mounted at /api/now
// Mimics the ServiceNow Table API used by the RCA agent to read/update incidents.

import { Router, Request, Response } from 'express';

const router = Router();

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response): boolean {
  const auth = req.headers['authorization'];
  if (!auth) {
    res.status(401).json({
      error: {
        message: 'User Not Authenticated',
        detail: 'Required to provide Auth information',
      },
    });
    return false;
  }
  return true;
}

// ─── In-Memory Incident Store ─────────────────────────────────────────────────
// All PATCH work_notes are stored here so tests can verify them.

interface ServiceNowIncident {
  sys_id: string;
  number: string;
  caller_id: string;
  caller_user_name: string;
  short_description: string;
  description: string;
  state: string;          // '1'=New, '2'=In Progress, '3'=On Hold, '6'=Resolved, '7'=Closed
  priority: string;       // '1'=Critical, '2'=High, '3'=Moderate, '4'=Low
  category: string;
  assignment_group: string;
  assigned_to: string;
  work_notes: string[];   // Array of all work notes added (appended, not replaced)
  sys_created_on: string;
  sys_updated_on: string;
  opened_at: string;
  resolved_at?: string;
}

// Seed incidents
const INCIDENTS: Record<string, ServiceNowIncident> = {
  'sys-id-inc-001': {
    sys_id: 'sys-id-inc-001',
    number: 'INC0001234',
    caller_id: 'sys-user-john-doe',
    caller_user_name: 'john.doe',
    short_description: 'Cannot access SAP Finance module',
    description:
      'User john.doe is unable to access the SAP Finance module. Receives permission denied error when attempting to log in to transaction FB01.',
    state: '1',
    priority: '3',
    category: 'Access',
    assignment_group: 'IAM-Ops-Team',
    assigned_to: '',
    work_notes: [],
    sys_created_on: '2026-03-14T09:00:00Z',
    sys_updated_on: '2026-03-14T09:00:00Z',
    opened_at: '2026-03-14T09:00:00Z',
  },

  'sys-id-inc-002': {
    sys_id: 'sys-id-inc-002',
    number: 'INC0001235',
    caller_id: 'sys-user-mary-johnson',
    caller_user_name: 'mary.johnson',
    short_description: 'Not added to GitHub Engineering team',
    description:
      'User mary.johnson submitted access request to join the GitHub Engineering team 2 days ago. Access request was approved but user still cannot access the team repository.',
    state: '1',
    priority: '3',
    category: 'Access',
    assignment_group: 'IAM-Ops-Team',
    assigned_to: '',
    work_notes: [],
    sys_created_on: '2026-03-13T14:30:00Z',
    sys_updated_on: '2026-03-13T14:30:00Z',
    opened_at: '2026-03-13T14:30:00Z',
  },

  'sys-id-inc-003': {
    sys_id: 'sys-id-inc-003',
    number: 'INC0001236',
    caller_id: 'sys-user-manager-ops',
    caller_user_name: 'ops.manager',
    short_description: 'Leaver access not removed',
    description:
      'Employee terminated.user left the company on 2026-02-28. As of today their Active Directory and SAP accounts are still active. This is a security concern and needs urgent remediation.',
    state: '1',
    priority: '2',
    category: 'Security',
    assignment_group: 'IAM-Ops-Team',
    assigned_to: '',
    work_notes: [],
    sys_created_on: '2026-03-01T08:00:00Z',
    sys_updated_on: '2026-03-01T08:00:00Z',
    opened_at: '2026-03-01T08:00:00Z',
  },
};

// Map from incident number to sys_id for quick lookup
const NUMBER_TO_SYSID: Record<string, string> = {
  INC0001234: 'sys-id-inc-001',
  INC0001235: 'sys-id-inc-002',
  INC0001236: 'sys-id-inc-003',
};

// ─── In-Memory Users (for /table/sys_user) ────────────────────────────────────

interface ServiceNowUser {
  sys_id: string;
  user_name: string;
  name: string;
  email: string;
  department: string;
  active: string; // 'true' or 'false' as string (ServiceNow style)
}

const SNOW_USERS: Record<string, ServiceNowUser> = {
  'sys-user-john-doe': {
    sys_id: 'sys-user-john-doe',
    user_name: 'john.doe',
    name: 'John Doe',
    email: 'john.doe@company.com',
    department: 'Finance',
    active: 'true',
  },
  'sys-user-mary-johnson': {
    sys_id: 'sys-user-mary-johnson',
    user_name: 'mary.johnson',
    name: 'Mary Johnson',
    email: 'mary.johnson@company.com',
    department: 'Engineering',
    active: 'true',
  },
  'sys-user-terminated': {
    sys_id: 'sys-user-terminated',
    user_name: 'terminated.user',
    name: 'Terminated User',
    email: 'terminated.user@company.com',
    department: 'Operations',
    active: 'false',
  },
};

// ─── Helper: Serialize incident for API response ──────────────────────────────

function serializeIncident(inc: ServiceNowIncident): Record<string, unknown> {
  return {
    sys_id: inc.sys_id,
    number: inc.number,
    caller_id: { value: inc.caller_id, display_value: inc.caller_user_name },
    short_description: inc.short_description,
    description: inc.description,
    state: inc.state,
    priority: inc.priority,
    category: inc.category,
    assignment_group: { value: inc.assignment_group, display_value: inc.assignment_group },
    assigned_to: inc.assigned_to ? { value: inc.assigned_to, display_value: inc.assigned_to } : '',
    work_notes: inc.work_notes.join('\n\n'),
    sys_created_on: inc.sys_created_on,
    sys_updated_on: inc.sys_updated_on,
    opened_at: inc.opened_at,
    resolved_at: inc.resolved_at ?? '',
  };
}

// ─── GET /table/incident ──────────────────────────────────────────────────────

router.get('/table/incident', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const query = req.query['sysparm_query'] as string | undefined;
  let results: ServiceNowIncident[] = Object.values(INCIDENTS);

  if (query) {
    // Parse simple ServiceNow query format: field=value^field2=value2
    const conditions = query.split('^');
    for (const condition of conditions) {
      const eqMatch = condition.match(/^(\w+)=(.+)$/);
      if (eqMatch) {
        const field = eqMatch[1] as keyof ServiceNowIncident;
        const value = eqMatch[2];
        if (field === 'number') {
          results = results.filter((i) => i.number === value);
        } else if (field === 'caller_id') {
          // Can be sys_id or user_name
          results = results.filter(
            (i) => i.caller_id === value || i.caller_user_name === value
          );
        } else if (field === 'state') {
          results = results.filter((i) => i.state === value);
        } else if (field === 'assignment_group') {
          results = results.filter((i) => i.assignment_group === value);
        }
      }
    }
  }

  return res.json({ result: results.map(serializeIncident) });
});

// ─── GET /table/incident/:sys_id ──────────────────────────────────────────────

router.get('/table/incident/:sys_id', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const sysId = req.params['sys_id'];
  if (!sysId) return res.status(400).json({ error: { message: 'Missing sys_id.' } });

  // Look up by sys_id or by number
  let incident = INCIDENTS[sysId];
  if (!incident) {
    const resolvedSysId = NUMBER_TO_SYSID[sysId];
    if (resolvedSysId) incident = INCIDENTS[resolvedSysId];
  }

  if (!incident) {
    return res.status(404).json({
      error: { message: 'No Record found', detail: `Incident ${sysId} not found.` },
    });
  }

  return res.json({ result: serializeIncident(incident) });
});

// ─── PATCH /table/incident/:sys_id ───────────────────────────────────────────

router.patch('/table/incident/:sys_id', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const sysId = req.params['sys_id'];
  if (!sysId) return res.status(400).json({ error: { message: 'Missing sys_id.' } });

  let incident = INCIDENTS[sysId];
  if (!incident) {
    const resolvedSysId = NUMBER_TO_SYSID[sysId];
    if (resolvedSysId) incident = INCIDENTS[resolvedSysId];
  }

  if (!incident) {
    return res.status(404).json({
      error: { message: 'No Record found', detail: `Incident ${sysId} not found.` },
    });
  }

  const body = req.body as Record<string, string>;

  // Apply work_notes (append, not replace)
  if (body['work_notes']) {
    const timestamp = new Date().toISOString();
    incident.work_notes.push(`[${timestamp}] ${body['work_notes']}`);
  }

  // Apply state update
  if (body['state']) {
    incident.state = body['state'];
    if (body['state'] === '6' || body['state'] === '7') {
      incident.resolved_at = new Date().toISOString();
    }
  }

  // Apply assignment_group update
  if (body['assignment_group']) {
    incident.assignment_group = body['assignment_group'];
  }

  // Apply assigned_to update
  if (body['assigned_to']) {
    incident.assigned_to = body['assigned_to'];
  }

  // Apply short_description update
  if (body['short_description']) {
    incident.short_description = body['short_description'];
  }

  incident.sys_updated_on = new Date().toISOString();

  return res.json({ result: serializeIncident(incident) });
});

// ─── POST /table/incident ─────────────────────────────────────────────────────

router.post('/table/incident', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const body = req.body as Record<string, string>;
  const newSysId = `sys-id-inc-${Date.now()}`;
  const now = new Date().toISOString();

  // Auto-generate incident number
  const existingNumbers = Object.values(INCIDENTS).map((i) => parseInt(i.number.replace('INC', ''), 10));
  const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 1236;
  const newNumber = `INC${String(maxNum + 1).padStart(7, '0')}`;

  const newIncident: ServiceNowIncident = {
    sys_id: newSysId,
    number: newNumber,
    caller_id: body['caller_id'] ?? '',
    caller_user_name: body['caller_id'] ?? '',
    short_description: body['short_description'] ?? '',
    description: body['description'] ?? '',
    state: body['state'] ?? '1',
    priority: body['priority'] ?? '3',
    category: body['category'] ?? 'Access',
    assignment_group: body['assignment_group'] ?? 'IAM-Ops-Team',
    assigned_to: body['assigned_to'] ?? '',
    work_notes: body['work_notes'] ? [`[${now}] ${body['work_notes']}`] : [],
    sys_created_on: now,
    sys_updated_on: now,
    opened_at: now,
  };

  INCIDENTS[newSysId] = newIncident;
  NUMBER_TO_SYSID[newNumber] = newSysId;

  return res.status(201).json({ result: serializeIncident(newIncident) });
});

// ─── GET /table/sys_user ─────────────────────────────────────────────────────

router.get('/table/sys_user', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const query = req.query['sysparm_query'] as string | undefined;
  let results: ServiceNowUser[] = Object.values(SNOW_USERS);

  if (query) {
    const conditions = query.split('^');
    for (const condition of conditions) {
      const eqMatch = condition.match(/^(\w+)=(.+)$/);
      if (eqMatch) {
        const field = eqMatch[1];
        const value = eqMatch[2];
        if (field === 'user_name') {
          results = results.filter((u) => u.user_name === value);
        } else if (field === 'email') {
          results = results.filter((u) => u.email === value);
        } else if (field === 'active') {
          results = results.filter((u) => u.active === value);
        }
      }
    }
  }

  return res.json({ result: results });
});

export default router;
