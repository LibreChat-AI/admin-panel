import { configSchema, isProcessMCPServerConfig } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  flattenImport,
  findUnsafeKeys,
  isConfigRecord,
  resolveSubSchema,
  scopeGateSkipReason,
  getWriteSkipReason,
  findYamlManagedValues,
  secretPathForPreviewPath,
  stripSecretPreviewValues,
} from '@/utils';
import { SKIP_REASON_KEYS, BUNDLED_WRITE_RULES, BUNDLED_CONFIG_FEATURES } from '@/constants';
import { findSchemaField } from './controls';
import { normalizeForSave } from './edits';

/** Locale keys for why an imported key is left out. */
export const IMPORT_SKIP_KEYS: Readonly<Record<t.ImportSkipReason, string>> = {
  ...SKIP_REASON_KEYS,
  unsafeKey: 'com_config_review_import_skip_unsafe',
  reservedKey: 'com_config_review_import_skip_reserved',
  dottedKey: 'com_config_review_import_skip_dotted',
  dottedName: 'com_config_review_import_skip_dotted_name',
  processMcp: 'com_config_review_import_skip_process',
};

/** Skips of one key, reported at the object holding it: a section the panel never writes wins. */
const KEY_SKIP_REASONS: ReadonlySet<t.ImportSkipReason> = new Set([
  'unsafeKey',
  'reservedKey',
  'dottedKey',
  'dottedName',
]);

/**
 * One save entry per leaf of the imported YAML, minus metadata, empty objects
 * and redacted secret companions. Each value is normalized like a pending
 * edit (`normalizeForSave`), so blank list items are dropped; a leaf left with
 * no value (`allowedDomains: [""]`, `titleModel: ""`) is reported as skipped
 * instead of being stored as an empty override that LibreChat would read as
 * "allow nothing". Keys the admin API can't store are reported as `unsafeKey`
 * (`reservedKey` on a server that keeps dotted keys), a dotted key where
 * the schema expects a setting name as `dottedKey`, and a dotted name of a
 * setting group (an MCP server) as `dottedName`, with the object holding
 * them, instead of being split into nested paths.
 */
export function collectImportEntries(
  appConfig: t.ConfigRecord,
  fields: t.SchemaField[],
  schemaPathSet: ReadonlySet<string>,
  features: t.ConfigFeatures = BUNDLED_CONFIG_FEATURES,
): t.ImportEntries {
  const entries: t.SaveEntry[] = [];
  const skipped: t.ImportSkippedKey[] = [];
  const { leaves, unsafe, dotted, dottedNames } = flattenImport(appConfig, features);
  for (const [fieldPath, raw] of Object.entries(leaves)) {
    if (isConfigRecord(raw) && Object.keys(raw).length === 0) continue;
    if (secretPathForPreviewPath(fieldPath, schemaPathSet) != null) continue;
    const value = normalizeForSave(
      stripSecretPreviewValues(raw, fieldPath, schemaPathSet),
      findSchemaField(fields, fieldPath),
    );
    if (value == null) skipped.push({ fieldPath, reason: 'empty' });
    else entries.push({ fieldPath, value });
  }
  const unsafeReason = unsafeKeyReason(features);
  for (const { path, key } of unsafe) skipped.push({ fieldPath: path, reason: unsafeReason, key });
  for (const { path, key } of dotted) skipped.push({ fieldPath: path, reason: 'dottedKey', key });
  for (const { path, key } of dottedNames) {
    skipped.push({ fieldPath: path, reason: 'dottedName', key });
  }
  return { entries, skipped };
}

/** Why a key the admin API can't store is left out: dotted or `$` keys, or (with `dottedKeys`) `$` keys only. */
function unsafeKeyReason(features: t.ConfigFeatures): t.ImportSkipReason {
  return features.dottedKeys ? 'reservedKey' : 'unsafeKey';
}

/** The MCP server a path belongs to when that server is process-backed (stdio: command/args/env). */
function processServerOf(path: string, appConfig: t.ConfigRecord): string | undefined {
  const [section, name] = path.split('.');
  if (section !== 'mcpServers' || name == null) return undefined;
  const servers = appConfig.mcpServers ?? appConfig.mcpConfig;
  const server = isConfigRecord(servers) ? servers[name] : undefined;
  return isProcessMCPServerConfig(server) ? `mcpServers.${name}` : undefined;
}

/**
 * Why an imported leaf is left out, checked in the order the save pipeline
 * would: sections and fields the panel never writes first (so a dotted key
 * inside an Azure group, which is skipped anyway, does not block the import),
 * then keys the admin API can't store.
 */
function skipReasonOf(
  path: string,
  value: t.ConfigValue,
  isScope: boolean,
  features: t.ConfigFeatures,
  rules: t.ConfigWriteRules,
): t.ImportSkipReason | null {
  const reason =
    getWriteSkipReason(path, false, rules) ?? (isScope ? scopeGateSkipReason(path, rules) : null);
  if (reason) return reason;
  if (findYamlManagedValues(path, value, rules).length > 0) return 'yamlOnly';
  if (findUnsafeKeys(value, path, features.dottedKeys).length > 0) {
    return unsafeKeyReason(features);
  }
  return null;
}

/**
 * What an import writes (WS7, D4 merge semantics): every leaf of the YAML
 * that can be written, and every other leaf with the reason it is left out
 * (role permissions, librechat.yaml-only and base-only sections, sections a
 * profile can't set, keys the admin API can't store, process-backed MCP
 * servers, empty values). Leaves
 * the bundled schema does not describe are imported as-is and flagged.
 */
export function planImport(
  appConfig: t.ConfigRecord,
  fields: t.SchemaField[],
  schemaPathSet: ReadonlySet<string>,
  isScope = false,
  features: t.ConfigFeatures = BUNDLED_CONFIG_FEATURES,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
): t.ImportPlan {
  const collected = collectImportEntries(appConfig, fields, schemaPathSet, features);
  const entries: t.SaveEntry[] = [];
  const skipped: t.ImportSkippedKey[] = [];
  const unknown = new Set<string>();
  const processServers = new Set<string>();

  for (const entry of collected.entries) {
    const server = processServerOf(entry.fieldPath, appConfig);
    if (server) {
      if (!processServers.has(server)) skipped.push({ fieldPath: server, reason: 'processMcp' });
      processServers.add(server);
      continue;
    }
    const reason = skipReasonOf(entry.fieldPath, entry.value, isScope, features, rules);
    if (reason) {
      skipped.push({ fieldPath: entry.fieldPath, reason });
      continue;
    }
    if (resolveSubSchema(configSchema as t.ZodSchemaLike, entry.fieldPath.split('.')) == null) {
      unknown.add(entry.fieldPath);
    }
    entries.push(entry);
  }

  for (const skip of collected.skipped) {
    const server = processServerOf(skip.fieldPath, appConfig);
    if (server && processServers.has(server)) continue;
    const holderReason =
      KEY_SKIP_REASONS.has(skip.reason) && skip.fieldPath
        ? getWriteSkipReason(skip.fieldPath, false, rules)
        : null;
    skipped.push(holderReason ? { fieldPath: skip.fieldPath, reason: holderReason } : skip);
  }

  return { entries, skipped, unknown };
}
