// ─── Entitlement Tools: Capability 9 and Capability 10 ───────────────────────
// Capability 9 (iiq_entitlement_get_all)
//   Get every entitlement assigned to an identity across all applications.
//
// Capability 10 (iiq_entitlement_check_present)
//   Check whether a specific named entitlement is present for an identity on a given application.
//
// Cache key strategy:
//   entitlements:   "entitlements:{identityId}"                     TTL 5 min
//   ent_check:      "ent_check:{identityId}:{application}:{name}"   TTL 5 min

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { IIQClient } from '../iiq-client/client.js';
import { cache, ENTITLEMENT_TTL_MS } from '../cache/cache.js';
import type { E1Output, IIQEntitlement } from '../types/iiq.js';

export function registerEntitlementTools(server: McpServer, client: IIQClient): void {
  // ─── Capability 9: iiq_entitlement_get_all ───────────────────────────────

  server.tool(
    'iiq_entitlement_get_all',
    'Get every entitlement currently assigned to an identity across all applications. Used to verify what access a user actually has vs. what they requested. Returns entitlements grouped by application.',
    {
      identity_id: z
        .string()
        .describe('Identity username or UUID to retrieve entitlements for'),
      application: z
        .string()
        .optional()
        .describe(
          'Optional: filter results to a single application name (e.g. "SAP ECC")'
        ),
    },
    async (input) => {
      // Cache key: "entitlements:{identityId}"   TTL 5 min
      const cacheKey = `entitlements:${input.identity_id}`;
      const cached = cache.get<E1Output>(cacheKey);

      if (cached) {
        console.error(`[cache] HIT ${cacheKey}`);
        // Apply application filter from cached data if requested
        if (input.application) {
          const filtered: E1Output = {
            ...cached,
            entitlements: cached.entitlements.filter(
              (e) => e.application.displayName === input.application
            ),
            by_application: {
              [input.application]: cached.by_application[input.application] ?? [],
            },
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(filtered) }],
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(cached) }],
        };
      }

      console.error(`[cache] MISS ${cacheKey}`);

      // Request identity with entitlements attribute from SCIM
      const filter = encodeURIComponent(`userName eq "${input.identity_id}"`);
      const attributeList = [
        'id',
        'userName',
        'urn:ietf:params:scim:schemas:sailpoint:1.0:User.entitlements',
      ].join(',');

      const userRaw = await client.get<{ Resources: unknown[] }>(
        `/scim/v2/Users?filter=${filter}&attributes=${encodeURIComponent(attributeList)}`
      );

      if (!userRaw.Resources || userRaw.Resources.length === 0) {
        const empty: E1Output = {
          identity: { id: '', userName: input.identity_id },
          entitlements: [],
          total: 0,
          by_application: {},
        };
        console.error(`[Cap9] Identity not found: ${input.identity_id}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(empty) }],
        };
      }

      const resource = userRaw.Resources[0] as Record<string, unknown>;
      const ext = (
        resource['urn:ietf:params:scim:schemas:sailpoint:1.0:User'] ?? {}
      ) as Record<string, unknown>;

      const entitlements = (ext['entitlements'] ?? []) as IIQEntitlement[];

      // Group entitlements by application displayName
      const byApp: Record<string, IIQEntitlement[]> = {};
      for (const ent of entitlements) {
        const appName = ent.application?.displayName ?? 'Unknown';
        if (!byApp[appName]) byApp[appName] = [];
        byApp[appName].push(ent);
      }

      const output: E1Output = {
        identity: {
          id: resource['id'] as string,
          userName: resource['userName'] as string,
        },
        entitlements,
        total: entitlements.length,
        by_application: byApp,
      };

      // Cache the full result (before application filter)
      cache.set(cacheKey, output, ENTITLEMENT_TTL_MS);

      console.error(
        `[Cap9] Found ${entitlements.length} entitlement(s) for ${input.identity_id} ` +
        `across ${Object.keys(byApp).length} application(s)`
      );

      // Apply application filter if requested
      if (input.application) {
        const filtered: E1Output = {
          ...output,
          entitlements: entitlements.filter(
            (e) => e.application.displayName === input.application
          ),
          by_application: {
            [input.application]: byApp[input.application] ?? [],
          },
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(filtered) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
      };
    }
  );

  // ─── Capability 10: iiq_entitlement_check_present ────────────────────────

  server.tool(
    'iiq_entitlement_check_present',
    'Check whether a specific named entitlement is currently assigned to an identity on a given application. Returns a boolean `present` flag plus the matching entitlement object if found. Uses the same SCIM endpoint as E1 but filters client-side. Use when you need a quick yes/no on whether access was successfully provisioned.',
    {
      identity_id: z
        .string()
        .describe('Identity username or UUID to check entitlements for'),
      entitlement_name: z
        .string()
        .describe(
          'The entitlement displayName or value to search for (e.g. "GitHub:repo-readers", "SAP_ROLE_FI_AP")'
        ),
      application: z
        .string()
        .describe(
          'The application displayName to scope the search to (e.g. "GitHub Enterprise", "SAP ECC")'
        ),
    },
    async (input) => {
      // Cache key: "ent_check:{identityId}:{application}:{entitlement_name}"   TTL 5 min
      const cacheKey = `ent_check:${input.identity_id}:${input.application}:${input.entitlement_name}`;
      const cached = cache.get<{
        present: boolean;
        entitlement?: IIQEntitlement;
        identity_active: boolean;
      }>(cacheKey);

      if (cached) {
        console.error(`[cache] HIT ${cacheKey}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(cached) }],
        };
      }

      console.error(`[cache] MISS ${cacheKey}`);
      console.error(
        `[Cap10] Checking entitlement "${input.entitlement_name}" on "${input.application}" ` +
        `for identity=${input.identity_id}`
      );

      // Fetch identity with entitlements + active status via SCIM
      const filter = encodeURIComponent(`userName eq "${input.identity_id}"`);
      const attributeList = [
        'id',
        'userName',
        'active',
        'urn:ietf:params:scim:schemas:sailpoint:1.0:User.entitlements',
      ].join(',');

      const userRaw = await client.get<{ Resources: unknown[] }>(
        `/scim/v2/Users?filter=${filter}&attributes=${encodeURIComponent(attributeList)}`
      );

      if (!userRaw.Resources || userRaw.Resources.length === 0) {
        const notFound = { present: false, identity_active: false };
        console.error(`[Cap10] Identity not found: ${input.identity_id}`);
        // Still cache briefly so repeated lookups for missing identities don't hammer the API
        cache.set(cacheKey, notFound, ENTITLEMENT_TTL_MS);
        return {
          content: [{ type: 'text', text: JSON.stringify(notFound) }],
        };
      }

      const resource = userRaw.Resources[0] as Record<string, unknown>;
      const identityActive = resource['active'] !== false;

      const ext = (
        resource['urn:ietf:params:scim:schemas:sailpoint:1.0:User'] ?? {}
      ) as Record<string, unknown>;

      const allEntitlements = (ext['entitlements'] ?? []) as IIQEntitlement[];

      // Filter by application displayName first, then match by entitlement displayName or value
      const appEntitlements = allEntitlements.filter(
        (e) => e.application?.displayName === input.application
      );

      const matchedEntitlement = appEntitlements.find(
        (e) =>
          e.displayName === input.entitlement_name ||
          e.value === input.entitlement_name
      );

      const output = {
        present: matchedEntitlement !== undefined,
        ...(matchedEntitlement ? { entitlement: matchedEntitlement } : {}),
        identity_active: identityActive,
      };

      cache.set(cacheKey, output, ENTITLEMENT_TTL_MS);

      console.error(
        `[Cap10] Entitlement "${input.entitlement_name}" on "${input.application}" ` +
        `present=${output.present} identity_active=${identityActive}`
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
      };
    }
  );
}
