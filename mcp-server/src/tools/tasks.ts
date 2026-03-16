// ─── Task Tools: F1 + F2 ──────────────────────────────────────────────────────
// Tool F1: iiq_task_get_results
//   Get recent aggregation task results for an application.
//   Computes consecutive_failures and last success/error timestamps.
//
// Tool F2: iiq_task_check_freshness
//   Compute a freshness assessment for an application's aggregation data.
//   Uses the same task results endpoint as F1 but returns a staleness verdict.
//
// Cache key strategy:
//   task results:   "tasks:{application}"       TTL 10 min
//   freshness:      "freshness:{application}"   TTL 10 min

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { IIQClient } from '../iiq-client/client.js';
import { cache, TASK_TTL_MS, FRESHNESS_TTL_MS } from '../cache/cache.js';
import type { F1Output, F2Output, IIQTaskResult } from '../types/iiq.js';

export function registerTaskTools(server: McpServer, client: IIQClient): void {
  // ─── Tool F1: iiq_task_get_results ─────────────────────────────────────────

  server.tool(
    'iiq_task_get_results',
    'Get recent aggregation task results for an application. Used to determine if aggregation is running successfully and if data in IIQ is current. Returns consecutive_failures count and last success/error timestamps.',
    {
      application: z
        .string()
        .describe(
          'Application name to get task results for (e.g. "Active Directory", "SAP ECC", "GitHub Enterprise")'
        ),
      task_type: z
        .enum(['Aggregation', 'Refresh', 'Provisioning'])
        .optional()
        .default('Aggregation')
        .describe('Type of task to retrieve. Default: Aggregation'),
      limit: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe('Last N results to retrieve. Default: 5'),
      scenario: z
        .string()
        .optional()
        .describe('Optional: test scenario name for mock server routing. Ignored by production IIQ.'),
    },
    async (input) => {
      // Cache key: "tasks:{application}"   TTL 10 min
      // Include scenario in cache key so different scenario data is cached separately
      const cacheKey = input.scenario
        ? `tasks:${input.application}:${input.scenario}`
        : `tasks:${input.application}`;
      const cached = cache.get<F1Output>(cacheKey);

      if (cached) {
        console.error(`[cache] HIT ${cacheKey}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(cached) }],
        };
      }
      console.error(`[cache] MISS ${cacheKey}`);

      console.error(
        `[F1] Fetching task results for application="${input.application}" ` +
        `type=${input.task_type} limit=${input.limit}`
      );

      const params: Record<string, unknown> = {
        type: input.task_type,
        application: input.application,
        limit: input.limit,
      };
      if (input.scenario) {
        params['scenario'] = input.scenario;
      }

      const raw = await client.get<{
        count: number;
        taskResults: unknown[];
      }>('/rest/taskResults', params);

      const tasks = (raw.taskResults ?? []) as IIQTaskResult[];

      // Compute consecutive failures (counting from the most recent result backwards)
      // and identify last success / last error timestamps.
      let consecutiveFailures = 0;
      let lastSuccess: string | undefined;
      let lastError: string | undefined;

      for (const task of tasks) {
        if (task.status === 'Error' || task.status === 'Warning') {
          consecutiveFailures++;
          if (!lastError && task.completed) {
            lastError = task.completed;
          }
        } else if (task.status === 'Success') {
          if (!lastSuccess && task.completed) {
            lastSuccess = task.completed;
          }
          // Consecutive chain broken by a success
          break;
        }
        // 'Running' tasks are skipped (in-flight — not counted as failure yet)
      }

      const output: F1Output = {
        tasks,
        total: tasks.length,
        last_success: lastSuccess,
        last_error: lastError,
        consecutive_failures: consecutiveFailures,
      };

      cache.set(cacheKey, output, TASK_TTL_MS);

      console.error(
        `[F1] Found ${tasks.length} task(s). consecutive_failures=${consecutiveFailures} ` +
        `last_success=${lastSuccess ?? 'none'} last_error=${lastError ?? 'none'}`
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
      };
    }
  );

  // ─── Tool F2: iiq_task_check_freshness ─────────────────────────────────────

  server.tool(
    'iiq_task_check_freshness',
    'Compute a freshness assessment for an application\'s aggregation data. Fetches the last aggregation task result and determines whether the data in IIQ is current based on the expected frequency and a staleness threshold multiplier. Returns FRESH, STALE, NEVER_RUN, or RUNNING assessment. Use to determine if stale aggregation data explains why a user\'s access is not visible in IIQ.',
    {
      application: z
        .string()
        .describe(
          'Application name to check freshness for (e.g. "Active Directory", "SAP ECC", "GitHub Enterprise")'
        ),
      expected_frequency_hours: z
        .number()
        .min(1)
        .max(168)
        .optional()
        .default(24)
        .describe(
          'How often this application is expected to aggregate, in hours. Default: 24 (once daily)'
        ),
      staleness_threshold_multiplier: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .default(1.5)
        .describe(
          'Multiplier applied to expected_frequency_hours to determine the staleness threshold. ' +
          'E.g. 1.5 means data older than 1.5× the expected frequency is considered stale. Default: 1.5'
        ),
      scenario: z
        .string()
        .optional()
        .describe('Optional: test scenario name for mock server routing. Ignored by production IIQ.'),
    },
    async (input) => {
      // Cache key: "freshness:{application}"   TTL 10 min
      // Include scenario in cache key so different scenario data is cached separately
      const cacheKey = input.scenario
        ? `freshness:${input.application}:${input.scenario}`
        : `freshness:${input.application}`;
      const cached = cache.get<F2Output>(cacheKey);

      if (cached) {
        console.error(`[cache] HIT ${cacheKey}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(cached) }],
        };
      }

      console.error(`[cache] MISS ${cacheKey}`);
      console.error(
        `[F2] Checking freshness for application="${input.application}" ` +
        `expected_frequency=${input.expected_frequency_hours}h ` +
        `threshold_multiplier=${input.staleness_threshold_multiplier}`
      );

      // Reuse the same task results endpoint as F1, fetching a small window
      const f2Params: Record<string, unknown> = {
        type: 'Aggregation',
        application: input.application,
        limit: 10,
      };
      if (input.scenario) {
        f2Params['scenario'] = input.scenario;
      }

      const raw = await client.get<{
        count: number;
        taskResults: unknown[];
      }>('/rest/taskResults', f2Params);

      const tasks = (raw.taskResults ?? []) as IIQTaskResult[];

      const expectedFrequencyHours = input.expected_frequency_hours;
      const stalenessThresholdHours =
        expectedFrequencyHours * input.staleness_threshold_multiplier;

      // Handle NEVER_RUN
      if (tasks.length === 0) {
        const output: F2Output = {
          application: input.application,
          is_fresh: false,
          expected_frequency_hours: expectedFrequencyHours,
          staleness_threshold_hours: stalenessThresholdHours,
          assessment: 'NEVER_RUN',
          consecutive_failures: 0,
        };
        cache.set(cacheKey, output, FRESHNESS_TTL_MS);
        console.error(`[F2] Assessment=NEVER_RUN for application="${input.application}"`);
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
        };
      }

      // Check if any task is currently running
      const isRunning = tasks.some((t) => t.status === 'Running');

      // Compute consecutive failures and find the last successful aggregation timestamp
      let consecutiveFailures = 0;
      let lastSuccessTimestamp: string | undefined;

      for (const task of tasks) {
        if (task.status === 'Running') {
          // Running tasks are in-progress — skip but don't break the chain
          continue;
        }
        if (task.status === 'Error' || task.status === 'Warning') {
          consecutiveFailures++;
        } else if (task.status === 'Success') {
          if (!lastSuccessTimestamp && task.completed) {
            lastSuccessTimestamp = task.completed;
          }
          // Break the consecutive failure chain at first success
          break;
        }
      }

      // If currently running with no prior success, report RUNNING
      if (isRunning && !lastSuccessTimestamp) {
        const output: F2Output = {
          application: input.application,
          is_fresh: false,
          expected_frequency_hours: expectedFrequencyHours,
          staleness_threshold_hours: stalenessThresholdHours,
          assessment: 'RUNNING',
          consecutive_failures: consecutiveFailures,
        };
        cache.set(cacheKey, output, FRESHNESS_TTL_MS);
        console.error(`[F2] Assessment=RUNNING for application="${input.application}"`);
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
        };
      }

      // Compute age of last successful aggregation
      let ageHours: number | undefined;
      let assessment: F2Output['assessment'];
      let isFresh: boolean;

      if (!lastSuccessTimestamp) {
        // Tasks exist but none succeeded — STALE (or NEVER_RUN if all running)
        assessment = 'STALE';
        isFresh = false;
      } else {
        const lastSuccessMs = new Date(lastSuccessTimestamp).getTime();
        ageHours = (Date.now() - lastSuccessMs) / (1000 * 3600);

        if (ageHours > stalenessThresholdHours) {
          assessment = 'STALE';
          isFresh = false;
        } else if (isRunning) {
          // Running but we have a recent prior success — still fresh
          assessment = 'RUNNING';
          isFresh = true;
        } else {
          assessment = 'FRESH';
          isFresh = true;
        }
      }

      const output: F2Output = {
        application: input.application,
        is_fresh: isFresh,
        ...(lastSuccessTimestamp ? { last_aggregation: lastSuccessTimestamp } : {}),
        ...(ageHours !== undefined ? { age_hours: Math.round(ageHours * 10) / 10 } : {}),
        expected_frequency_hours: expectedFrequencyHours,
        staleness_threshold_hours: stalenessThresholdHours,
        assessment,
        consecutive_failures: consecutiveFailures,
      };

      cache.set(cacheKey, output, FRESHNESS_TTL_MS);

      console.error(
        `[F2] Assessment=${assessment} for application="${input.application}" ` +
        `age_hours=${ageHours !== undefined ? ageHours.toFixed(1) : 'N/A'} ` +
        `threshold=${stalenessThresholdHours}h consecutive_failures=${consecutiveFailures}`
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
      };
    }
  );
}
