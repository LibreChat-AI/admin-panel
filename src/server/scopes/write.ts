import { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { PrincipalType } from 'librechat-data-provider';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import type { AdminConfigResponse } from '@librechat/data-schemas';
import type * as t from '@/types';
import {
  prepareConfigWrite,
  patchConfigFields,
  parseIndexedArrayPath,
  mergeConfigArraySources,
} from '../config/save';
import { isInterfacePermissionPath, stripSecretPreviewValues } from '@/utils';
import { normalizeAppServiceKeys } from '../config/normalize';
import { requireAnyCapability } from '../capabilities';
import { safeFieldPath } from '../utils/validation';
import { getSchemaPathSet } from '../config/schema';
import { apiFetch } from '../utils/api';
import { deepGet } from './paths';

async function getScopeOverrides(
  apiType: PrincipalType,
  principalId: string,
): Promise<Record<string, unknown>> {
  const response = await apiFetch(
    `/api/admin/config/${apiType}/${encodeURIComponent(principalId)}`,
  );
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`Failed to fetch config: ${response.status}`);
  const { config } = (await response.json()) as AdminConfigResponse;
  return normalizeAppServiceKeys((config.overrides ?? {}) as Record<string, t.ConfigValue>);
}

async function getBaseConfig(): Promise<Record<string, unknown>> {
  const response = await apiFetch('/api/admin/config/base');
  if (!response.ok) throw new Error(`Failed to fetch base config: ${response.status}`);
  const { config } = (await response.json()) as { config: Record<string, t.ConfigValue> };
  return normalizeAppServiceKeys(config);
}

export async function mergeIndexedArrayEntriesForScope(
  apiType: PrincipalType,
  principalId: string,
  entries: t.SaveEntry[],
): Promise<t.SaveEntry[]> {
  const indexed = new Map<string, Map<number, t.ConfigValue>>();
  const rest: t.SaveEntry[] = [];
  const restByPath = new Map<string, number>();

  for (const entry of entries) {
    const parsed = parseIndexedArrayPath(entry.fieldPath);
    if (!parsed) {
      restByPath.set(entry.fieldPath, rest.length);
      rest.push(entry);
      continue;
    }
    const { arrayPath, index } = parsed;
    if (!indexed.has(arrayPath)) indexed.set(arrayPath, new Map());
    indexed.get(arrayPath)!.set(index, entry.value);
  }

  if (indexed.size === 0) return entries;

  const [scopeOverrides, baseConfig] = await Promise.all([
    getScopeOverrides(apiType, principalId),
    getBaseConfig(),
  ]);

  for (const [arrayPath, updates] of indexed) {
    const restIndex = restByPath.get(arrayPath);
    const pending = restIndex === undefined ? undefined : rest[restIndex]?.value;
    const scopeValue = deepGet(scopeOverrides, arrayPath);
    const baseValue = deepGet(baseConfig, arrayPath);
    const arr = mergeConfigArraySources(baseValue, scopeValue, pending);
    for (const [idx, value] of updates) {
      arr[idx] = value;
    }
    const strippedArr = stripSecretPreviewValues(
      arr as t.ConfigValue[],
      arrayPath,
      getSchemaPathSet(),
    );
    const merged = { fieldPath: arrayPath, value: strippedArr };
    if (restIndex === undefined) {
      restByPath.set(arrayPath, rest.length);
      rest.push(merged);
    } else {
      rest[restIndex] = merged;
    }
  }

  return rest;
}

/**
 * Save a field profile value for a specific scope.
 */
export const saveFieldProfileValueFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      fieldPath: safeFieldPath,
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      value: z.unknown().refine((v) => v != null, 'Profile value must not be null or undefined'),
    }),
  )
  .handler(async ({ data }) => {
    await requireAnyCapability([
      SystemCapabilities.ASSIGN_CONFIGS,
      SystemCapabilities.MANAGE_CONFIGS,
    ]);
    if (isInterfacePermissionPath(data.fieldPath)) return { success: true };
    const { writable } = prepareConfigWrite([
      { fieldPath: data.fieldPath, value: data.value as t.ConfigValue },
    ]);
    if (writable.length === 0) {
      throw new Error(`${data.fieldPath} can't be set per profile; it is read from librechat.yaml`);
    }
    const apiType = data.principalType;
    const entries = await mergeIndexedArrayEntriesForScope(apiType, data.principalId, writable);
    const { skipped } = await patchConfigFields(
      `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}/fields`,
      entries,
    );
    if (skipped.length > 0) {
      throw new Error(`LibreChat did not store ${skipped.map((s) => s.fieldPath).join(', ')}`);
    }
    return { success: true };
  });

/**
 * Save many field profile values for one scope in a single call.
 */
export const bulkSaveProfileValuesFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      entries: z.array(
        z.object({
          fieldPath: safeFieldPath,
          value: z
            .unknown()
            .refine((v) => v != null, 'Profile value must not be null or undefined'),
        }),
      ),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        principalType: PrincipalType;
        principalId: string;
        entries: Array<{ fieldPath: string; value: unknown }>;
      };
    }): Promise<t.ConfigWriteResult> => {
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const { writable, skipped } = prepareConfigWrite(data.entries as t.SaveEntry[]);
      if (writable.length === 0) return { success: true, applied: 0, skipped };
      const apiType = data.principalType;
      const entries = await mergeIndexedArrayEntriesForScope(apiType, data.principalId, writable);
      const result = await patchConfigFields(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}/fields`,
        entries,
      );
      return { success: true, applied: result.applied, skipped: [...skipped, ...result.skipped] };
    },
  );

/**
 * Remove a field profile value for a specific scope.
 */
export const removeFieldProfileValueFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      fieldPath: safeFieldPath,
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        fieldPath: string;
        principalType: PrincipalType;
        principalId: string;
      };
    }) => {
      if (isInterfacePermissionPath(data.fieldPath)) return { success: true };
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}/fields?fieldPath=${encodeURIComponent(data.fieldPath)}`,
        { method: 'DELETE' },
      );

      if (!response.ok && response.status !== 404) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to remove field: ${response.status}`,
        );
      }
      return { success: true };
    },
  );

/**
 * Suppress an inherited field value for a specific scope.
 */
export const tombstoneFieldProfileValueFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      fieldPath: safeFieldPath,
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        fieldPath: string;
        principalType: PrincipalType;
        principalId: string;
      };
    }) => {
      if (isInterfacePermissionPath(data.fieldPath)) return { success: true };
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}/fields/tombstone`,
        {
          method: 'POST',
          body: JSON.stringify({ fieldPath: data.fieldPath }),
        },
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to tombstone field: ${response.status}`,
        );
      }
      return { success: true };
    },
  );
