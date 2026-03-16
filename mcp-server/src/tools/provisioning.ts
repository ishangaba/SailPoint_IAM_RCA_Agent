// ─── Provisioning Tools: Capability 7 and Capability 8 ───────────────────────
// Capability 7 (iiq_provisioning_search_transactions)
//   Search provisioning transactions by identity, status, application, or timeframe.
//
// Capability 8 (iiq_provisioning_get_details)
//   Get full details of a single provisioning transaction by ID.
//
// Cache key strategy:
//   access requests:     NO CACHE (state changes frequently)
//   prov transactions:   "prov_tx:{transactionId}"   TTL 5 min (individual lookup only)
//   Cap7 list queries:   NO CACHE (results are time-windowed and change)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { IIQClient } from '../iiq-client/client.js';
import { cache, PROV_TX_TTL_MS } from '../cache/cache.js';
import type { IIQProvisioningTransaction } from '../types/iiq.js';

export function registerProvisioningTools(server: McpServer, client: IIQClient): void {
  // ─── Capability 7: iiq_provisioning_search_transactions ──────────────────

  server.tool(
    'iiq_provisioning_search_transactions',
    'Search provisioning transactions by identity, status, application, or timeframe. Primarily used to find provisioning failures that explain why approved requests did not result in access being granted.',
    {
      identity_id: z
        .string()
        .describe('Filter by identity username (e.g. "john.doe")'),
      status: z
        .enum(['Success', 'Failed', 'Pending', 'All'])
        .optional()
        .default('Failed')
        .describe('Filter by transaction status. Default: Failed'),
      application: z
        .string()
        .optional()
        .describe('Filter by target application name (e.g. "Active Directory", "SAP ECC")'),
      days_back: z
        .number()
        .min(1)
        .max(90)
        .optional()
        .default(7)
        .describe('Search transactions from last N days. Default: 7'),
      operation_type: z
        .enum(['Create', 'Modify', 'Delete', 'Enable', 'Disable'])
        .optional()
        .describe('Filter by provisioning operation type'),
      scenario: z
        .string()
        .optional()
        .describe(
          'Optional: test scenario name for mock server routing (e.g. "provisioning_connector_error"). ' +
          'Ignored by production IIQ.'
        ),
    },
    async (input) => {
      // Access requests and provisioning transaction lists are NOT cached —
      // provisioning states change frequently during active RCA investigations.

      const params: Record<string, string> = {
        identity: input.identity_id,
        days: String(input.days_back),
      };

      if (input.status && input.status !== 'All') {
        params['status'] = input.status;
      }
      if (input.application) {
        params['application'] = input.application;
      }
      if (input.operation_type) {
        params['operation'] = input.operation_type;
      }
      if (input.scenario) {
        params['scenario'] = input.scenario;
      }

      console.error(
        `[Cap7] Searching provisioning transactions for identity=${input.identity_id} ` +
        `status=${input.status} application=${input.application ?? 'any'} ` +
        `days=${input.days_back}`
      );

      const raw = await client.get<{
        count: number;
        provisioningTransactions: unknown[];
      }>('/rest/provisioningTransactions', params);

      const transactions: IIQProvisioningTransaction[] =
        (raw.provisioningTransactions ?? []) as IIQProvisioningTransaction[];

      const result = {
        transactions,
        total: transactions.length,
      };

      console.error(`[Cap7] Found ${transactions.length} transaction(s)`);

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );

  // ─── Capability 8: iiq_provisioning_get_details ──────────────────────────

  server.tool(
    'iiq_provisioning_get_details',
    'Get full details of a single provisioning transaction by its ID. Returns the complete transaction object including the full accountRequest with all attribute changes, error messages, and retry count. Use after D1 identifies a failed transaction to drill into the exact failure reason.',
    {
      transaction_id: z
        .string()
        .describe('The provisioning transaction ID to retrieve (e.g. "abc123def456")'),
    },
    async (input) => {
      // Cache key: "prov_tx:{transactionId}"   TTL 5 min
      const cacheKey = `prov_tx:${input.transaction_id}`;
      const cached = cache.get<IIQProvisioningTransaction>(cacheKey);

      if (cached) {
        console.error(`[cache] HIT ${cacheKey}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(cached) }],
        };
      }

      console.error(`[cache] MISS ${cacheKey}`);
      console.error(`[Cap8] Fetching provisioning transaction id=${input.transaction_id}`);

      const transaction = await client.get<IIQProvisioningTransaction>(
        `/rest/provisioningTransactions/${input.transaction_id}`
      );

      cache.set(cacheKey, transaction, PROV_TX_TTL_MS);

      console.error(
        `[Cap8] Transaction ${input.transaction_id}: status=${transaction.status} ` +
        `application=${transaction.applicationName} errors=${transaction.errorMessages?.length ?? 0}`
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(transaction) }],
      };
    }
  );
}
