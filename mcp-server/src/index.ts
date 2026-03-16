// ─── MCP Server Entry Point ───────────────────────────────────────────────────
// Registers all Phase 1 + Phase 2 tools and connects via StdioServerTransport.
// IMPORTANT: stdout is reserved exclusively for the MCP protocol.
//            All logging must go to stderr via console.error.

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createIIQClient } from './iiq-client/client.js';
import { registerIdentityTools } from './tools/identity.js';
import { registerRequestTools } from './tools/requests.js';
import { registerWorkflowTools } from './tools/workflows.js';
import { registerProvisioningTools } from './tools/provisioning.js';
import { registerEntitlementTools } from './tools/entitlements.js';
import { registerTaskTools } from './tools/tasks.js';
import { cache } from './cache/cache.js';

async function main(): Promise<void> {
  const useMock = process.env['IIQ_USE_MOCK'] === 'true';
  const mode = useMock ? 'MOCK' : 'PRODUCTION';
  console.error(`[MCP Server] Starting in ${mode} mode`);
  console.error(`[MCP Server] Node.js ${process.version}`);

  // Build the IIQ HTTP client (reads all credentials from env vars)
  let client;
  try {
    client = createIIQClient();
  } catch (err) {
    console.error('[MCP Server] Failed to create IIQ client:', err);
    process.exit(1);
  }

  // Create the MCP server instance
  const server = new McpServer({
    name: 'iiq-rca-server',
    version: '2.0.0',
  });

  // ─── Register all tools (Phase 1 + Phase 2) ──────────────────────────────
  // A1: iiq_identity_get
  // A2: iiq_identity_check_exists
  registerIdentityTools(server, client);

  // B1: iiq_request_search
  // B2: iiq_request_get_details
  registerRequestTools(server, client);

  // C1: iiq_workflow_get_status
  // C2: iiq_workflow_list_launched
  registerWorkflowTools(server, client);

  // D1: iiq_provisioning_search_transactions
  // D2: iiq_provisioning_get_details
  registerProvisioningTools(server, client);

  // E1: iiq_entitlement_get_all
  // E2: iiq_entitlement_check_present
  registerEntitlementTools(server, client);

  // F1: iiq_task_get_results
  // F2: iiq_task_check_freshness
  registerTaskTools(server, client);

  console.error(
    '[MCP Server] Registered 12 tools: ' +
    'A1 (iiq_identity_get), ' +
    'A2 (iiq_identity_check_exists), ' +
    'B1 (iiq_request_search), ' +
    'B2 (iiq_request_get_details), ' +
    'C1 (iiq_workflow_get_status), ' +
    'C2 (iiq_workflow_list_launched), ' +
    'D1 (iiq_provisioning_search_transactions), ' +
    'D2 (iiq_provisioning_get_details), ' +
    'E1 (iiq_entitlement_get_all), ' +
    'E2 (iiq_entitlement_check_present), ' +
    'F1 (iiq_task_get_results), ' +
    'F2 (iiq_task_check_freshness)'
  );

  // ─── Periodic cache stats logging (stderr only) ───────────────────────────
  // Logs every 60 seconds. Does NOT write to stdout (reserved for MCP protocol).
  const statsInterval = setInterval(() => {
    console.error(`[cache] stats: ${JSON.stringify(cache.stats())}`);
  }, 60_000);

  // Allow Node.js to exit even if this interval is active
  statsInterval.unref();

  // ─── Periodic cache eviction ──────────────────────────────────────────────
  // Evict expired entries every 5 minutes to prevent unbounded memory growth.
  const evictInterval = setInterval(() => {
    const evicted = cache.evictExpired();
    if (evicted > 0) {
      console.error(`[cache] Evicted ${evicted} expired entries`);
    }
  }, 5 * 60_000);

  evictInterval.unref();

  // ─── Connect transport ────────────────────────────────────────────────────
  // StdioServerTransport uses stdin/stdout for MCP protocol messages.
  // All our logging uses stderr.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP Server] Connected and ready. Tools: A1, A2, B1, B2, C1, C2, D1, D2, E1, E2, F1, F2');
}

main().catch((err: unknown) => {
  console.error('[MCP Server] Fatal error:', err);
  process.exit(1);
});
