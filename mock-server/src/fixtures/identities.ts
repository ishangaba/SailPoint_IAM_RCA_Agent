// ─── Identity Fixtures ────────────────────────────────────────────────────────
// SCIM v2 User resources with SailPoint extension schema.
// These fixtures power all mock server responses for identity-related endpoints.

export interface ScimUser {
  id: string;
  userName: string;
  displayName: string;
  active: boolean;
  name: {
    formatted: string;
    familyName: string;
    givenName: string;
  };
  emails: Array<{ value: string; type: string; primary: boolean }>;
  schemas: string[];
  'urn:ietf:params:scim:schemas:sailpoint:1.0:User': {
    employeeNumber: string;
    department: string;
    title: string;
    location: string;
    manager?: { id: string; displayName: string; $ref: string };
    lifecycleState: string;
    roles?: Array<{ id: string; displayName: string }>;
    workerType: string;
    riskScore?: number;
    entitlements?: Array<{
      id: string;
      displayName: string;
      value: string;
      application: { id: string; displayName: string };
      type: string;
    }>;
    startDate?: string;
    terminationDate?: string;
  };
  meta: {
    resourceType: string;
    created: string;
    lastModified: string;
    location: string;
  };
}

export interface ScimAccount {
  id: string;
  nativeIdentity: string;
  displayName: string;
  active: boolean;
  identity: { id: string; displayName: string };
  application: { id: string; displayName: string };
  attributes: Record<string, unknown>;
  entitlements: Array<{ displayName: string; value: string }>;
  meta: { lastModified: string };
}

// ─── Identity Records ─────────────────────────────────────────────────────────

export const IDENTITIES: Record<string, ScimUser> = {
  'john.doe': {
    id: 'user-uuid-john-doe-001',
    userName: 'john.doe',
    displayName: 'John Doe',
    active: true,
    schemas: [
      'urn:ietf:params:scim:schemas:core:2.0:User',
      'urn:ietf:params:scim:schemas:sailpoint:1.0:User',
    ],
    name: {
      formatted: 'John Doe',
      familyName: 'Doe',
      givenName: 'John',
    },
    emails: [{ value: 'john.doe@company.com', type: 'work', primary: true }],
    'urn:ietf:params:scim:schemas:sailpoint:1.0:User': {
      employeeNumber: 'E12345',
      department: 'Finance',
      title: 'Senior Analyst',
      location: 'New York',
      manager: {
        id: 'user-uuid-jane-manager-010',
        displayName: 'Jane Manager',
        $ref: '/scim/v2/Users/user-uuid-jane-manager-010',
      },
      lifecycleState: 'active',
      roles: [{ id: 'role-uuid-finance-user-001', displayName: 'Finance User' }],
      workerType: 'employee',
      riskScore: 42,
      entitlements: [
        {
          id: 'ent-001',
          displayName: 'SAP_FI_USER',
          value: 'SAP_FI_USER',
          application: { id: 'app-sap-001', displayName: 'SAP ECC' },
          type: 'group',
        },
        {
          id: 'ent-002',
          displayName: 'AD_Finance_Group',
          value: 'CN=Finance,OU=Groups,DC=company,DC=com',
          application: { id: 'app-ad-001', displayName: 'Active Directory' },
          type: 'group',
        },
      ],
    },
    meta: {
      resourceType: 'User',
      created: '2024-01-15T09:00:00Z',
      lastModified: '2026-02-10T14:22:00Z',
      location: '/scim/v2/Users/user-uuid-john-doe-001',
    },
  },

  'mary.johnson': {
    id: 'user-uuid-mary-johnson-002',
    userName: 'mary.johnson',
    displayName: 'Mary Johnson',
    active: true,
    schemas: [
      'urn:ietf:params:scim:schemas:core:2.0:User',
      'urn:ietf:params:scim:schemas:sailpoint:1.0:User',
    ],
    name: {
      formatted: 'Mary Johnson',
      familyName: 'Johnson',
      givenName: 'Mary',
    },
    emails: [{ value: 'mary.johnson@company.com', type: 'work', primary: true }],
    'urn:ietf:params:scim:schemas:sailpoint:1.0:User': {
      employeeNumber: 'E12346',
      department: 'Engineering',
      title: 'Software Engineer',
      location: 'San Francisco',
      manager: {
        id: 'user-uuid-bob-lead-011',
        displayName: 'Bob Lead',
        $ref: '/scim/v2/Users/user-uuid-bob-lead-011',
      },
      lifecycleState: 'active',
      roles: [{ id: 'role-uuid-eng-user-002', displayName: 'Engineering User' }],
      workerType: 'employee',
      riskScore: 28,
      entitlements: [
        {
          id: 'ent-003',
          displayName: 'AD_Engineering_Group',
          value: 'CN=Engineering,OU=Groups,DC=company,DC=com',
          application: { id: 'app-ad-001', displayName: 'Active Directory' },
          type: 'group',
        },
      ],
    },
    meta: {
      resourceType: 'User',
      created: '2024-03-20T10:00:00Z',
      lastModified: '2026-01-15T11:30:00Z',
      location: '/scim/v2/Users/user-uuid-mary-johnson-002',
    },
  },

  'bob.smith': {
    id: 'user-uuid-bob-smith-003',
    userName: 'bob.smith',
    displayName: 'Bob Smith',
    active: true,
    schemas: [
      'urn:ietf:params:scim:schemas:core:2.0:User',
      'urn:ietf:params:scim:schemas:sailpoint:1.0:User',
    ],
    name: {
      formatted: 'Bob Smith',
      familyName: 'Smith',
      givenName: 'Bob',
    },
    emails: [{ value: 'bob.smith@company.com', type: 'work', primary: true }],
    'urn:ietf:params:scim:schemas:sailpoint:1.0:User': {
      employeeNumber: 'E12347',
      department: 'IT',
      title: 'IT Analyst',
      location: 'Chicago',
      lifecycleState: 'active',
      roles: [{ id: 'role-uuid-it-user-003', displayName: 'IT User' }],
      workerType: 'employee',
      riskScore: 15,
      entitlements: [
        {
          id: 'ent-004',
          displayName: 'AD_IT_Group',
          value: 'CN=IT,OU=Groups,DC=company,DC=com',
          application: { id: 'app-ad-001', displayName: 'Active Directory' },
          type: 'group',
        },
        {
          id: 'ent-005',
          displayName: 'SAP_IT_USER',
          value: 'SAP_IT_USER',
          application: { id: 'app-sap-001', displayName: 'SAP ECC' },
          type: 'group',
        },
      ],
    },
    meta: {
      resourceType: 'User',
      created: '2023-06-01T08:00:00Z',
      lastModified: '2026-03-01T09:15:00Z',
      location: '/scim/v2/Users/user-uuid-bob-smith-003',
    },
  },

  'future.hire': {
    id: 'user-uuid-future-hire-004',
    userName: 'future.hire',
    displayName: 'Future Hire',
    active: false,
    schemas: [
      'urn:ietf:params:scim:schemas:core:2.0:User',
      'urn:ietf:params:scim:schemas:sailpoint:1.0:User',
    ],
    name: {
      formatted: 'Future Hire',
      familyName: 'Hire',
      givenName: 'Future',
    },
    emails: [{ value: 'future.hire@company.com', type: 'work', primary: true }],
    'urn:ietf:params:scim:schemas:sailpoint:1.0:User': {
      employeeNumber: 'E12348',
      department: 'Engineering',
      title: 'Junior Engineer',
      location: 'Remote',
      lifecycleState: 'pre-hire',
      roles: [],
      workerType: 'employee',
      entitlements: [],
      startDate: '2026-06-01',
    },
    meta: {
      resourceType: 'User',
      created: '2026-03-01T12:00:00Z',
      lastModified: '2026-03-01T12:00:00Z',
      location: '/scim/v2/Users/user-uuid-future-hire-004',
    },
  },

  'terminated.user': {
    id: 'user-uuid-terminated-005',
    userName: 'terminated.user',
    displayName: 'Terminated User',
    active: false,
    schemas: [
      'urn:ietf:params:scim:schemas:core:2.0:User',
      'urn:ietf:params:scim:schemas:sailpoint:1.0:User',
    ],
    name: {
      formatted: 'Terminated User',
      familyName: 'User',
      givenName: 'Terminated',
    },
    emails: [{ value: 'terminated.user@company.com', type: 'work', primary: true }],
    'urn:ietf:params:scim:schemas:sailpoint:1.0:User': {
      employeeNumber: 'E12349',
      department: 'Operations',
      title: 'Operations Analyst',
      location: 'Dallas',
      lifecycleState: 'terminated',
      roles: [],
      workerType: 'employee',
      riskScore: 95,
      // Still has entitlements — triggers LEAVER_ACCESS_NOT_REVOKED
      entitlements: [
        {
          id: 'ent-006',
          displayName: 'AD_Operations_Group',
          value: 'CN=Operations,OU=Groups,DC=company,DC=com',
          application: { id: 'app-ad-001', displayName: 'Active Directory' },
          type: 'group',
        },
        {
          id: 'ent-007',
          displayName: 'SAP_OPS_USER',
          value: 'SAP_OPS_USER',
          application: { id: 'app-sap-001', displayName: 'SAP ECC' },
          type: 'group',
        },
      ],
      terminationDate: '2026-02-28',
    },
    meta: {
      resourceType: 'User',
      created: '2022-04-01T09:00:00Z',
      lastModified: '2026-02-28T17:00:00Z',
      location: '/scim/v2/Users/user-uuid-terminated-005',
    },
  },
};

// ─── Identity Lookup Helpers ──────────────────────────────────────────────────

/**
 * Returns the SCIM User resource for a given userName, or null if not found.
 * The optional scenario param can override behavior for specific test scenarios.
 */
export function getIdentityByUserName(
  userName: string,
  scenario?: string
): ScimUser | null {
  // identity_not_found scenario always returns null
  if (scenario === 'identity_not_found') {
    return null;
  }

  return IDENTITIES[userName] ?? null;
}

/**
 * Returns all identities as an array (for list endpoints).
 */
export function getAllIdentities(): ScimUser[] {
  return Object.values(IDENTITIES);
}

// ─── Account Fixtures ─────────────────────────────────────────────────────────
// Used by /Accounts SCIM endpoint. Maps accountId → account object.

export const ACCOUNTS: Record<string, ScimAccount> = {
  'acct-john-ad-001': {
    id: 'acct-john-ad-001',
    nativeIdentity: 'jdoe',
    displayName: 'John Doe (AD)',
    active: true,
    identity: { id: 'user-uuid-john-doe-001', displayName: 'John Doe' },
    application: { id: 'app-ad-001', displayName: 'Active Directory' },
    attributes: {
      sAMAccountName: 'jdoe',
      distinguishedName: 'CN=John Doe,OU=Finance,DC=company,DC=com',
      memberOf: ['CN=Finance,OU=Groups,DC=company,DC=com'],
    },
    entitlements: [{ displayName: 'AD_Finance_Group', value: 'CN=Finance,OU=Groups,DC=company,DC=com' }],
    meta: { lastModified: '2026-02-10T14:22:00Z' },
  },

  'acct-john-sap-001': {
    id: 'acct-john-sap-001',
    nativeIdentity: 'JDOE',
    displayName: 'John Doe (SAP)',
    active: true,
    identity: { id: 'user-uuid-john-doe-001', displayName: 'John Doe' },
    application: { id: 'app-sap-001', displayName: 'SAP ECC' },
    attributes: {
      SY_UNAME: 'JDOE',
      USTYP: 'A',
    },
    entitlements: [{ displayName: 'SAP_FI_USER', value: 'SAP_FI_USER' }],
    meta: { lastModified: '2026-02-01T08:00:00Z' },
  },

  'acct-mary-ad-001': {
    id: 'acct-mary-ad-001',
    nativeIdentity: 'mjohnson',
    displayName: 'Mary Johnson (AD)',
    active: true,
    identity: { id: 'user-uuid-mary-johnson-002', displayName: 'Mary Johnson' },
    application: { id: 'app-ad-001', displayName: 'Active Directory' },
    attributes: {
      sAMAccountName: 'mjohnson',
      distinguishedName: 'CN=Mary Johnson,OU=Engineering,DC=company,DC=com',
    },
    entitlements: [{ displayName: 'AD_Engineering_Group', value: 'CN=Engineering,OU=Groups,DC=company,DC=com' }],
    meta: { lastModified: '2026-01-15T11:30:00Z' },
  },

  'acct-bob-ad-001': {
    id: 'acct-bob-ad-001',
    nativeIdentity: 'bsmith',
    displayName: 'Bob Smith (AD)',
    active: true,
    identity: { id: 'user-uuid-bob-smith-003', displayName: 'Bob Smith' },
    application: { id: 'app-ad-001', displayName: 'Active Directory' },
    attributes: {
      sAMAccountName: 'bsmith',
      distinguishedName: 'CN=Bob Smith,OU=IT,DC=company,DC=com',
    },
    entitlements: [{ displayName: 'AD_IT_Group', value: 'CN=IT,OU=Groups,DC=company,DC=com' }],
    meta: { lastModified: '2026-03-01T09:15:00Z' },
  },

  'acct-bob-sap-001': {
    id: 'acct-bob-sap-001',
    nativeIdentity: 'BSMITH',
    displayName: 'Bob Smith (SAP)',
    active: true,
    identity: { id: 'user-uuid-bob-smith-003', displayName: 'Bob Smith' },
    application: { id: 'app-sap-001', displayName: 'SAP ECC' },
    attributes: {
      SY_UNAME: 'BSMITH',
      USTYP: 'A',
    },
    entitlements: [{ displayName: 'SAP_IT_USER', value: 'SAP_IT_USER' }],
    meta: { lastModified: '2026-03-01T09:15:00Z' },
  },

  // terminated.user still has ACTIVE accounts — triggers LEAVER_ACCESS_NOT_REVOKED
  'acct-terminated-ad-001': {
    id: 'acct-terminated-ad-001',
    nativeIdentity: 'tuser',
    displayName: 'Terminated User (AD)',
    active: true, // deliberately still active — leaver scenario
    identity: { id: 'user-uuid-terminated-005', displayName: 'Terminated User' },
    application: { id: 'app-ad-001', displayName: 'Active Directory' },
    attributes: {
      sAMAccountName: 'tuser',
      distinguishedName: 'CN=Terminated User,OU=Operations,DC=company,DC=com',
    },
    entitlements: [{ displayName: 'AD_Operations_Group', value: 'CN=Operations,OU=Groups,DC=company,DC=com' }],
    meta: { lastModified: '2026-02-28T17:00:00Z' },
  },

  'acct-terminated-sap-001': {
    id: 'acct-terminated-sap-001',
    nativeIdentity: 'TUSER',
    displayName: 'Terminated User (SAP)',
    active: true, // deliberately still active — leaver scenario
    identity: { id: 'user-uuid-terminated-005', displayName: 'Terminated User' },
    application: { id: 'app-sap-001', displayName: 'SAP ECC' },
    attributes: {
      SY_UNAME: 'TUSER',
      USTYP: 'A',
    },
    entitlements: [{ displayName: 'SAP_OPS_USER', value: 'SAP_OPS_USER' }],
    meta: { lastModified: '2026-02-28T17:00:00Z' },
  },
};

// Map from identityId to list of accountIds
const IDENTITY_ACCOUNTS_MAP: Record<string, string[]> = {
  'user-uuid-john-doe-001': ['acct-john-ad-001', 'acct-john-sap-001'],
  'user-uuid-mary-johnson-002': ['acct-mary-ad-001'],
  'user-uuid-bob-smith-003': ['acct-bob-ad-001', 'acct-bob-sap-001'],
  'user-uuid-terminated-005': ['acct-terminated-ad-001', 'acct-terminated-sap-001'],
};

// Also map by userName for convenience
const USERNAME_TO_ID: Record<string, string> = {
  'john.doe': 'user-uuid-john-doe-001',
  'mary.johnson': 'user-uuid-mary-johnson-002',
  'bob.smith': 'user-uuid-bob-smith-003',
  'future.hire': 'user-uuid-future-hire-004',
  'terminated.user': 'user-uuid-terminated-005',
};

/**
 * Returns all accounts for a given identityId (UUID).
 * For the leaver_access_not_revoked scenario, returns accounts even for inactive identity.
 */
export function getAccountsByIdentity(
  identityId: string,
  scenario?: string
): ScimAccount[] {
  // Support lookup by userName as well as UUID
  const resolvedId = USERNAME_TO_ID[identityId] ?? identityId;

  const accountIds = IDENTITY_ACCOUNTS_MAP[resolvedId] ?? [];
  return accountIds
    .map((id) => ACCOUNTS[id])
    .filter((a): a is ScimAccount => a !== undefined);
}

/**
 * Returns all accounts (for listing without identity filter).
 */
export function getAllAccounts(): ScimAccount[] {
  return Object.values(ACCOUNTS);
}
