import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import type * as t from '@/types';
import { resolveConfigContract } from '@/utils';
import { apiFetch } from '../utils/api';

/** A part of the reply that is missing or malformed reads as not reported (the bundled value applies). */
function lenient<T extends z.ZodType>(schema: T): z.ZodCatch<z.ZodOptional<T>> {
  return schema.optional().catch(undefined);
}

const text = z.string();
const names = z.array(z.string());
const count = z.number().int().nonnegative();
const nameMap = z.record(z.string(), z.string());
/** A reason a newer server adds reads as an operator boundary: only librechat.yaml sets the path. */
const deploymentReason = z.enum(['startup', 'operator', 'unused']).catch('operator');

const rulesSchema = z.object({
  acceptedSections: lenient(names),
  baseOnlySections: lenient(names),
  basePrincipalSections: lenient(names),
  baseOnlyPaths: lenient(names),
  deploymentOnlyPaths: lenient(z.record(z.string(), deploymentReason)),
  arrayMergeKeys: lenient(nameMap),
  atomicMergePaths: lenient(names),
  overrideKeyMap: lenient(nameMap),
  derivedPaths: lenient(names),
  secretFields: lenient(
    z.array(z.object({ path: text, previewPath: text, allowEnvPlaceholder: z.boolean() })),
  ),
  arraySecretFields: lenient(
    z.array(z.object({ arrayPath: text, secretKey: text, previewKey: text, identityKey: text })),
  ),
  recordSecretFields: lenient(
    z.array(z.object({ recordPath: text, secretPath: text, previewPath: text })),
  ),
  refusedMaps: lenient(names),
  processMcpFields: lenient(names),
  interface: lenient(
    z.object({ permissionFields: names, runtimeFields: names, permissionSubKeys: names }),
  ),
  titleResolution: lenient(z.enum(['block', 'field'])),
});

/** `GET /api/admin/config/meta`, read leniently: forks and newer servers may add, drop or reshape parts. */
const metaSchema = z.object({
  versions: lenient(
    z.object({ librechat: text, dataProvider: text, configSchema: text }).partial(),
  ),
  features: lenient(z.record(z.string(), z.boolean().catch(false))),
  limits: lenient(
    z.object({
      maxPatchEntries: lenient(z.number().int().positive()),
      maxChangeOps: lenient(count),
      overrideCacheTtlMs: lenient(count),
      catalogModelsTtlMs: lenient(count),
      maxEntryKeyLength: lenient(z.number().int().positive()),
    }),
  ),
  rules: lenient(rulesSchema),
});

/** Statuses of a server without the meta route (404) or a caller who may not read it (401, 403). */
const NO_CONTRACT_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/**
 * The connected LibreChat server's admin config contract. A server without
 * `GET /api/admin/config/meta` (an older LibreChat), a caller who may not
 * read it, and a reply that can't be read all get the bundled contract, so
 * every behaviour stays as it was before the server reported one.
 */
export async function readConfigContract(): Promise<t.ConfigContract> {
  try {
    const response = await apiFetch('/api/admin/config/meta');
    if (!response.ok) {
      if (!NO_CONTRACT_STATUSES.has(response.status)) {
        console.warn(`[readConfigContract] meta request failed: ${response.status}`);
      }
      return resolveConfigContract(null);
    }
    const parsed = metaSchema.safeParse(await response.json());
    return resolveConfigContract(parsed.success ? parsed.data : null);
  } catch (error) {
    console.warn('[readConfigContract] meta request failed:', error);
    return resolveConfigContract(null);
  }
}

/** The admin config contract of the connected LibreChat server (see `readConfigContract`). */
export const getAdminConfigMetaFn = createServerFn({ method: 'GET' }).handler(
  (): Promise<t.ConfigContract> => readConfigContract(),
);

/** Shared query: every page reads the same contract, refreshed every few minutes. */
export const configContractOptions = queryOptions({
  queryKey: ['configContract'],
  queryFn: () => getAdminConfigMetaFn(),
  staleTime: 5 * 60_000,
  retry: false,
});
