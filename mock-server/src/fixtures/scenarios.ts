// ─── Scenario Registry ────────────────────────────────────────────────────────
// Maps scenario name strings to ScenarioData objects.
// The mock server accepts ?scenario=<name> on any request and uses this
// registry to determine which fixtures / overrides to activate.

export interface ScenarioData {
  /** The scenario name (same as the map key) */
  name: string;
  /** userName of the primary identity for this scenario */
  identity: string;
  /** Human-readable description of the scenario */
  description: string;
  /** Primary workflow for this scenario */
  workflowId?: string;
  /** Primary provisioning transaction for this scenario */
  transactionId?: string;
  /** Primary application name for this scenario */
  application?: string;
  /** When true, return empty entitlements for the identity */
  entitlementsEmpty?: boolean;
  /** When true, return empty access requests */
  noAccessRequest?: boolean;
  /** When true, return stale task results (GitHub, 50h old) */
  taskStale?: boolean;
  /** When true, return task results with auth/credential errors */
  taskAuthError?: boolean;
  /** The expected RCA code this scenario should produce */
  expectedRcaCode: string;
}

// ─── All 8 Scenario Definitions ──────────────────────────────────────────────

export const SCENARIOS: Record<string, ScenarioData> = {
  /**
   * SCENARIO 1 — Access Request Stuck in Approval
   * john.doe submitted an access request 125 hours ago.
   * WF-12345 is Running / waiting on jane.manager.
   * No failed provisioning transactions.
   */
  access_request_stuck_approval: {
    name: 'access_request_stuck_approval',
    identity: 'john.doe',
    description: 'Access request pending manager approval for 125 hours',
    workflowId: 'WF-12345',
    application: 'SAP ECC',
    expectedRcaCode: 'APPROVAL_PENDING_MANAGER',
  },

  /**
   * SCENARIO 2 — Provisioning Connector Error (LDAP)
   * john.doe's access was approved but AD provisioning failed.
   * WF-22222 is Failed at Provision step.
   * PT-55555 has LDAP error code 50 (insufficient rights).
   */
  provisioning_connector_error: {
    name: 'provisioning_connector_error',
    identity: 'john.doe',
    description: 'Provisioning failed due to AD connector permissions',
    workflowId: 'WF-22222',
    transactionId: 'PT-55555',
    application: 'Active Directory',
    expectedRcaCode: 'PROVISIONING_CONNECTOR_ERROR',
  },

  /**
   * SCENARIO 3 — GitHub API Limit Reached
   * mary.johnson's GitHub team membership request was approved but failed.
   * PT-66666 shows: Organization member limit reached (500/500).
   */
  github_api_limit: {
    name: 'github_api_limit',
    identity: 'mary.johnson',
    description: 'GitHub org member limit reached',
    transactionId: 'PT-66666',
    application: 'GitHub Enterprise',
    expectedRcaCode: 'PROVISIONING_API_LIMIT',
  },

  /**
   * SCENARIO 4 — Aggregation Stale (GitHub data is 50h old)
   * bob.smith's entitlements appear empty because aggregation hasn't run.
   * GitHub Enterprise last aggregated 50 hours ago; consecutive_failures = 2.
   */
  aggregation_stale: {
    name: 'aggregation_stale',
    identity: 'bob.smith',
    description: 'GitHub aggregation data is 50 hours stale',
    application: 'GitHub Enterprise',
    entitlementsEmpty: true,
    taskStale: true,
    expectedRcaCode: 'AGGREGATION_STALE_DATA',
  },

  /**
   * SCENARIO 5 — Identity Not Found
   * The requested identity does not exist in IIQ.
   * All endpoints return 404 / empty results.
   */
  identity_not_found: {
    name: 'identity_not_found',
    identity: 'nonexistent.user',
    description: 'User does not exist in IIQ',
    noAccessRequest: true,
    expectedRcaCode: 'IDENTITY_NOT_FOUND',
  },

  /**
   * SCENARIO 6 — Joiner Not Started (future hire)
   * future.hire has active=false and a future startDate of 2026-06-01.
   * Joiner workflows have not been triggered yet.
   */
  joiner_not_started: {
    name: 'joiner_not_started',
    identity: 'future.hire',
    description: 'New hire with future start date 2026-06-01',
    application: 'Active Directory',
    taskAuthError: true,
    expectedRcaCode: 'JOINER_NOT_YET_STARTED',
  },

  /**
   * SCENARIO 7 — Leaver Access Not Revoked
   * terminated.user is inactive (lifecycleState=terminated) but still has
   * active accounts in AD and SAP. PT-77777 shows de-provisioning failed.
   */
  leaver_access_not_revoked: {
    name: 'leaver_access_not_revoked',
    identity: 'terminated.user',
    description: 'Terminated user still has active accounts',
    transactionId: 'PT-77777',
    application: 'Active Directory',
    expectedRcaCode: 'LEAVER_ACCESS_NOT_REVOKED',
  },

  /**
   * SCENARIO 8 — Unknown / All Checks Pass
   * bob.smith has an approved, complete workflow.
   * Access request is Approved. Entitlements are present. Aggregation is fresh.
   * All health checks pass — RCA should return UNKNOWN_STATUS.
   */
  unknown_all_checks_pass: {
    name: 'unknown_all_checks_pass',
    identity: 'bob.smith',
    description: 'All checks pass, no root cause found',
    workflowId: 'WF-55555',
    application: 'SAP ECC',
    entitlementsEmpty: false,
    noAccessRequest: false,
    taskStale: false,
    expectedRcaCode: 'UNKNOWN_STATUS',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the ScenarioData for a given scenario name, or undefined if not found.
 */
export function getScenario(name: string): ScenarioData | undefined {
  return SCENARIOS[name];
}

/**
 * Returns all scenario names.
 */
export function listScenarios(): string[] {
  return Object.keys(SCENARIOS);
}
