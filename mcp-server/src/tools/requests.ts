// ─── Access Request Tools: Capability 3 and Capability 4 ─────────────────────
// Capability 3 (iiq_request_search)
//   Search access requests for an identity, filtered by status and timeframe.
//   NO CACHE — requests change state frequently (pending → approved → complete).
//
// Capability 4 (iiq_request_get_details)
//   Get the full details of a single access request by ID.
//   Cache TTL 2 min, key: request:{request_id}
//
// Downstream logic notes (for agent):
//   total == 0                       → NO_ACCESS_REQUEST_FOUND
//   requests[0].status == Pending    → continue to workflow check (Cap5)
//   requests[0].status == Rejected   → REQUEST_REJECTED (stop)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { IIQClient } from '../iiq-client/client.js';
import { cache } from '../cache/cache.js';
import type { IIQAccessRequest } from '../types/iiq.js';

/** 2-minute TTL for individual request lookups (status can change) */
const REQUEST_TTL_MS = 2 * 60 * 1000;

export function registerRequestTools(server: McpServer, client: IIQClient): void {
  // ─── Capability 3: iiq_request_search ────────────────────────────────────

  server.tool(
    'iiq_request_search',
    'Search access requests submitted for or by an identity. Returns matching requests ordered most-recent first. Used to determine whether the user has an active or recent access request and to retrieve the workflowCaseId needed for workflow status checks. No caching — request states change frequently.',
    {
      identity_id: z
        .string()
        .describe(
          'Identity username to search requests for (e.g. "john.doe"). ' +
          'Searches both requester and target identity.'
        ),
      status: z
        .enum(['Pending', 'Approved', 'Rejected', 'Completed', 'Failed', 'All'])
        .optional()
        .default('All')
        .describe(
          'Filter by request status. Use "All" to return requests regardless of status. Default: All'
        ),
      days_back: z
        .number()
        .min(1)
        .max(180)
        .optional()
        .default(30)
        .describe('Return requests created within the last N days. Default: 30'),
      application: z
        .string()
        .optional()
        .describe(
          'Optional: filter to requests that target a specific application ' +
          '(e.g. "GitHub Enterprise", "SAP ECC")'
        ),
      scenario: z
        .string()
        .optional()
        .describe(
          'Optional: test scenario name for mock server routing (e.g. "provisioning_connector_error"). ' +
          'Ignored by production IIQ.'
        ),
    },
    async (input) => {
      // NO CACHE for list queries — request states change frequently

      // Build createdAfter date string (ISO 8601, N days ago)
      const createdAfter = new Date(
        Date.now() - input.days_back * 24 * 60 * 60 * 1000
      ).toISOString();

      const params: Record<string, string> = {
        identity: input.identity_id,
        createdAfter,
      };

      if (input.status && input.status !== 'All') {
        params['status'] = input.status;
      }
      if (input.application) {
        params['application'] = input.application;
      }
      if (input.scenario) {
        params['scenario'] = input.scenario;
      }

      console.error(
        `[Cap3] Searching access requests for identity=${input.identity_id} ` +
        `status=${input.status} days_back=${input.days_back} ` +
        `application=${input.application ?? 'any'}`
      );

      const raw = await client.get<{
        count: number;
        accessRequests: unknown[];
      }>('/rest/accessRequests', params);

      const requests: IIQAccessRequest[] =
        (raw.accessRequests ?? []) as IIQAccessRequest[];

      const result = {
        requests,
        total: requests.length,
      };

      console.error(
        `[Cap3] Found ${requests.length} request(s) for identity=${input.identity_id}`
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );

  // ─── Capability 4: iiq_request_get_details ───────────────────────────────

  server.tool(
    'iiq_request_get_details',
    'Get the full details of a single access request by its ID. Returns the complete request object including approval history, all requested items with their current approval states, and the linked workflowCaseId. Use after B1 to drill into the specifics of a particular request.',
    {
      request_id: z
        .string()
        .describe('The access request ID to retrieve (e.g. "REQ-2024-001234")'),
    },
    async (input) => {
      // Cache key: "request:{request_id}"   TTL 2 min
      const cacheKey = `request:${input.request_id}`;
      const cached = cache.get<IIQAccessRequest>(cacheKey);

      if (cached) {
        console.error(`[cache] HIT ${cacheKey}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(cached) }],
        };
      }

      console.error(`[cache] MISS ${cacheKey}`);
      console.error(`[Cap4] Fetching access request id=${input.request_id}`);

      const request = await client.get<IIQAccessRequest>(
        `/rest/accessRequests/${input.request_id}`
      );

      cache.set(cacheKey, request, REQUEST_TTL_MS);

      console.error(
        `[Cap4] Request ${input.request_id}: status=${request.status} ` +
        `items=${request.items?.length ?? 0} workflowCaseId=${request.workflowCaseId ?? 'none'}`
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(request) }],
      };
    }
  );
}
