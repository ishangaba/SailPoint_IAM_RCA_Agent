// ─── Identity Tools: A1 and A2 ────────────────────────────────────────────────
// Tool A1: iiq_identity_get       — Full identity profile lookup
// Tool A2: iiq_identity_check_exists — Lightweight existence check (~100ms)
//
// Cache key strategy:
//   identity profiles:  "identity:{userName}"   TTL 5 min
//   exists checks:      "exists:{userName}"     TTL 5 min

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { IIQClient } from '../iiq-client/client.js';
import { cache, IDENTITY_TTL_MS, EXISTS_TTL_MS } from '../cache/cache.js';
import type { IIQIdentityProfile } from '../types/iiq.js';

export function registerIdentityTools(server: McpServer, client: IIQClient): void {
  // ─── Tool A1: iiq_identity_get ─────────────────────────────────────────────

  server.tool(
    'iiq_identity_get',
    'Get full identity profile from IdentityIQ including status, roles, manager, lifecycle state, and optionally entitlements. Use as first check in all RCA flows.',
    {
      identity_id: z
        .string()
        .describe('Username, employee ID, or UUID of the identity'),
      include_roles: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include assigned roles in response'),
      include_entitlements: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include all entitlements in response (heavier payload)'),
    },
    async (input) => {
      // Cache key: "identity:{userName}"   TTL 5 min
      const cacheKey = `identity:${input.identity_id}`;
      const cached = cache.get<IIQIdentityProfile>(cacheKey);

      if (cached) {
        console.error(`[cache] HIT ${cacheKey}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(cached) }],
        };
      }
      console.error(`[cache] MISS ${cacheKey}`);

      const filter = encodeURIComponent(`userName eq "${input.identity_id}"`);
      const raw = await client.get<{ Resources: unknown[]; totalResults: number }>(
        `/scim/v2/Users?filter=${filter}`
      );

      if (!raw.Resources || raw.Resources.length === 0) {
        const notFound = { exists: false, identity_id: input.identity_id };
        return {
          content: [{ type: 'text', text: JSON.stringify(notFound) }],
        };
      }

      const resource = raw.Resources[0] as Record<string, unknown>;
      const ext = (
        resource['urn:ietf:params:scim:schemas:sailpoint:1.0:User'] ?? {}
      ) as Record<string, unknown>;

      const profile: IIQIdentityProfile = {
        id: resource['id'] as string,
        userName: resource['userName'] as string,
        displayName: resource['displayName'] as string,
        active: resource['active'] as boolean,
        emails: (resource['emails'] as IIQIdentityProfile['emails']) ?? [],
        employeeNumber: ext['employeeNumber'] as string | undefined,
        department: ext['department'] as string | undefined,
        title: ext['title'] as string | undefined,
        location: ext['location'] as string | undefined,
        manager: ext['manager'] as IIQIdentityProfile['manager'],
        lifecycleState: ext['lifecycleState'] as string | undefined,
        workerType: ext['workerType'] as string | undefined,
        riskScore: ext['riskScore'] as number | undefined,
        roles: input.include_roles
          ? (ext['roles'] as IIQIdentityProfile['roles'])
          : undefined,
        entitlements: input.include_entitlements
          ? (ext['entitlements'] as IIQIdentityProfile['entitlements'])
          : undefined,
        startDate: ext['startDate'] as string | undefined,
        terminationDate: ext['terminationDate'] as string | undefined,
        meta: resource['meta'] as IIQIdentityProfile['meta'],
      };

      cache.set(cacheKey, profile, IDENTITY_TTL_MS);
      return {
        content: [{ type: 'text', text: JSON.stringify(profile) }],
      };
    }
  );

  // ─── Tool A2: iiq_identity_check_exists ────────────────────────────────────

  server.tool(
    'iiq_identity_check_exists',
    'Lightweight existence check — returns boolean + active status only. ~100ms. Use before A1 when you only need to confirm a user exists in IdentityIQ.',
    {
      identity_id: z.string().describe('Username to check for existence'),
    },
    async (input) => {
      // Cache key: "exists:{userName}"   TTL 5 min
      const cacheKey = `exists:${input.identity_id}`;
      const cached = cache.get<{ exists: boolean; id?: string; active?: boolean }>(cacheKey);

      if (cached) {
        console.error(`[cache] HIT ${cacheKey}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(cached) }],
        };
      }
      console.error(`[cache] MISS ${cacheKey}`);

      const filter = encodeURIComponent(`userName eq "${input.identity_id}"`);
      const raw = await client.get<{ Resources: unknown[]; totalResults: number }>(
        `/scim/v2/Users?filter=${filter}&attributes=id,userName,active`
      );

      let result: { exists: boolean; id?: string; active?: boolean };

      if (!raw.Resources || raw.Resources.length === 0) {
        result = { exists: false };
      } else {
        const r = raw.Resources[0] as { id: string; active: boolean };
        result = { exists: true, id: r.id, active: r.active };
      }

      cache.set(cacheKey, result, EXISTS_TTL_MS);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );
}
