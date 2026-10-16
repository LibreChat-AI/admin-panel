import type * as t from '@/types';
import { getValueAtPath } from './format';

/**
 * Value a field control shows: a pending edit first, then the merged tree
 * (`fallback`). The scope's saved leaves (`resolvedValues`) are only used when
 * nothing under the path is pending — they are the stale saved array for a
 * collection whose entries are being edited.
 */
export function resolveFieldValue(
  path: string,
  fallback: t.ConfigValue,
  editedValues: t.FlatConfigMap,
  resolvedValues: t.FlatConfigMap | null | undefined,
  schemaDefaults: t.FlatConfigMap | undefined,
): t.ConfigValue {
  if (path in editedValues) {
    if (editedValues[path] === undefined) return schemaDefaults?.[path] ?? fallback;
    return editedValues[path];
  }
  if (!resolvedValues || !(path in resolvedValues)) return fallback;
  const prefix = `${path}.`;
  for (const editPath of Object.keys(editedValues)) {
    if (editPath.startsWith(prefix)) return fallback;
  }
  return resolvedValues[path];
}

const NO_VALUES_STATE: t.FieldState = {
  value: undefined,
  effective: undefined,
  source: 'default',
  isConfigured: false,
  isOverride: false,
  isEdited: false,
  isPendingReset: false,
  isHidden: false,
};

/**
 * Provenance from today's data: the edit target's own override, else
 * librechat.yaml for a configured base value, else inherited (profile mode) or
 * the default. WS4 replaces this with the full layer model (EV-1).
 */
function resolveProvenance(
  data: t.ConfigValuesData,
  isOverride: boolean,
  isConfigured: boolean,
): t.ProvenanceSource {
  if (isOverride) return data.isEditingScope ? 'scope' : 'admin';
  if (data.isEditingScope) return 'inherited';
  return isConfigured ? 'yaml' : 'default';
}

/**
 * `FieldState` for a path from the page's current value layers (stub, WS4).
 * `value` matches what the field control shows today; `effective` is the
 * tree value (or the schema default when unset), which in profile mode is the
 * profile's own value only until WS4 adds inherited values. `revertTarget`,
 * `shadowedBy`, `isHidden` and `error` are not derived yet.
 */
export function deriveFieldState(path: string, data: t.ConfigValuesData | null): t.FieldState {
  if (!data) return NO_VALUES_STATE;
  const treeValue = getValueAtPath(data.configValues, path);
  const isOverride = data.overridePaths?.has(path) ?? false;
  const isConfigured = data.configuredPaths?.has(path) ?? false;
  return {
    value: resolveFieldValue(
      path,
      treeValue,
      data.editedValues,
      data.resolvedValues,
      data.schemaDefaults,
    ),
    effective: treeValue === undefined ? data.schemaDefaults?.[path] : treeValue,
    source: resolveProvenance(data, isOverride, isConfigured),
    isConfigured,
    isOverride,
    isEdited: path in data.editedValues,
    isPendingReset: data.pendingResets?.has(path) ?? false,
    isHidden: false,
  };
}
