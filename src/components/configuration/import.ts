import type * as t from '@/types';
import {
  flattenObject,
  isConfigRecord,
  secretPathForPreviewPath,
  stripSecretPreviewValues,
} from '@/utils';
import { APP_SERVICE_KEY_ALIASES } from '@/constants';
import { findSchemaField } from './controls';
import { normalizeForSave } from './edits';

/** Top-level YAML keys that describe the file itself rather than a setting. */
const IMPORT_METADATA_KEYS = new Set(['version']);

/**
 * Leaves of an imported YAML keyed by canonical dot-path. AppService alias
 * sections (`interfaceConfig`) are merged with their canonical section
 * (`interface`) leaf by leaf, the canonical spelling winning on conflicts.
 */
function flattenImport(appConfig: t.ConfigRecord): t.FlatConfigMap {
  const aliased: t.ConfigRecord = {};
  const canonical: t.ConfigRecord = {};
  for (const [key, value] of Object.entries(appConfig)) {
    if (IMPORT_METADATA_KEYS.has(key)) continue;
    const alias = APP_SERVICE_KEY_ALIASES[key];
    if (alias) aliased[alias] = value;
    else canonical[key] = value;
  }
  return { ...flattenObject(aliased), ...flattenObject(canonical) };
}

/**
 * One save entry per leaf of the imported YAML, minus metadata, empty objects
 * and redacted secret companions. Each value is normalized like a pending
 * edit (`normalizeForSave`), so blank list items are dropped; a leaf left with
 * no value (`allowedDomains: [""]`, `titleModel: ""`) is reported as skipped
 * instead of being stored as an empty override that LibreChat would read as
 * "allow nothing". Fields the panel must not write (role permissions,
 * librechat.yaml-only sections) are kept here so the save pre-flight reports
 * them as skipped instead of dropping them silently.
 */
export function collectImportEntries(
  appConfig: t.ConfigRecord,
  fields: t.SchemaField[],
  schemaPathSet: ReadonlySet<string>,
): t.ImportEntries {
  const entries: t.SaveEntry[] = [];
  const skipped: t.SkippedChange[] = [];
  for (const [fieldPath, raw] of Object.entries(flattenImport(appConfig))) {
    if (isConfigRecord(raw) && Object.keys(raw).length === 0) continue;
    if (secretPathForPreviewPath(fieldPath, schemaPathSet) != null) continue;
    const value = normalizeForSave(
      stripSecretPreviewValues(raw, fieldPath, schemaPathSet),
      findSchemaField(fields, fieldPath),
    );
    if (value == null) skipped.push({ fieldPath, reason: 'empty' });
    else entries.push({ fieldPath, value });
  }
  return { entries, skipped };
}
