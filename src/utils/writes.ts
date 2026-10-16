import type * as t from '@/types';
import {
  SKIP_REASON_KEYS,
  YAML_MANAGED_FIELDS,
  DEDICATED_CONFIG_SECTIONS,
  getConfigSection,
  getReadOnlyReason,
  isYamlManagedPath,
} from '@/constants';
import { isInterfacePermissionPath } from './interfacePermissions';
import translation from '@/locales/en/translation.json';
import { getValueAtPath } from './format';

/** English text for a skip reason, for server-side errors (the UI localizes `SKIP_REASON_KEYS`). */
export function describeSkipReason(reason: t.SkipReason): string {
  const key = SKIP_REASON_KEYS[reason] as keyof typeof translation;
  return translation[key] ?? reason;
}

/**
 * Why a save (or reset) at `path` must not be sent to the generic admin config
 * API, or null when it can be. The one rule set for the review, the server
 * pre-flight and every write path (save, import, profile saves). Removing a
 * stale override of a YAML-managed field, or of a section LibreChat only reads
 * from librechat.yaml, is allowed (it only removes data); writing one is not.
 */
export function getWriteSkipReason(path: string, isReset: boolean): t.SkipReason | null {
  if (isInterfacePermissionPath(path)) return 'permission';
  const readOnly = getReadOnlyReason(path);
  if (readOnly && !(isReset && readOnly === 'yamlOnly')) return readOnly;
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
