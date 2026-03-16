// ─── Workflow Tools: C1 + C2 ──────────────────────────────────────────────────
// Tool C1: iiq_workflow_get_status
//   Get the current status and step details of a workflow instance by ID.
//   Computes ageHours from the launched timestamp.
//   Cache TTL 60 seconds, key: workflow:{workflow_id}
//
// Tool C2: iiq_workflow_list_launched
//   List launched workflow instances for an identity, with optional filters.
//   Cache TTL 2 min, key: workflows:{identity_id}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { IIQClient } from '../iiq-client/client.js';
import { cache, WORKFLOW_TTL_MS } from '../cache/cache.js';
import type { IIQWorkflowInstance } from '../types/iiq.js';

/** 2-minute TTL for workflow list queries */
const WORKFLOW_LIST_TTL_MS = 2 * 60 * 1000;

export function registerWorkflowTools(server: McpServer, client: IIQClient): void {
  // ─── Tool C1: iiq_workflow_get_status ────────────────────────────────────

  server.tool(
    'iiq_workflow_get_status',
    'Get the current status and step details of a workflow instance. Returns the full workflow object including all steps, their completion states, any approval wait states, and the computed ageHours since launch. Use to determine why an approved access request has not completed provisioning — e.g. stuck in approval, failed step, or timed out.',
    {
      workflow_id: z
        .string()
        .describe(
          'The workflow instance ID (workflowCaseId) to retrieve. ' +
          'Obtained from the workflowCaseId field of an access request (B1/B2).'
        ),
    },
    async (input) => {
      // Cache key: "workflow:{workflow_id}"   TTL 60 seconds
      const cacheKey = `workflow:${input.workflow_id}`;
      const cached = cache.get<IIQWorkflowInstance>(cacheKey);

      if (cached) {
        console.error(`[cache] HIT ${cacheKey}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(cached) }],
        };
      }

      console.error(`[cache] MISS ${cacheKey}`);
      console.error(`[C1] Fetching workflow instance id=${input.workflow_id}`);

      const raw = await client.get<IIQWorkflowInstance>(
        `/rest/workflowInstances/${input.workflow_id}`
      );

      // Compute ageHours from the launched timestamp
      const launchedMs = raw.launched ? new Date(raw.launched).getTime() : Date.now();
      const ageHours = Math.round(((Date.now() - launchedMs) / (1000 * 3600)) * 10) / 10;

      const workflow: IIQWorkflowInstance = {
        ...raw,
        ageHours,
      };

      cache.set(cacheKey, workflow, WORKFLOW_TTL_MS);

      console.error(
        `[C1] Workflow ${input.workflow_id}: status=${workflow.status} ` +
        `currentStep="${workflow.currentStep}" ageHours=${ageHours}`
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(workflow) }],
      };
    }
  );

  // ─── Tool C2: iiq_workflow_list_launched ─────────────────────────────────

  server.tool(
    'iiq_workflow_list_launched',
    'List launched workflow instances targeting an identity, with optional filters by workflow name, status, and lookback window. Uses the SCIM LaunchedWorkflows endpoint. Useful for finding all provisioning or approval workflows associated with a user when the specific workflowCaseId is not known.',
    {
      identity_id: z
        .string()
        .describe(
          'The identity username whose launched workflows to list (e.g. "john.doe")'
        ),
      workflow_name: z
        .string()
        .optional()
        .describe(
          'Optional: filter by workflow name (e.g. "Joiner Workflow", "Access Request Approval")'
        ),
      status: z
        .enum(['Running', 'Failed', 'Complete', 'All'])
        .optional()
        .default('All')
        .describe('Filter by workflow completion status. Default: All'),
      days_back: z
        .number()
        .min(1)
        .max(180)
        .optional()
        .default(30)
        .describe('Return workflows launched within the last N days. Default: 30'),
    },
    async (input) => {
      // Cache key: "workflows:{identity_id}"   TTL 2 min
      const cacheKey = `workflows:${input.identity_id}`;
      const cached = cache.get<{
        workflows: Array<{
          id: string;
          name: string;
          status: string;
          launched: string;
          completed?: string;
          completionStatus?: string;
          currentStep: string;
        }>;
        total: number;
      }>(cacheKey);

      if (cached) {
        console.error(`[cache] HIT ${cacheKey}`);
        // Apply in-memory filters to cached data
        let filtered = cached.workflows;
        if (input.workflow_name) {
          filtered = filtered.filter((w) =>
            w.name.toLowerCase().includes(input.workflow_name!.toLowerCase())
          );
        }
        if (input.status && input.status !== 'All') {
          filtered = filtered.filter((w) => w.status === input.status);
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ workflows: filtered, total: filtered.length }),
            },
          ],
        };
      }

      console.error(`[cache] MISS ${cacheKey}`);

      // Build SCIM filter: target.userName eq "identity_id" and launched gt "n_days_ago"
      const nDaysAgo = new Date(
        Date.now() - input.days_back * 24 * 60 * 60 * 1000
      ).toISOString();

      const scimFilter = `target.userName eq "${input.identity_id}" and launched gt "${nDaysAgo}"`;

      console.error(
        `[C2] Listing launched workflows for identity=${input.identity_id} ` +
        `status=${input.status} days_back=${input.days_back} ` +
        `workflow_name=${input.workflow_name ?? 'any'}`
      );

      const raw = await client.get<{
        totalResults: number;
        Resources: unknown[];
      }>(
        `/scim/v2/LaunchedWorkflows?filter=${encodeURIComponent(scimFilter)}`
      );

      const resources = (raw.Resources ?? []) as Array<Record<string, unknown>>;

      // Map SCIM resources to our simplified shape
      const allWorkflows = resources.map((r) => ({
        id: r['id'] as string,
        name: r['name'] as string ?? r['workflowName'] as string ?? 'Unknown',
        status: r['status'] as string ?? 'Unknown',
        launched: r['launched'] as string ?? r['startDate'] as string ?? '',
        ...(r['completed'] ? { completed: r['completed'] as string } : {}),
        ...(r['completionStatus']
          ? { completionStatus: r['completionStatus'] as string }
          : {}),
        currentStep: r['currentStep'] as string ?? r['step'] as string ?? '',
      }));

      // Cache the full unfiltered list
      const fullResult = { workflows: allWorkflows, total: allWorkflows.length };
      cache.set(cacheKey, fullResult, WORKFLOW_LIST_TTL_MS);

      // Apply filters to the response
      let filteredWorkflows = allWorkflows;
      if (input.workflow_name) {
        filteredWorkflows = filteredWorkflows.filter((w) =>
          w.name.toLowerCase().includes(input.workflow_name!.toLowerCase())
        );
      }
      if (input.status && input.status !== 'All') {
        filteredWorkflows = filteredWorkflows.filter((w) => w.status === input.status);
      }

      console.error(
        `[C2] Found ${allWorkflows.length} total workflow(s), ` +
        `${filteredWorkflows.length} after filtering for identity=${input.identity_id}`
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              workflows: filteredWorkflows,
              total: filteredWorkflows.length,
            }),
          },
        ],
      };
    }
  );
}
