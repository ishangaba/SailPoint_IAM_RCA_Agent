# IIQ RCA Agent — MCP Server Technical Reference

A detailed guide to the Model Context Protocol (MCP) server that bridges the Python RCA agent and SailPoint IdentityIQ. Read this document to understand what each capability does, how the server is structured, how caching works, and what the agent receives from each tool call.

---

## What Is the MCP Server?

The MCP server is a **Node.js subprocess** that the Python agent spawns on startup. It runs as a separate process and communicates with the agent over **stdio** using the Model Context Protocol — a structured JSON protocol for tool invocation. The agent calls tools by name; the MCP server executes the corresponding IIQ API calls and returns structured JSON results.

```
Python Agent (port 8000)
        │
        │  MCP protocol over stdio (JSON-RPC)
        ▼
  MCP Server (Node.js subprocess)
        │
        │  HTTP — SCIM v2 + REST API
        ▼
  SailPoint IdentityIQ
```

**Key design constraints:**
- `stdout` is reserved exclusively for the MCP protocol. All logging goes to `stderr`.
- The server inherits environment variables from the Python agent process (credentials are never hardcoded).
- In mock mode (`IIQ_USE_MOCK=true`) the server routes all HTTP to the local mock server instead of a real IIQ instance.

---

## Startup Sequence

1. Python agent calls `asyncio.create_subprocess_exec("node", "mcp-server/dist/index.js")`
2. MCP server loads `.env` via `dotenv/config`
3. `createIIQClient()` reads `IIQ_USE_MOCK`, `IIQ_BASE_URL`, `IIQ_USERNAME`, `IIQ_PASSWORD` from env
4. All 12 capabilities are registered on the `McpServer` instance
5. `StdioServerTransport` connects — server is now ready to accept tool calls
6. Agent performs MCP `initialize` handshake and receives the capability list
7. Periodic jobs start: cache stats logged every 60 s, expired entries evicted every 5 min

Startup log (stderr):
```
[MCP Server] Starting in PRODUCTION mode
[MCP Server] Node.js v20.x.x
[IIQClient] Mode: PRODUCTION → https://iiq.corp.example.com:8443/identityiq
[MCP Server] Registered 12 tools: Cap1 (iiq_identity_get), Cap2 ...
[MCP Server] Connected and ready. Capabilities: Cap1–Cap12 (12 tools registered)
```

---

## IIQ HTTP Client

**File:** `mcp-server/src/iiq-client/client.ts`

All HTTP traffic to IIQ goes through `IIQClient`, a thin axios wrapper with built-in retry logic.

### Retry Behaviour

| Condition | Action |
|---|---|
| `404` | Not an error — returns `{ exists: false, Resources: [], totalResults: 0 }` |
| `401` on first attempt | Retries once (handles stale session tokens) |
| `429` | Waits `Retry-After` header value (default 60 s), then retries |
| `5xx`, timeout, `ECONNREFUSED` | Exponential backoff: 1 s → 2 s → 4 s (up to `IIQ_MAX_RETRIES`) |
| Any other error | Thrown immediately — no retry |

After retries are exhausted, the client throws `Error("IIQ API error <status> on <method> <path>: ...")`. This propagates through the MCP tool handler → MCP protocol error → Python agent's `mcp_client.py` raises `RuntimeError` → the agent marks the investigation step as failed and may escalate to a higher tier.

### Configuration (from env)

| Variable | Default | Purpose |
|---|---|---|
| `IIQ_BASE_URL` | — | Full base URL including context root |
| `IIQ_USERNAME` | `svc_api_integration` | Basic auth username |
| `IIQ_PASSWORD` | — | Basic auth password |
| `IIQ_TIMEOUT_SECONDS` | `10` | Per-request timeout |
| `IIQ_MAX_RETRIES` | `3` | Max retry attempts for retriable errors |

---

## In-Memory Cache

**File:** `mcp-server/src/cache/cache.ts`

The cache is a singleton `Map` with per-entry TTL. Its purpose is to reduce IIQ API load when the agent calls the same tool multiple times in one investigation (e.g. identity profile checked by both Capability 1 and later re-read during entitlement analysis).

**Mock mode:** When `IIQ_USE_MOCK=true`, the cache is fully disabled — every `get()` returns `undefined` and every `set()` is a no-op. This ensures test overrides (injected via the mock server's `break_tool` endpoint) always reach the HTTP layer rather than being served from cache.

### TTL Reference

| Cache key pattern | TTL | Capabilities |
|---|---|---|
| `identity:{userName}` | 5 min | Cap1, Cap2 |
| `exists:{userName}` | 5 min | Cap2 |
| `entitlements:{identityId}` | 5 min | Cap9, Cap10 |
| `ent_check:{id}:{app}:{name}` | 5 min | Cap10 |
| `workflow:{workflowId}` | 60 sec | Cap5 |
| `workflows:{identityId}` | 2 min | Cap6 |
| `request:{requestId}` | 2 min | Cap4 |
| `tasks:{application}` | 10 min | Cap11 |
| `freshness:{application}` | 10 min | Cap12 |
| `prov_tx:{transactionId}` | 5 min | Cap8 |
| Access request list (Cap3) | **NO CACHE** | Request states change too frequently |
| Provisioning transaction list (Cap7) | **NO CACHE** | Results are time-windowed and change |

---

## Capabilities Reference

The MCP server exposes 12 capabilities across 6 domains. Each capability maps directly to one or more IIQ API endpoints.

---

### Domain: Identity

#### Capability 1 — `iiq_identity_get`

Returns the full identity profile for a user from IIQ's SCIM v2 API.

**IIQ endpoint:** `GET /scim/v2/Users?filter=userName eq "{id}"`

**Inputs:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `identity_id` | string | required | Username, employee ID, or UUID |
| `include_roles` | boolean | `true` | Include assigned roles in response |
| `include_entitlements` | boolean | `false` | Include all entitlements (heavier payload) |

**Output shape:**
```json
{
  "id": "abc123",
  "userName": "john.doe",
  "displayName": "John Doe",
  "active": true,
  "lifecycleState": "active",
  "department": "Engineering",
  "manager": { "value": "jane.smith", "displayName": "Jane Smith" },
  "startDate": "2024-01-15",
  "roles": [{ "value": "Employee", "displayName": "Employee" }]
}
```

If the identity does not exist: `{ "exists": false, "identity_id": "john.doe" }`

**Cache:** `identity:{userName}` — TTL 5 min

**When to use:** First call in every RCA investigation. Determines if the user exists, is active, and has a manager.

---

#### Capability 2 — `iiq_identity_check_exists`

Lightweight existence check — only returns `exists`, `id`, and `active`. Approximately 100 ms response time vs. the full profile fetch.

**IIQ endpoint:** `GET /scim/v2/Users?filter=userName eq "{id}"&attributes=id,userName,active`

**Inputs:**

| Parameter | Type | Description |
|---|---|---|
| `identity_id` | string | Username to check |

**Output shape:**
```json
{ "exists": true, "id": "abc123", "active": true }
// or
{ "exists": false }
```

**Cache:** `exists:{userName}` — TTL 5 min

**When to use:** When you only need to confirm a user exists before committing to a full profile fetch. Saves payload size and latency for simple existence checks.

---

### Domain: Access Requests

#### Capability 3 — `iiq_request_search`

Searches access requests submitted for or by an identity. Returns requests ordered most-recent first, including the `workflowCaseId` needed for workflow status checks.

**IIQ endpoint:** `GET /rest/accessRequests`

**Inputs:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `identity_id` | string | required | Username to search |
| `status` | enum | `All` | `Pending`, `Approved`, `Rejected`, `Completed`, `Failed`, `All` |
| `days_back` | number | `30` | Lookback window in days (max 180) |
| `application` | string | — | Filter to a specific application |
| `scenario` | string | — | Test scenario name (ignored by production IIQ) |

**Output shape:**
```json
{
  "requests": [
    {
      "id": "AR-2024-001",
      "status": "Pending",
      "requestedFor": "john.doe",
      "requestedItems": [{ "name": "SAP ECC Access", "application": "SAP ECC" }],
      "workflowCaseId": "WF-12345",
      "created": "2024-03-10T09:00:00Z"
    }
  ],
  "total": 1
}
```

**Cache:** None — request states change too frequently.

**What the agent infers:**
- `total == 0` → `NO_ACCESS_REQUEST_FOUND` (user never submitted a request)
- `status == "Rejected"` → `REQUEST_REJECTED` (no further investigation needed)
- `status == "Pending"` + `workflowCaseId` present → proceed to Cap5 (workflow check)

---

#### Capability 4 — `iiq_request_get_details`

Returns the complete details of a single access request by ID, including full approval history and all requested items.

**IIQ endpoint:** `GET /rest/accessRequests/{request_id}`

**Inputs:**

| Parameter | Type | Description |
|---|---|---|
| `request_id` | string | Access request ID (e.g. `"REQ-2024-001234"`) |

**Output shape:** Full `IIQAccessRequest` object with items, approvers, and timeline.

**Cache:** `request:{requestId}` — TTL 2 min

**When to use:** After Cap3 identifies a specific request and you need the full approval chain to diagnose why it is stuck.

---

### Domain: Workflows

#### Capability 5 — `iiq_workflow_get_status`

Returns the current status and step details of a workflow instance. Computes `ageHours` from the `launched` timestamp so the agent can detect approval-stuck scenarios without date arithmetic.

**IIQ endpoint:** `GET /rest/workflowInstances/{workflow_id}`

**Inputs:**

| Parameter | Type | Description |
|---|---|---|
| `workflow_id` | string | Workflow case ID obtained from Cap3/Cap4 |

**Output shape:**
```json
{
  "id": "WF-12345",
  "name": "Access Request Approval",
  "status": "Running",
  "currentStep": "Wait for Manager Approval",
  "launched": "2024-03-08T10:00:00Z",
  "ageHours": 125.3,
  "steps": [...]
}
```

**Cache:** `workflow:{workflowId}` — TTL 60 sec (short TTL — workflow status changes)

**What the agent infers:**
- `status == "Running"` + step contains `"approval"` or `"wait"` + `ageHours > 48` → `APPROVAL_PENDING_MANAGER`

---

#### Capability 6 — `iiq_workflow_list_launched`

Lists all workflow instances launched for an identity within a time window, with optional filters by workflow name and status.

**IIQ endpoint:** `GET /scim/v2/LaunchedWorkflows?filter=target.userName eq "{id}" and launched gt "{date}"`

**Inputs:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `identity_id` | string | required | Username whose workflows to list |
| `workflow_name` | string | — | Filter by workflow name substring |
| `status` | enum | `All` | `Running`, `Failed`, `Complete`, `All` |
| `days_back` | number | `30` | Lookback window |

**Cache:** `workflows:{identityId}` — TTL 2 min (full list cached; filters applied in-memory)

**When to use:** When the `workflowCaseId` is not known from the access request. Useful for joiner/leaver flows where no access request exists but a provisioning workflow was triggered directly.

---

### Domain: Provisioning

#### Capability 7 — `iiq_provisioning_search_transactions`

Searches provisioning transactions to find failures that explain why approved access was not granted.

**IIQ endpoint:** `GET /rest/provisioningTransactions`

**Inputs:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `identity_id` | string | required | Username to search |
| `status` | enum | `Failed` | `Success`, `Failed`, `Pending`, `All` |
| `application` | string | — | Filter by target application |
| `days_back` | number | `7` | Lookback window (max 90) |
| `operation_type` | enum | — | `Create`, `Modify`, `Delete`, `Enable`, `Disable` |
| `scenario` | string | — | Test scenario name (ignored in production) |

**Output shape:**
```json
{
  "transactions": [
    {
      "id": "TX-001",
      "status": "Failed",
      "applicationName": "SAP ECC",
      "operation": "Create",
      "errorMessages": ["Connection timeout to SAP connector"],
      "created": "2024-03-12T14:00:00Z"
    }
  ],
  "total": 1
}
```

**Cache:** None — provisioning states change during active investigations.

**What the agent infers from `errorMessages`:**
- `"quota"` / `"api_error"` / `"member limit"` → `PROVISIONING_API_LIMIT`
- `"timeout"` / `"timed out"` → `PROVISIONING_TIMEOUT`
- `"duplicate"` / `"already exists"` → `PROVISIONING_ACCOUNT_EXISTS`
- `"sod"` / `"segregation"` → `PROVISIONING_SOD_VIOLATION`
- Anything else → `PROVISIONING_CONNECTOR_ERROR`

---

#### Capability 8 — `iiq_provisioning_get_details`

Returns the complete provisioning transaction object including the full `accountRequest` with all attribute changes, error messages, and retry count.

**IIQ endpoint:** `GET /rest/provisioningTransactions/{transaction_id}`

**Inputs:**

| Parameter | Type | Description |
|---|---|---|
| `transaction_id` | string | Transaction ID from Cap7 |

**Cache:** `prov_tx:{transactionId}` — TTL 5 min

**When to use:** After Cap7 identifies a failed transaction and you need the exact error message and account-level detail to form the RCA recommendation.

---

### Domain: Entitlements

#### Capability 9 — `iiq_entitlement_get_all`

Returns every entitlement currently assigned to an identity, grouped by application.

**IIQ endpoint:** `GET /scim/v2/Users?filter=...&attributes=id,userName,entitlements`

**Inputs:**

| Parameter | Type | Description |
|---|---|---|
| `identity_id` | string | Username or UUID |
| `application` | string | Optional: filter to one application |

**Output shape:**
```json
{
  "identity": { "id": "abc123", "userName": "john.doe" },
  "entitlements": [...],
  "total": 12,
  "by_application": {
    "SAP ECC": [{ "displayName": "SAP_ROLE_FI_AP", "value": "FI_AP" }],
    "GitHub Enterprise": [...]
  }
}
```

**Cache:** `entitlements:{identityId}` — TTL 5 min (application filter applied in-memory from cache)

**When to use:** In leaver investigations — check if a terminated user still has active entitlements. Also used to verify whether provisioning actually completed.

---

#### Capability 10 — `iiq_entitlement_check_present`

Targeted yes/no check: is a specific named entitlement currently assigned to an identity on a given application?

**IIQ endpoint:** Same SCIM endpoint as Cap9 with `entitlements` attribute, filtered client-side.

**Inputs:**

| Parameter | Type | Description |
|---|---|---|
| `identity_id` | string | Username or UUID |
| `entitlement_name` | string | Entitlement `displayName` or `value` (e.g. `"SAP_ROLE_FI_AP"`) |
| `application` | string | Application `displayName` to scope search |

**Output shape:**
```json
{ "present": true, "entitlement": { ... }, "identity_active": true }
// or
{ "present": false, "identity_active": true }
```

**Cache:** `ent_check:{id}:{application}:{name}` — TTL 5 min

**When to use:** Quick verification after provisioning completes, or to confirm access was actually revoked for a leaver.

---

### Domain: Aggregation / Tasks

#### Capability 11 — `iiq_task_get_results`

Returns recent aggregation task results for an application with computed `consecutive_failures` count and timestamps for the last success and last error.

**IIQ endpoint:** `GET /rest/taskResults`

**Inputs:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `application` | string | required | Application name |
| `task_type` | enum | `Aggregation` | `Aggregation`, `Refresh`, `Provisioning` |
| `limit` | number | `5` | Last N results to retrieve (max 20) |
| `scenario` | string | — | Test scenario name (ignored in production) |

**Output shape:**
```json
{
  "tasks": [
    { "id": "T1", "status": "Error", "completed": "2024-03-12T02:00:00Z", "messages": [...] }
  ],
  "total": 5,
  "last_success": "2024-03-10T02:00:00Z",
  "last_error": "2024-03-12T02:00:00Z",
  "consecutive_failures": 3
}
```

**Cache:** `tasks:{application}` (or `tasks:{application}:{scenario}` in test mode) — TTL 10 min

**What the agent infers:**
- `consecutive_failures >= 3` → `AGGREGATION_REPEATED_FAILURES`
- Any task message containing `"401"` or `"unauthorized"` → `AGGREGATION_REPEATED_FAILURES`

---

#### Capability 12 — `iiq_task_check_freshness`

Computes a staleness verdict for an application's aggregation data. Uses the same task results endpoint as Cap11 but returns a human-readable `assessment` instead of raw task records.

**IIQ endpoint:** `GET /rest/taskResults` (with `limit: 10`)

**Inputs:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `application` | string | required | Application name |
| `expected_frequency_hours` | number | `24` | How often this app normally aggregates |
| `staleness_threshold_multiplier` | number | `1.5` | Data is stale if age > `expected × multiplier` |
| `scenario` | string | — | Test scenario name (ignored in production) |

**Output shape:**
```json
{
  "application": "Active Directory",
  "is_fresh": false,
  "last_aggregation": "2024-03-10T02:00:00Z",
  "age_hours": 61.2,
  "expected_frequency_hours": 24,
  "staleness_threshold_hours": 36,
  "assessment": "STALE",
  "consecutive_failures": 0
}
```

**Assessment values:**

| Value | Meaning |
|---|---|
| `FRESH` | Last aggregation is within the staleness threshold |
| `STALE` | Last aggregation exceeds `expected × multiplier` hours ago |
| `NEVER_RUN` | No aggregation task has ever run for this application |
| `RUNNING` | A task is currently in-flight (may not have a prior success) |

**Cache:** `freshness:{application}` — TTL 10 min

**What the agent infers:**
- `assessment == "STALE"` → `AGGREGATION_STALE_DATA`
- `assessment == "NEVER_RUN"` → `AGGREGATION_NEVER_RUN`

---

## How the Agent Uses the Capabilities

The 12 capabilities map to investigation patterns. The agent selects which ones to call based on the incident type and tier:

### Standard access request chain (Tier 1 / Tier 2)
```
Cap1 (identity profile)
  → identity inactive?         → IDENTITY_INACTIVE
  → identity not found?        → IDENTITY_NOT_FOUND
Cap3 (request search)
  → no request?                → NO_ACCESS_REQUEST_FOUND
  → request rejected?          → REQUEST_REJECTED
Cap5 (workflow status)
  → stuck in approval > 48h?   → APPROVAL_PENDING_MANAGER
Cap7 (provisioning search)
  → connector error?           → PROVISIONING_CONNECTOR_ERROR (etc.)
```

### Aggregation health chain
```
Cap12 (freshness check)
  → STALE / NEVER_RUN          → AGGREGATION_STALE_DATA / AGGREGATION_NEVER_RUN
Cap11 (task results)
  → 3+ consecutive failures    → AGGREGATION_REPEATED_FAILURES
```

### Leaver investigation chain
```
Cap1 (identity profile)
  → lifecycleState = terminated?
Cap9 (entitlement get all)
  → total > 0?                 → LEAVER_ACCESS_NOT_REVOKED
```

### Joiner investigation chain
```
Cap1 (identity profile)
  → startDate in future?       → JOINER_NOT_YET_STARTED
  → identity missing entirely? → JOINER_IDENTITY_MISSING
```

---

## Tool Result Flow

```
Agent calls tool via MCP protocol
        │
        ▼
MCP server handler runs
        │
        ├── Cache HIT? → return cached JSON immediately
        │
        └── Cache MISS → IIQClient.get() / .post()
                │
                ├── Success → normalise → cache → return JSON
                │
                └── Error → retry with backoff
                          → if exhausted: throw Error
                          → MCP protocol error response
                          → agent mcp_client.py raises RuntimeError
                          → agent marks step failed → had_deviation = True
                          → may escalate to Adaptive tier
```

---

## Adding a New Capability

1. Create a new file in `mcp-server/src/tools/` following the existing pattern (register via `server.tool(...)`, use `IIQClient` for HTTP, apply caching with a TTL constant from `cache.ts`)
2. Export a `registerXxxTools(server, client)` function
3. Import and call it in `mcp-server/src/index.ts`
4. Add the new capability's cache key pattern and TTL constant to `cache.ts`
5. Run `npm run build` in `mcp-server/` to compile
6. Restart the agent process — it re-spawns the MCP subprocess automatically

---

## Logging

All MCP server logs go to **stderr** only — stdout is reserved for the MCP protocol wire format.

| Prefix | Source |
|---|---|
| `[MCP Server]` | Startup, registration, transport events |
| `[IIQClient]` | HTTP request errors, retries, 404 normalisations |
| `[cache]` | Cache HITs, MISSes, eviction stats, periodic stats |
| `[Cap1]`–`[Cap12]` | Per-capability request details and result summaries |

To view logs in real time when running locally:
```bash
python -m agent.main 2>&1 | grep -E "\[MCP|IIQClient|cache|Cap"
```
