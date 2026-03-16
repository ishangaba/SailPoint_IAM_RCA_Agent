// ─── Provisioning Transaction Fixtures ───────────────────────────────────────
// These represent IIQ provisioning transaction records returned by
// /identityiq/rest/provisioningTransactions.
// Shape matches Part 4 Section 2.3 of the project API reference.

export interface AttributeRequest {
  name: string;
  value: string | string[];
  operation: 'Set' | 'Add' | 'Remove';
}

export interface AccountRequest {
  application: string;
  nativeIdentity: string | null;
  operation: string;
  attributeRequests: AttributeRequest[];
}

export interface ProvisioningTransaction {
  id: string;
  identityName: string;
  applicationName: string;
  operation: string;
  status: 'Success' | 'Failed' | 'Pending';
  created: string;
  nativeIdentity: string | null;
  integrationConfig: string;
  errorMessages: string[];
  accountRequest: AccountRequest;
  retryCount: number;
  workflowCaseId?: string;
}

// ─── Transaction Records ──────────────────────────────────────────────────────

export const TRANSACTIONS: Record<string, ProvisioningTransaction> = {
  'PT-55555': {
    id: 'PT-55555',
    identityName: 'john.doe',
    applicationName: 'Active Directory',
    operation: 'Create',
    status: 'Failed',
    created: '2026-02-15T10:32:00Z',
    nativeIdentity: null,
    integrationConfig: 'AD_Connector_PROD',
    errorMessages: [
      'javax.naming.NoPermissionException: [LDAP: error code 50] Insufficient access rights to create account in OU=Finance,DC=company,DC=com',
    ],
    accountRequest: {
      application: 'Active Directory',
      nativeIdentity: null,
      operation: 'Create',
      attributeRequests: [
        { name: 'sAMAccountName', value: 'jdoe', operation: 'Set' },
        { name: 'cn', value: 'John Doe', operation: 'Set' },
        { name: 'displayName', value: 'John Doe', operation: 'Set' },
        { name: 'userPrincipalName', value: 'john.doe@company.com', operation: 'Set' },
        {
          name: 'memberOf',
          value: 'CN=Finance,OU=Groups,DC=company,DC=com',
          operation: 'Add',
        },
      ],
    },
    retryCount: 2,
    workflowCaseId: 'WF-22222',
  },

  'PT-66666': {
    id: 'PT-66666',
    identityName: 'mary.johnson',
    applicationName: 'GitHub Enterprise',
    operation: 'Modify',
    status: 'Failed',
    created: '2026-02-20T14:15:00Z',
    nativeIdentity: 'mjohnson',
    integrationConfig: 'GitHub_Connector_PROD',
    errorMessages: [
      'API_ERROR: Organization member limit reached (500/500). Upgrade plan or remove inactive members.',
    ],
    accountRequest: {
      application: 'GitHub Enterprise',
      nativeIdentity: 'mjohnson',
      operation: 'Modify',
      attributeRequests: [
        { name: 'teams', value: 'engineering-team', operation: 'Add' },
        { name: 'role', value: 'member', operation: 'Set' },
      ],
    },
    retryCount: 3,
    workflowCaseId: 'WF-33333',
  },

  'PT-77777': {
    id: 'PT-77777',
    identityName: 'terminated.user',
    applicationName: 'Active Directory',
    operation: 'Disable',
    status: 'Failed',
    created: '2026-03-01T08:45:00Z',
    nativeIdentity: 'tuser',
    integrationConfig: 'AD_Connector_PROD',
    errorMessages: ['Connection timeout after 30 seconds'],
    accountRequest: {
      application: 'Active Directory',
      nativeIdentity: 'tuser',
      operation: 'Disable',
      attributeRequests: [
        { name: 'userAccountControl', value: '514', operation: 'Set' },
      ],
    },
    retryCount: 1,
    workflowCaseId: 'WF-44444',
  },

  'PT-88888': {
    id: 'PT-88888',
    identityName: 'bob.smith',
    applicationName: 'SAP ECC',
    operation: 'Create',
    status: 'Success',
    created: '2026-03-10T11:00:00Z',
    nativeIdentity: 'BSMITH',
    integrationConfig: 'SAP_Connector_PROD',
    errorMessages: [],
    accountRequest: {
      application: 'SAP ECC',
      nativeIdentity: null,
      operation: 'Create',
      attributeRequests: [
        { name: 'SY_UNAME', value: 'BSMITH', operation: 'Set' },
        { name: 'USTYP', value: 'A', operation: 'Set' },
        { name: 'CLASS', value: 'SAP_IT_USER', operation: 'Add' },
      ],
    },
    retryCount: 0,
    workflowCaseId: 'WF-55555',
  },
};

// ─── Lookup Helpers ───────────────────────────────────────────────────────────

// Map from identityName to list of transaction IDs
const IDENTITY_TRANSACTIONS_MAP: Record<string, string[]> = {
  'john.doe': ['PT-55555'],
  'mary.johnson': ['PT-66666'],
  'terminated.user': ['PT-77777'],
  'bob.smith': ['PT-88888'],
};

/**
 * Returns transactions for a given identity, optionally filtered by status and application.
 * The scenario param controls whether to return stale/empty data for specific test cases.
 */
export function getTransactionsByIdentity(
  identityId: string,
  status?: string,
  application?: string,
  scenario?: string
): ProvisioningTransaction[] {
  // For unknown_all_checks_pass scenario: only return successful transactions
  if (scenario === 'unknown_all_checks_pass' && identityId === 'bob.smith') {
    const txIds = IDENTITY_TRANSACTIONS_MAP[identityId] ?? [];
    return txIds
      .map((id) => TRANSACTIONS[id])
      .filter((tx): tx is ProvisioningTransaction => tx !== undefined)
      .filter((tx) => tx.status === 'Success');
  }

  const txIds = IDENTITY_TRANSACTIONS_MAP[identityId] ?? [];
  let results = txIds
    .map((id) => TRANSACTIONS[id])
    .filter((tx): tx is ProvisioningTransaction => tx !== undefined);

  if (status && status !== 'All') {
    results = results.filter((tx) => tx.status === status);
  }

  if (application) {
    results = results.filter((tx) => tx.applicationName === application);
  }

  return results;
}

/**
 * Returns a single transaction by ID, or null if not found.
 */
export function getTransactionById(id: string): ProvisioningTransaction | null {
  return TRANSACTIONS[id] ?? null;
}

/**
 * Returns all transactions as an array.
 */
export function getAllTransactions(): ProvisioningTransaction[] {
  return Object.values(TRANSACTIONS);
}
