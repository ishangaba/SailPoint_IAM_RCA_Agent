// ─── Task Result Fixtures ─────────────────────────────────────────────────────
// Represents IIQ task/aggregation results returned by /identityiq/rest/taskResults.
// Shape matches Part 4 Section 2.4 of the project API reference.

export interface TaskStatistics {
  total: number;
  created: number;
  updated: number;
  deleted: number;
  errors: number;
}

export interface TaskMessage {
  type: 'Error' | 'Warning' | 'Info';
  text: string;
}

export interface TaskResult {
  id: string;
  name: string;
  type: 'Aggregation' | 'Refresh' | 'Provisioning';
  status: 'Success' | 'Error' | 'Warning' | 'Running';
  application: string;
  launched: string;
  completed: string | null;
  durationMillis: number;
  statistics: TaskStatistics;
  messages: TaskMessage[];
}

// ─── Relative timestamps ──────────────────────────────────────────────────────
// All computed at module load time so offsets remain accurate regardless of date.

// GitHub stale: last success 50h ago, two subsequent failures
const GITHUB_STALE_COMPLETED = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
const GITHUB_STALE_LAUNCHED = new Date(Date.now() - 50 * 60 * 60 * 1000 - 8 * 60 * 1000).toISOString();

const GITHUB_FAIL1_COMPLETED = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
const GITHUB_FAIL1_LAUNCHED = new Date(Date.now() - 26 * 60 * 60 * 1000 - 5 * 60 * 1000).toISOString();

const GITHUB_FAIL2_COMPLETED = new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString();
const GITHUB_FAIL2_LAUNCHED = new Date(Date.now() - 14 * 60 * 60 * 1000 - 4 * 60 * 1000).toISOString();

// Active Directory: two recent successes (fresh)
const AD_SUCCESS1_COMPLETED = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const AD_SUCCESS1_LAUNCHED  = new Date(Date.now() - 2 * 60 * 60 * 1000 - 19 * 60 * 1000).toISOString();
const AD_SUCCESS2_COMPLETED = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
const AD_SUCCESS2_LAUNCHED  = new Date(Date.now() - 26 * 60 * 60 * 1000 - 18 * 60 * 1000).toISOString();

// SAP ECC: one recent error, one success 20h ago (fresh — within 36h threshold)
const SAP_ERROR_COMPLETED  = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const SAP_ERROR_LAUNCHED   = new Date(Date.now() - 2 * 60 * 60 * 1000 - 6 * 60 * 1000).toISOString();
const SAP_SUCCESS_COMPLETED = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
const SAP_SUCCESS_LAUNCHED  = new Date(Date.now() - 20 * 60 * 60 * 1000 - 12 * 60 * 1000).toISOString();

// Workday: one recent error, one success yesterday (fresh)
const WORKDAY_ERROR_COMPLETED  = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
const WORKDAY_ERROR_LAUNCHED   = new Date(Date.now() - 1 * 60 * 60 * 1000 - 1 * 60 * 1000).toISOString();
const WORKDAY_SUCCESS_COMPLETED = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
const WORKDAY_SUCCESS_LAUNCHED  = new Date(Date.now() - 25 * 60 * 60 * 1000 - 22 * 60 * 1000).toISOString();

// ─── Task Result Records ──────────────────────────────────────────────────────

// Keyed by application name → array of results (most recent first)
export const TASK_RESULTS: Record<string, TaskResult[]> = {
  'Active Directory': [
    {
      id: 'TASK-11111',
      name: 'Aggregate Active Directory',
      type: 'Aggregation',
      status: 'Success',
      application: 'Active Directory',
      launched: AD_SUCCESS1_LAUNCHED,
      completed: AD_SUCCESS1_COMPLETED,
      durationMillis: 1113000, // 18 min 33 sec
      statistics: {
        total: 5243,
        created: 2,
        updated: 14,
        deleted: 0,
        errors: 0,
      },
      messages: [],
    },
    {
      id: 'TASK-11110',
      name: 'Aggregate Active Directory',
      type: 'Aggregation',
      status: 'Success',
      application: 'Active Directory',
      launched: AD_SUCCESS2_LAUNCHED,
      completed: AD_SUCCESS2_COMPLETED,
      durationMillis: 1065000,
      statistics: {
        total: 5241,
        created: 0,
        updated: 5,
        deleted: 0,
        errors: 0,
      },
      messages: [],
    },
  ],

  'SAP ECC': [
    {
      id: 'TASK-22222',
      name: 'Aggregate SAP ECC',
      type: 'Aggregation',
      status: 'Error',
      application: 'SAP ECC',
      launched: SAP_ERROR_LAUNCHED,
      completed: SAP_ERROR_COMPLETED,
      durationMillis: 347000, // 5 min 47 sec
      statistics: {
        total: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        errors: 1,
      },
      messages: [
        {
          type: 'Error',
          text: 'Connection to SAP ECC failed: RFC_ERROR_SYSTEM_FAILURE - Host unreachable',
        },
      ],
    },
    {
      id: 'TASK-22221',
      name: 'Aggregate SAP ECC',
      type: 'Aggregation',
      status: 'Success',
      application: 'SAP ECC',
      launched: SAP_SUCCESS_LAUNCHED,
      completed: SAP_SUCCESS_COMPLETED,
      durationMillis: 730000,
      statistics: {
        total: 1842,
        created: 0,
        updated: 3,
        deleted: 0,
        errors: 0,
      },
      messages: [],
    },
  ],

  'GitHub Enterprise': [
    // Most recent run: consecutive failure #2
    {
      id: 'TASK-33333',
      name: 'Aggregate GitHub Enterprise',
      type: 'Aggregation',
      status: 'Error',
      application: 'GitHub Enterprise',
      launched: GITHUB_FAIL2_LAUNCHED,
      completed: GITHUB_FAIL2_COMPLETED,
      durationMillis: 240000,
      statistics: {
        total: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        errors: 1,
      },
      messages: [
        {
          type: 'Error',
          text: 'GitHub API rate limit exceeded. Retry after: 1800 seconds',
        },
      ],
    },
    // Consecutive failure #1
    {
      id: 'TASK-33332',
      name: 'Aggregate GitHub Enterprise',
      type: 'Aggregation',
      status: 'Error',
      application: 'GitHub Enterprise',
      launched: GITHUB_FAIL1_LAUNCHED,
      completed: GITHUB_FAIL1_COMPLETED,
      durationMillis: 180000,
      statistics: {
        total: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        errors: 1,
      },
      messages: [
        {
          type: 'Error',
          text: 'GitHub API rate limit exceeded. Retry after: 3600 seconds',
        },
      ],
    },
    // Last successful run — 50 hours ago (stale)
    {
      id: 'TASK-33331',
      name: 'Aggregate GitHub Enterprise',
      type: 'Aggregation',
      status: 'Success',
      application: 'GitHub Enterprise',
      launched: GITHUB_STALE_LAUNCHED,
      completed: GITHUB_STALE_COMPLETED,
      durationMillis: 480000,
      statistics: {
        total: 500,
        created: 1,
        updated: 4,
        deleted: 0,
        errors: 0,
      },
      messages: [],
    },
  ],

  'Workday': [
    {
      id: 'TASK-44444',
      name: 'Aggregate Workday HR',
      type: 'Aggregation',
      status: 'Error',
      application: 'Workday',
      launched: WORKDAY_ERROR_LAUNCHED,
      completed: WORKDAY_ERROR_COMPLETED,
      durationMillis: 8000,
      statistics: {
        total: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        errors: 1,
      },
      messages: [
        {
          type: 'Error',
          text: '401 Unauthorized - API credentials invalid or expired. Check Workday ISU account credentials in connector configuration.',
        },
      ],
    },
    {
      id: 'TASK-44443',
      name: 'Aggregate Workday HR',
      type: 'Aggregation',
      status: 'Success',
      application: 'Workday',
      launched: WORKDAY_SUCCESS_LAUNCHED,
      completed: WORKDAY_SUCCESS_COMPLETED,
      durationMillis: 1335000,
      statistics: {
        total: 3100,
        created: 5,
        updated: 22,
        deleted: 1,
        errors: 0,
      },
      messages: [],
    },
  ],
};

// ─── Lookup Helpers ───────────────────────────────────────────────────────────

/**
 * Returns task results for a given application, optionally filtered by type.
 * For the aggregation_stale scenario, returns the GitHub stale data.
 */
export function getTaskResults(
  application: string,
  taskType?: string,
  scenario?: string
): TaskResult[] {
  let results = TASK_RESULTS[application] ?? [];

  // aggregation_stale scenario: always return GitHub stale data
  if (scenario === 'aggregation_stale' && application === 'GitHub Enterprise') {
    results = TASK_RESULTS['GitHub Enterprise'] ?? [];
  }

  if (taskType) {
    results = results.filter((t) => t.type === taskType);
  }

  return results;
}

/**
 * Returns a single task result by ID, searching across all applications.
 */
export function getTaskById(id: string): TaskResult | null {
  for (const tasks of Object.values(TASK_RESULTS)) {
    const found = tasks.find((t) => t.id === id);
    if (found) return found;
  }
  return null;
}
