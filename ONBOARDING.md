# IIQ RCA Agent — Onboarding Guide

A quick-start reference for teams connecting the agent to their live SailPoint IdentityIQ instance, ServiceNow environment, and LLM provider. Follow the sections in order; each builds on the last.

---

## Architecture Overview

```
ServiceNow (webhook)
        │
        ▼
  Agent Webhook  ←──── POST /webhook/incident
  (FastAPI :8000)
        │
        ├─ Incident Classifier (keyword scoring)
        │         │
        │    confidence ≥ 0.75 ──► Tier 1: Guided   (decision tree)
        │    confidence < 0.75 ──► Tier 3: Open      (LLM free-form)
        │    guided → UNKNOWN   ──► Tier 2: Adaptive  (LLM + evidence)
        │
        ▼
   MCP Server  (:3000, stdio subprocess)
   (Node.js, iiq-rca-server)
        │
        ▼
  SailPoint IIQ REST / SCIM API
        │
        ▼
  ServiceNow Table API  (write-back: work notes + state)
```

All credentials live in a single `.env` file at the project root. The agent process reads it at startup via `python-dotenv`; the MCP subprocess inherits `os.environ`.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Python | 3.11+ |
| Node.js | 18+ |
| SailPoint IdentityIQ | 8.x (SCIM v2 + REST API enabled) |
| ServiceNow | Tokyo / Utah / Vancouver or later |
| Anthropic API key | Required for Tier 2 / Tier 3 analysis |

Install Python deps:
```bash
pip install -r requirements.txt
```

Install and build the MCP server:
```bash
cd mcp-server
npm install
npm run build        # produces dist/index.js
```

---

## Step 1 — Copy and populate `.env`

```bash
cp .env.example .env
```

Open `.env` and fill in every `your-*` placeholder. The sections below explain each block.

---

## Step 2 — Connect to SailPoint IdentityIQ

```dotenv
# .env — IIQ section
IIQ_USE_MOCK=false                              # ← switch from mock to live
IIQ_BASE_URL=https://iiq.corp.example.com:8443/identityiq
IIQ_USERNAME=svc_api_integration               # service account username
IIQ_PASSWORD=<service-account-password>
IIQ_TIMEOUT_SECONDS=15                         # raise if IIQ is slow
IIQ_MAX_RETRIES=3
```

**Service account requirements in IIQ:**

The account named in `IIQ_USERNAME` needs these IIQ capabilities:
- `ViewIdentity` — read identity profiles (SCIM `GET /Users`)
- `ViewAccessRequest` — read access request history (REST `GET /accessRequests`)
- `ViewWorkItem` — read workflow instances (REST `GET /workflowInstances`)
- `ViewProvisioningTransaction` — read provisioning logs
- `ViewEntitlement` — read entitlement data (SCIM `GET /Accounts`)
- `ViewTaskResult` — read aggregation task results

**Where the credentials are consumed:**
`mcp-server/src/iiq-client/client.ts` — the `IIQClient` class picks up `IIQ_BASE_URL`, `IIQ_USERNAME`, and `IIQ_PASSWORD` exclusively from environment variables (never hardcoded). In mock mode (`IIQ_USE_MOCK=true`) it routes to `MOCK_IIQ_URL` instead and no real IIQ credentials are needed.

---

## Step 3 — Connect to ServiceNow

```dotenv
# .env — ServiceNow section
SNOW_BASE_URL=https://yourcompany.service-now.com
SNOW_USERNAME=svc_rca_agent
SNOW_PASSWORD=<service-account-password>
SNOW_IAM_ASSIGNMENT_GROUP=IAM-Ops-Team         # group for standard RCA results
SNOW_L3_ASSIGNMENT_GROUP=IAM-L3-Team           # group for escalations / UNKNOWN_STATUS
```

**Service account requirements in ServiceNow:**

The account named in `SNOW_USERNAME` needs:
- `itil` role — read/write access to incidents
- Ability to PATCH `work_notes`, `state`, `assignment_group`, `close_notes` on the `incident` table

**What the agent writes back:**
Each completed analysis PATCHes the incident via `PATCH /api/now/table/incident/{sys_id}`:

| Outcome | State | Assignment group | Notes format |
|---|---|---|---|
| Root cause identified | `2` (In Progress) | `SNOW_IAM_ASSIGNMENT_GROUP` | Standard RCA with `[tier: guided/adaptive]` header |
| Auto-resolvable (e.g. approval reminder) | `6` (Resolved) | — | Auto-resolved template |
| Unknown / low confidence | `2` (In Progress) | `SNOW_L3_ASSIGNMENT_GROUP` | Escalation template |

To change assignment group names, update the two `SNOW_*_ASSIGNMENT_GROUP` variables — no code changes needed.

**Setting up the ServiceNow webhook:**
Create a Business Rule or Flow on the `incident` table that fires on insert/update when `assignment_group = IAM-Ops-Team`. The outbound REST call should POST to:
```
POST http://<agent-host>:8000/webhook/incident
Content-Type: application/json

{
  "sys_id":           "{{incident.sys_id}}",
  "number":           "{{incident.number}}",
  "caller_id":        {"user_name": "{{incident.caller_id.user_name}}"},
  "short_description":"{{incident.short_description}}",
  "description":      "{{incident.description}}",
  "category":         "{{incident.category}}",
  "u_affected_app":   "{{incident.u_affected_app}}"
}
```

---

## Step 4 — Configure the LLM provider

The agent uses the LLM only for **Tier 2 (adaptive)** and **Tier 3 (open reasoning)** analysis. Tier 1 (guided) never calls an LLM. If your ticket mix is mostly well-formed IAM incidents, Tier 1 covers ~75% of cases; the LLM is rarely needed.

### Default: Anthropic Claude

```dotenv
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

The agent lazy-initialises `anthropic.AsyncAnthropic()` in `agent/agent/rca_agent.py`. The SDK reads `ANTHROPIC_API_KEY` automatically from the environment — no code changes required.

The model is set inside `_ask_claude_for_next_checks`:
```python
# agent/agent/rca_agent.py  ~line 555
response = await self._anthropic_client.messages.create(
    model="claude-sonnet-4-20250514",   # ← change model here
    max_tokens=1024,
    ...
)
```

To use a different Anthropic model (e.g. `claude-opus-4-20250514` for higher accuracy, `claude-haiku-4-5-20251001` for lower latency/cost), change the `model=` string.

### Switching to a different LLM provider (OpenAI, Azure, Gemini, etc.)

The LLM call is isolated to one method: `_ask_claude_for_next_checks` in `agent/agent/rca_agent.py`. The method must return a `list[ToolAction]` — each item has `tool_name`, `tool_input` (dict), and `rationale` (string), or a single `ToolAction("DONE", {}, reason)` to stop.

**OpenAI example:**
```python
# Replace the anthropic block with:
if self._llm_client is None:
    from openai import AsyncOpenAI
    self._llm_client = AsyncOpenAI()   # reads OPENAI_API_KEY from env

response = await self._llm_client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ],
    max_tokens=1024,
)
text = response.choices[0].message.content.strip()
# then the existing json.loads(text) parsing continues unchanged
```

The system prompt and JSON response format (`[{"tool_name":..., "tool_input":..., "rationale":...}]`) are provider-agnostic — only the SDK call changes.

**No LLM / fallback-only mode:**
If you set no API key and no LLM client, the agent falls back to a deterministic investigation sequence (identity → requests → workflow → provisioning) for Tier 2/3. This covers the most common access-request patterns without any LLM dependency. Tier 1 (guided) is always available regardless.

---

## Step 5 — Tune the hybrid execution model

```dotenv
# .env — Hybrid tuning
CONFIDENCE_THRESHOLD_GUIDED=0.75   # below this → open reasoning (LLM)
MAX_ADAPTIVE_TOOL_CALLS=10         # max extra tool calls in Tier 2
MAX_OPEN_REASONING_TOOL_CALLS=20   # max tool calls in Tier 3
```

| Variable | Effect of lowering | Effect of raising |
|---|---|---|
| `CONFIDENCE_THRESHOLD_GUIDED` | More tickets use LLM (Tier 3) | More tickets use guided path (no LLM) |
| `MAX_ADAPTIVE_TOOL_CALLS` | Adaptive tier gives up sooner | Adaptive tier investigates more deeply |
| `MAX_OPEN_REASONING_TOOL_CALLS` | Open reasoning gives up sooner | Open reasoning investigates more deeply |

Recommended starting values: `0.75 / 10 / 20`. Lower `CONFIDENCE_THRESHOLD_GUIDED` to `0.85` if you want to reduce LLM costs and your tickets are consistently well-described.

---

## Step 6 — Agent port and network

```dotenv
AGENT_PORT=8000      # port the FastAPI webhook listens on
```

The agent binds to `0.0.0.0:<AGENT_PORT>`. Ensure your ServiceNow instance (or outbound integration) can reach this host/port. In production, place an nginx/load-balancer in front and restrict access to ServiceNow's outbound IP ranges.

**Health check:**
```bash
curl http://localhost:8000/health
# → {"status":"ok","agent":"iiq-rca-agent","version":"1.0.0"}
```

---

## Step 7 — Start everything

Start in the correct order:

```bash
# 1. Start the mock server (dev only — skip for production)
cd mock-server && node dist/index.js

# 2. Start the agent (reads .env, spawns MCP server as subprocess automatically)
cd <project-root>
python -m agent.main
```

The agent start-up sequence:
1. Loads `.env` into `os.environ` via `python-dotenv`
2. Spawns `mcp-server/dist/index.js` as a stdio subprocess (Node.js)
3. Performs MCP `initialize` handshake
4. Starts the FastAPI/uvicorn webhook server on `AGENT_PORT`

You should see:
```
[main] Starting IIQ RCA Agent (mock=False)
[MCP Server] Starting in PRODUCTION mode
[MCP Server] Connected and ready. Tools: A1, A2, B1, B2, C1, C2, D1, D2, E1, E2, F1, F2
[main] Agent ready. Listening on port 8000
```

---

## Step 8 — Smoke test

Send a test incident directly to the webhook:

```bash
curl -X POST http://localhost:8000/webhook/incident \
  -H "Content-Type: application/json" \
  -d '{
    "sys_id": "TEST-001",
    "number": "INC0000001",
    "caller_id": {"user_name": "john.doe"},
    "short_description": "I submitted an access request 3 days ago and still have no access to SAP ECC",
    "description": "",
    "category": "Access",
    "u_affected_app": "SAP ECC"
  }'
```

Expected response structure:
```json
{
  "rca_code": "APPROVAL_PENDING_MANAGER",
  "confidence": "HIGH",
  "execution_tier": "guided",
  "summary": "...",
  "recommendation": "...",
  "checks_performed": ["A1", "B1", "C1"],
  "deviation_log": [],
  "sequence_hint": ["A1", "B1", "C1", "D1"]
}
```

---

## Configuration Quick Reference

| Variable | Where used | Required |
|---|---|---|
| `IIQ_USE_MOCK` | Routes MCP server to mock or live IIQ | Yes |
| `IIQ_BASE_URL` | MCP server HTTP client base URL | When `IIQ_USE_MOCK=false` |
| `IIQ_USERNAME` | Basic auth for all IIQ API calls | Yes |
| `IIQ_PASSWORD` | Basic auth for all IIQ API calls | Yes |
| `IIQ_TIMEOUT_SECONDS` | Per-request timeout to IIQ | No (default 10) |
| `IIQ_MAX_RETRIES` | Retries on 5xx / timeout from IIQ | No (default 3) |
| `SNOW_BASE_URL` | ServiceNow instance URL | Yes |
| `SNOW_USERNAME` | Basic auth for SNOW Table API | Yes |
| `SNOW_PASSWORD` | Basic auth for SNOW Table API | Yes |
| `SNOW_IAM_ASSIGNMENT_GROUP` | Group for resolved incidents | No (default `IAM-Ops-Team`) |
| `SNOW_L3_ASSIGNMENT_GROUP` | Group for escalations | No (default `IAM-L3-Team`) |
| `ANTHROPIC_API_KEY` | Anthropic SDK — Tier 2/3 LLM | No (fallback used if absent) |
| `AGENT_PORT` | FastAPI listen port | No (default 8000) |
| `CONFIDENCE_THRESHOLD_GUIDED` | Tier selection boundary | No (default 0.75) |
| `MAX_ADAPTIVE_TOOL_CALLS` | Tier 2 tool call budget | No (default 10) |
| `MAX_OPEN_REASONING_TOOL_CALLS` | Tier 3 tool call budget | No (default 20) |

---

## Common Issues

**`IIQ API error 401` on startup**
→ Verify `IIQ_USERNAME` / `IIQ_PASSWORD`. Confirm the service account is active and not locked in IIQ.

**`MCP server closed connection` immediately**
→ Node.js is not on PATH. On Windows the MCP client looks for `C:\Program Files\nodejs\node.exe`. Confirm with `where node`. On Linux/macOS ensure `node` is on `$PATH` before running the agent.

**ServiceNow write-back fails but RCA still returns 200**
→ SNOW errors are non-fatal. The JSON response will contain `"snow_writeback_error": "..."`. Check `SNOW_BASE_URL`, credentials, and that the sys_id in the payload matches an incident in your SNOW instance.

**`INSUFFICIENT_TICKET_DATA` returned**
→ The incident webhook payload contained no `caller_id.user_name`, no `u_affected_app`, and a description too short to act on. Ensure the Business Rule / Flow populates at least `caller_id` before triggering the webhook.

**All Tier 2/3 results are `UNKNOWN_STATUS`**
→ `ANTHROPIC_API_KEY` is not set. The deterministic fallback investigates identity → requests → workflow → provisioning but has limited coverage for unusual patterns. Set the API key for full LLM-backed reasoning.
