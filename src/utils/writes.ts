import type * as t from '@/types';
import {
  YAML_MANAGED_FIELDS,
  DEDICATED_CONFIG_SECTIONS,
  getConfigSection,
  getReadOnlyReason,
  isYamlManagedPath,
} from '@/constants';
import { isInterfacePermissionPath } from './interfacePermissions';
import { getValueAtPath } from './format';

/**
 * Why a save (or reset) at `path` must not be sent to the generic admin config
 * API, or null when it can be. The one rule set for the review, the server
 * pre-flight and every write path (save, import, profile saves). Removing a
 * stale override of a YAML-managed field is allowed; writing one is not.
 */
export function getWriteSkipReason(path: string, isReset: boolean): t.SkipReason | null {
  if (isInterfacePermissionPath(path)) return 'permission';
  const readOnly = getReadOnlyReason(path);
  if (readOnly) return readOnly;
  if (DEDICATED_CONFIG_SECTIONS.has(getConfigSection(path))) return 'dedicated';
  if (!isReset && isYamlManagedPath(path)) return 'yamlOnly';
  return null;
}

/** YAML-managed fields carried inside a value saved at an ancestor path (e.g. `endpoints.azureOpenAI`). */
export function findYamlManagedValues(path: string, value: t.ConfigValue): string[] {
  const prefix = `${path}.`;
  return [...YAML_MANAGED_FIELDS].filter(
    (managed) =>
      managed.startsWith(prefix) && getValueAtPath(value, managed.slice(prefix.length)) != null,
  );
}
