import { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import {
  configSchema,
  isProcessMCPServerField,
  isProcessMCPServerConfig,
} from 'librechat-data-provider';
import type * as t from '@/types';
import {
  unwrapSchema,
  findUnsafeKeys,
  isConfigRecord,
  resolveSubSchema,
  getWriteSkipReason,
  validateFieldValue,
  findYamlManagedValues,
  stripSecretPreviewValues,
  isInterfacePermissionPath,
} from '@/utils';
import {
  requireCapability,
  requireAnyCapability,
  requireAllSectionCapabilities,
} from '../capabilities';
import { getConfigSection, BLOCK_UNSAFE_CONFIG_KEYS, UNSAFE_CONFIG_KEY_MESSAGE } from '@/constants';
import { BASE_CONFIG_PRINCIPAL_ID } from '../constants';
import { normalizeAppServiceKeys } from './normalize';
import { safeFieldPath } from '../utils/validation';
import { getSchemaPathSet } from './schema';
import { apiFetch } from '../utils/api';

const INDEXED_ARRAY_RE = /^(.+)\.(\d+)$/;
const ARRAY_INDEX_KEY_RE = /^(0|[1-9]\d*)$/;

export function parseIndexedArrayPath(
  fieldPath: string,
): { arrayPath: string; index: number } | null {
  const match = INDEXED_ARRAY_RE.exec(fieldPath);
  if (!match) return null;
  const [, arrayPath, indexStr] = match;
  const schema = resolveSubSchema(configSchema as t.ZodSchemaLike, arrayPath.split('.'));
  if (!schema) return null;
  const unwrapped = unwrapSchema(schema);
  if (unwrapped?._def?.typeName !== 'ZodArray') return null;
  return { arrayPath, index: Number(indexStr) };
}

export function toConfigArraySource(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return [...value];
  return toIndexedArrayObjectSource(value);
}

export function toIndexedArrayObjectSource(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return undefined;
  const arrayValue: unknown[] = [];
  for (const [key, entryValue] of Object.entries(value as Record<string, t.ConfigValue>)) {
    if (!ARRAY_INDEX_KEY_RE.test(key)) return undefined;
    const index = Number(key);
    if (!Number.isSafeInteger(index)) return undefined;
    arrayValue[index] = entryValue;
  }
  return arrayValue;
}

function overlayArraySource(source: unknown[], overlay: unknown[]): unknown[] {
  const result = [...source];
  for (const key of Object.keys(overlay)) {
    const index = Number(key);
    result[index] = overlay[index];
  }
  return result;
}

function mergeConfigArraySource(source: unknown[], value: unknown): unknown[] {
  if (Array.isArray(value)) return [...value];
  const overlay = toIndexedArrayObjectSource(value);
  return overlay ? overlayArraySource(source, overlay) : source;
}

export function mergeConfigArraySources(
  baseValue: unknown,
  overrideValue: unknown,
  pendingValue: unknown,
): unknown[] {
  const baseSource = toConfigArraySource(baseValue) ?? [];
  const overrideSource = mergeConfigArraySource(baseSource, overrideValue);
  return mergeConfigArraySource(overrideSource, pendingValue);
}

export function mergeIndexedArrayEntriesIntoBase(
  entries: t.SaveEntry[],
  baseConfig: t.ConfigRecord,
  mergedPaths?: Set<string>,
): t.SaveEntry[] {
  const indexed = new Map<string, Map<number, t.ConfigValue>>();
  const rest: t.SaveEntry[] = [];

  for (const entry of entries) {
    const parsed = parseIndexedArrayPath(entry.fieldPath);
    if (parsed) {
      const { arrayPath, index } = parsed;
      if (!indexed.has(arrayPath)) indexed.set(arrayPath, new Map());
      indexed.get(arrayPath)!.set(index, entry.value);
    } else {
      rest.push(entry);
    }
  }

  if (indexed.size === 0) return entries;
  const normalizedBaseConfig = normalizeAppServiceKeys(baseConfig);

  for (const [arrayPath, updates] of indexed) {
    const segments = arrayPath.split('.');
    let current: unknown = normalizedBaseConfig;
    for (const seg of segments) {
      if (current == null || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[seg];
    }
    const arr = toConfigArraySource(current) ?? [];
    for (const [idx, value] of updates) {
      arr[idx] = value;
    }
    const strippedArr = stripSecretPreviewValues(
      arr as t.ConfigValue[],
      arrayPath,
      getSchemaPathSet(),
    );
    rest.push({ fieldPath: arrayPath, value: strippedArr });
    mergedPaths?.add(arrayPath);
  }

  return rest;
}

function hasIndexedArrayEntry(entries: t.SaveEntry[]): boolean {
  for (const entry of entries) {
    if (parseIndexedArrayPath(entry.fieldPath)) return true;
  }
  return false;
}

async function mergeIndexedArrayEntries(
  entries: t.SaveEntry[],
  mergedPaths?: Set<string>,
): Promise<t.SaveEntry[]> {
  if (!hasIndexedArrayEntry(entries)) return entries;
  const baseResponse = await apiFetch('/api/admin/config/base');
  if (!baseResponse.ok) throw new Error(`Failed to fetch base config: ${baseResponse.status}`);
  const { config: baseConfig } = (await baseResponse.json()) as {
    config: Record<string, t.ConfigValue>;
  };
  return mergeIndexedArrayEntriesIntoBase(entries, baseConfig, mergedPaths);
}

function isProcessMCPServerFieldPath(fieldPath: string, value: t.ConfigValue): boolean {
  const [section, serverName, field] = fieldPath.split('.');
  if (section !== 'mcpServers') return false;
  if (serverName == null) {
    return isConfigRecord(value) && Object.values(value).some(isProcessMCPServerConfig);
  }
  if (field == null) return isProcessMCPServerConfig(value);
  return isProcessMCPServerField(field) || (field === 'type' && value === 'stdio');
}

function describeUnsafeKey({ path, key }: t.UnsafeConfigKey): string {
  return `${path ? `${path} → ` : ''}"${key}": ${UNSAFE_CONFIG_KEY_MESSAGE}`;
}

const YAML_MANAGED_MESSAGE =
  'managed in librechat.yaml; LibreChat ignores admin overrides for it until it re-processes them';

/**
 * Pre-flight for a batch of saves and resets, run before anything is written:
 * per-entry schema validation (an indexed array entry such as
 * `endpoints.custom.3` is validated against the element schema), the
 * process-backed MCP field rule, and keys the admin API would silently drop.
 * Paths the panel must not write (`getWriteSkipReason`: read-only and
 * dedicated sections, role permissions, YAML-managed fields) are reported in
 * `skipped`; this covers every write path, imports and profile saves included.
 */
export function checkConfigChanges(saves: t.SaveEntry[], resets: string[]): t.ConfigCheckResult {
  const errors: t.FieldValidationError[] = [];
  const skipped: t.SkippedChange[] = [];
  for (const { fieldPath, value } of saves) {
    const reason = getWriteSkipReason(fieldPath, false);
    if (reason) {
      skipped.push({ fieldPath, reason });
      continue;
    }
    const managed = findYamlManagedValues(fieldPath, value);
    if (managed.length > 0) {
      errors.push(
        ...managed.map((path) => ({ fieldPath, error: `${path}: ${YAML_MANAGED_MESSAGE}` })),
      );
      continue;
    }
    if (isProcessMCPServerFieldPath(fieldPath, value)) {
      errors.push({
        fieldPath,
        error: `${fieldPath}: process-backed MCP servers (command, args, env, cwd, stderr, stdio) can only be configured in librechat.yaml`,
      });
      continue;
    }
    const unsafe = BLOCK_UNSAFE_CONFIG_KEYS ? findUnsafeKeys(value, fieldPath) : [];
    if (unsafe.length > 0) {
      errors.push(...unsafe.map((u) => ({ fieldPath, error: describeUnsafeKey(u) })));
      continue;
    }
    const result = validateFieldValue(fieldPath, value);
    if (!result.success) errors.push({ fieldPath, error: result.error });
  }
  for (const fieldPath of resets) {
    const reason = getWriteSkipReason(fieldPath, true);
    if (reason) skipped.push({ fieldPath, reason });
  }
  return { errors, skipped };
}

function formatCheckErrors(errors: t.FieldValidationError[]): string {
  return `Validation failed — ${errors.map((e) => e.error).join('; ')}`;
}

function topLevelSections(paths: string[]): string[] {
  return [...new Set(paths.map(getConfigSection))];
}

const saveEntrySchema = z.object({ fieldPath: safeFieldPath, value: z.unknown() });

/** Validates a batch before any write so a failed save never leaves resets half-applied. */
export const validateConfigChangesFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      target: z.enum(['base', 'scope']),
      saves: z.array(saveEntrySchema).max(2000),
      resets: z.array(safeFieldPath).max(2000),
    }),
  )
  .handler(async ({ data }) => {
    const saves = data.saves as t.SaveEntry[];
    const check = checkConfigChanges(saves, data.resets);
    const skippedPaths = new Set(check.skipped.map((s) => s.fieldPath));
    const written = [...saves.map((e) => e.fieldPath), ...data.resets].filter(
      (p) => !skippedPaths.has(p),
    );
    if (data.target === 'base') {
      if (written.length > 0) await requireAllSectionCapabilities(topLevelSections(written));
    } else {
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
    }
    return check;
  });

/** The admin API accepts at most this many entries per PATCH. */
const MAX_PATCH_ENTRIES = 100;

/**
 * Entries of a PATCH batch that LibreChat did not store. A 200 "No actionable
 * field entries" reply means it stripped the whole batch. Otherwise the reply
 * carries the stored overrides, and an entry whose top-level section is absent
 * from them was stripped (LibreChat strips by section: base-only, dedicated
 * and newer sections this panel does not know about yet).
 */
export function findDroppedEntries(batch: t.SaveEntry[], body: t.PatchFieldsResponse): string[] {
  if (body.message?.startsWith('No actionable')) return batch.map((e) => e.fieldPath);
  const overrides = body.config?.overrides;
  if (!isConfigRecord(overrides)) return [];
  return batch
    .filter((e) => !Object.hasOwn(overrides, getConfigSection(e.fieldPath)))
    .map((e) => e.fieldPath);
}

/**
 * PATCHes field entries in batches the admin API accepts. Entries LibreChat
 * did not store are returned as `skipped` (`notStored`) so the caller never
 * reports them saved. A batch rejected after earlier batches were written
 * fails with an error that says how many entries were already saved.
 */
export async function patchConfigFields(
  url: string,
  entries: t.SaveEntry[],
  extraBody: { priority?: number } = {},
): Promise<{ applied: number; skipped: t.SkippedChange[] }> {
  let applied = 0;
  const skipped: t.SkippedChange[] = [];
  for (let i = 0; i < entries.length; i += MAX_PATCH_ENTRIES) {
    const batch = entries.slice(i, i + MAX_PATCH_ENTRIES);
    const response = await apiFetch(url, {
      method: 'PATCH',
      body: JSON.stringify({ entries: batch, ...extraBody }),
    });
    const body = (await response.json().catch(() => ({}))) as t.PatchFieldsResponse;
    if (!response.ok) {
      const message = body.error ?? `Failed to save config: ${response.status}`;
      throw new Error(
        applied > 0
          ? `${message} (${applied} of ${entries.length} entries were already saved)`
          : message,
      );
    }
    const dropped = findDroppedEntries(batch, body);
    applied += batch.length - dropped.length;
    skipped.push(...dropped.map((fieldPath) => ({ fieldPath, reason: 'notStored' as const })));
  }
  return { applied, skipped };
}

/**
 * Splits a request into the entries to write and the ones the panel must not
 * send, and rejects the whole request if any entry fails the pre-flight.
 */
export function prepareConfigWrite(entries: t.SaveEntry[]): {
  writable: t.SaveEntry[];
  skipped: t.SkippedChange[];
} {
  const check = checkConfigChanges(entries, []);
  if (check.errors.length > 0) throw new Error(formatCheckErrors(check.errors));
  const skippedPaths = new Set(check.skipped.map((s) => s.fieldPath));
  return {
    writable: entries.filter((e) => !skippedPaths.has(e.fieldPath)),
    skipped: check.skipped,
  };
}

export const saveBaseConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      entries: z.array(saveEntrySchema).min(1).max(2000),
    }),
  )
  .handler(async ({ data }): Promise<t.ConfigWriteResult> => {
    const { writable, skipped } = prepareConfigWrite(data.entries as t.SaveEntry[]);
    if (writable.length === 0) return { success: true, applied: 0, skipped };

    /** Indexed array entries (e.g. endpoints.custom.2) were validated against the element schema above; merge them back into full arrays so the API receives complete field values. */
    const merged = await mergeIndexedArrayEntries(writable);

    await requireAllSectionCapabilities(topLevelSections(merged.map((e) => e.fieldPath)));

    const result = await patchConfigFields(
      `/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}/fields`,
      merged,
      { priority: 0 },
    );
    return { success: true, applied: result.applied, skipped: [...skipped, ...result.skipped] };
  });

export const resetBaseConfigFieldFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ fieldPath: safeFieldPath }))
  .handler(async ({ data }) => {
    if (isInterfacePermissionPath(data.fieldPath)) return { success: true };
    const section = data.fieldPath.split('.')[0];
    await requireAnyCapability([SystemCapabilities.MANAGE_CONFIGS, `manage:configs:${section}`]);
    const response = await apiFetch(
      `/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}/fields?fieldPath=${encodeURIComponent(data.fieldPath)}`,
      { method: 'DELETE' },
    );

    if (!response.ok && response.status !== 404) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error ?? `Failed to reset field: ${response.status}`,
      );
    }

    return { success: true };
  });

/** Deletes the entire base config DB override, reverting every value back to
 *  what librechat.yaml defines. Removes the `__base__` config document outright;
 *  scope (role/group/user) profiles are untouched. A 404 means there was no
 *  override to begin with, which is treated as success. */
export const resetBaseConfigFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
  const response = await apiFetch(`/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}`, {
    method: 'DELETE',
  });

  if (!response.ok && response.status !== 404) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `Failed to reset base config: ${response.status}`,
    );
  }

  return { success: true };
});
