# SailPoint IdentityIQ RCA Engine

An automated Root Cause Analysis (RCA) engine for SailPoint IdentityIQ incidents, surfaced via a ServiceNow webhook and powered by an MCP-based tool layer.

## Overview

- Receives ServiceNow incident webhooks, classifies them by type (access request, provisioning, aggregation, joiner, leaver, policy violation), and executes a purpose-built decision tree of IIQ API checks.
- Uses an MCP (Model Context Protocol) server as the tool layer, giving the agent structured, auditable access to IIQ SCIM/REST APIs without direct HTTP coupling.
- Returns a structured RCA report — including root cause code, confidence level, evidence, recommendation, and escalation path — and optionally writes findings back to the ServiceNow incident.

---

## Architecture

```
ServiceNow
    |
    | POST /webhook/incident
    v
+-------------------+
|  Python RCA Agent  |  (FastAPI, port 8000)
|  agent/main.py     |
|  agent/rca_agent.py|
+--------+----------+
         | stdio (MCP protocol)
         v
+-------------------+
|   MCP Server       |  (Node.js / TypeScript, subprocess)
|   12 IIQ tools     |
+--------+----------+
         | HTTP REST
         v
+-------------------+
|  Mock IIQ Server   |  (Express, port 3001)   <-- dev/test
|  OR                |
|  Real IIQ Instance |  (port 8080)            <-- production
+-------------------+

         +
         | HTTP REST
         v
+-------------------+
|  ServiceNow API    |  (write-back: notes, assignment, resolution)
+-------------------+
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20 or later |
| Python | 3.12 or later |
| Docker + Docker Compose | 24+ (optional, for containerised runs) |

---

## Local Development Setup

### 1. Clone and enter the repository

```bash
git clone <repo-url>
cd sailpoint-rca-agent
```

### 2. Install mock server dependencies and start it

```bash
cd mock-server
npm ci
npm run build
npm start
# Listening on http://localhost:3001
```

### 3. Install MCP server dependencies and build

```bash
cd ../mcp-server
npm ci
npm run build
# The agent launches this as a subprocess — no need to start it manually.
```

### 4. Configure and start the Python agent

```bash
cd ../agent

# Copy the example env file and fill in values
cp .env.example .env
# Key values for local mock mode (defaults shown):
#   IIQ_USE_MOCK=true
#   MOCK_IIQ_URL=http://localhost:3001
#   IIQ_USERNAME=svc_api_integration
#   IIQ_PASSWORD=mock-password
#   SNOW_BASE_URL=http://localhost:3001
#   SNOW_USERNAME=svc_rca_agent
#   SNOW_PASSWORD=mock-snow-password

pip install -r requirements.txt
python main.py
# API available at http://localhost:8000
```

### 5. (Optional) Run with Docker Compose

```bash
# Start mock server + MCP server + agent
docker compose up --build

# Run integration tests (separate profile)
docker compose --profile test up --build tests
```

---

## Running the Tests

Install test dependencies (from the repo root):

```bash
pip install pytest pytest-asyncio httpx
```

Run the full suite (mock server and agent must both be running):

```bash
pytest tests/ -v --tb=short
```

| Test file | Scenarios covered |
|---|---|
| `test_rca_access_request.py` | `access_request_stuck_approval` — APPROVAL_PENDING_MANAGER; agent health check |
| `test_rca_provisioning.py` | `provisioning_connector_error` — PROVISIONING_CONNECTOR_ERROR; `github_api_limit` — PROVISIONING_API_LIMIT |
| `test_rca_aggregation.py` | `aggregation_stale` — AGGREGATION_STALE_DATA (exercises parallel F1+F2 execution path) |
| `test_rca_joiner.py` | `identity_not_found` — IDENTITY_NOT_FOUND; `joiner_not_started` — JOINER_NOT_YET_STARTED |
| `test_rca_leaver.py` | `leaver_access_not_revoked` — LEAVER_ACCESS_NOT_REVOKED; `unknown_all_checks_pass` — UNKNOWN_STATUS |

---

## Switching from Mock to Production

Change exactly two environment variables in `agent/.env`:

```bash
# Before (mock mode)
IIQ_USE_MOCK=true
MOCK_IIQ_URL=http://localhost:3001

# After (production)
IIQ_USE_MOCK=false
IIQ_BASE_URL=https://your-iiq-instance.example.com:8080
```

All other settings (credentials, ServiceNow URL, assignment groups) are already environment-driven and require no code changes.

---

## Making an RCA Request

POST a ServiceNow-style incident payload to the agent webhook:

```bash
curl -X POST http://localhost:8000/webhook/incident \
  -H "Content-Type: application/json" \
  -d '{
    "sys_id": "INC0001234",
    "number": "INC0001234",
    "caller_id": {"user_name": "john.doe"},
    "short_description": "I submitted an access request for SAP Finance 5 days ago but still do not have access",
    "description": "Submitted via self-service portal. Request ID visible in IIQ.",
    "category": "Access",
    "u_affected_app": "SAP ECC",
    "scenario": "access_request_stuck_approval"
  }'
```

Example response:

```json
{
  "rca_code": "APPROVAL_PENDING_MANAGER",
  "confidence": "HIGH",
  "summary": "The access request for 'john.doe' is waiting for manager approval (approver: jane.manager).",
  "root_cause": "Access request is stuck pending manager approval.",
  "recommendation": "Send an approval reminder to the manager (jane.manager). If no action after 72 hours, escalate to IAM-Ops.",
  "auto_resolvable": true,
  "auto_resolution_action": "send_approval_reminder",
  "escalation_path": "IAM-Ops",
  "checks_performed": ["A1", "B1", "C1"],
  "rca_duration_ms": 312,
  "evidence": {}
}
```

The `scenario` field is only used when talking to the mock server — it routes the request to the correct fixture. Remove it in production.

---

## The 8 Test Scenarios

| Scenario | Caller ID | Short Description | Expected RCA Code |
|---|---|---|---|
| `access_request_stuck_approval` | `john.doe` | Access request submitted 5 days ago, no access yet | `APPROVAL_PENDING_MANAGER` |
| `provisioning_connector_error` | `john.doe` | Request approved a week ago, cannot log in to Active Directory | `PROVISIONING_CONNECTOR_ERROR` |
| `github_api_limit` | `mary.johnson` | Not added to GitHub Engineering team despite approved request | `PROVISIONING_API_LIMIT` |
| `aggregation_stale` | `bob.smith` | GitHub aggregation failing for 2 days, data is stale | `AGGREGATION_STALE_DATA` |
| `identity_not_found` | `nonexistent.user` | New hire cannot log in, account does not exist | `IDENTITY_NOT_FOUND` |
| `joiner_not_started` | `future.hire` | New hire onboarding, no accounts created yet | `JOINER_NOT_YET_STARTED` |
| `leaver_access_not_revoked` | `terminated.user` | Terminated employee still has active SAP and AD accounts | `LEAVER_ACCESS_NOT_REVOKED` |
| `unknown_all_checks_pass` | `bob.smith` | Cannot access SAP but all checks pass | `UNKNOWN_STATUS` |

---

## Project Structure

```
sailpoint-rca-agent/
├── mock-server/                  # TypeScript Express — serves all 8 scenario fixtures
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/               # IIQ SCIM/REST + ServiceNow routes
│   │   └── fixtures/             # Per-scenario response data
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── mcp-server/                   # TypeScript MCP — 12 IIQ tools over stdio
│   ├── src/
│   │   ├── index.ts
│   │   ├── tools/                # iiq_identity_get, iiq_request_search, etc.
│   │   ├── iiq-client/           # HTTP client wrapping IIQ APIs
│   │   └── types/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── agent/                        # Python FastAPI RCA agent
│   ├── agent/
│   │   ├── rca_agent.py          # Orchestrator with parallel check support (asyncio.gather)
│   │   ├── incident_classifier.py
│   │   ├── decision_trees.py
│   │   └── rca_codes.py
│   ├── servicenow/
│   │   ├── client.py
│   │   ├── webhook.py
│   │   └── writeback.py
│   ├── mcp_client.py             # stdio MCP client
│   ├── config.py                 # Pydantic settings (env-driven)
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile                # Builds mcp-server inside the agent image
│
├── tests/                        # pytest integration test suite
│   ├── __init__.py
│   ├── conftest.py               # Shared fixtures and make_incident_payload helper
│   ├── test_rca_access_request.py
│   ├── test_rca_provisioning.py
│   ├── test_rca_aggregation.py
│   ├── test_rca_joiner.py
│   └── test_rca_leaver.py
│
├── docker-compose.yml            # Orchestrates all four services
└── README.md
```

---

## Security Notes

- **No credentials in source code.** All secrets (IIQ password, ServiceNow password, API keys) are injected exclusively via environment variables or a `.env` file that is never committed. Add `.env` to `.gitignore`.
- **TLS in production.** The agent and mock server communicate over plain HTTP for local development only. In production, `IIQ_BASE_URL` and `SNOW_BASE_URL` must use `https://` endpoints with valid certificates. Terminate TLS at a reverse proxy (nginx/Traefik) in front of the FastAPI app.
- **Service account least privilege.** The IIQ service account (`svc_api_integration`) should be granted read-only access to the SCIM and task APIs, and write access only to the provisioning retry endpoint. It should not have administrator rights.
- **ServiceNow write-back credentials** (`svc_rca_agent`) need only the `incident_write` and `itil` roles — not admin.
