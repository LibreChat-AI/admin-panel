import type * as t from '@/types';
import { DEFAULT_PROVIDER_LAYOUT, PROVIDER_LAYOUTS, labelForPath } from '../../meta';
import {
  MASKED_SECRET,
  isEnvReference,
  getValueAtPath,
  isConfigRecord,
  resolveShadowedBy,
} from '@/utils';
import { BUILT_IN_PROVIDERS, GLOBAL_PROVIDER_KEY } from '@/constants';
import { formatFieldValue, getFieldOptions } from '../../controls';
import { fieldMetaFor, isSecretField } from '../../renderer/kinds';
import { isPathSet } from '../../counts';

const ADVANCED_KEY = 'advanced';
export const NETWORK_KEY = 'allowedAddresses';
export const CUSTOM_KEY = 'custom';
const GROUPS_KEY = 'groups';
const ENUM_LIST = /^array<enum\(/;
const MAX_LIST_PREVIEW = 2;
const SHADOW_SUMMARY_KEYS = {
  wins: 'com_config_providers_summary_shadowed',
  ignored: 'com_config_providers_summary_shadowed_ignored',
  paired: 'com_config_providers_summary_shadowed_pair',
} as const;

/** The purpose groups declared for a provider (the shared endpoint groups for an unknown one). */
export function providerLayout(provider: string): readonly t.ProviderGroupDef[] {
  return PROVIDER_LAYOUTS[provider] ?? DEFAULT_PROVIDER_LAYOUT;
}

/**
 * A provider's schema fields placed in its purpose groups (AP-4), in layout
 * order. Fields no group names (a newer schema) are appended to Advanced, so
 * every field renders exactly once; `fallback` lists their keys. Advanced is
 * always returned (possibly empty: it also holds unknown keys), and groups
 * with no fields are dropped.
 */
export function resolveProviderGroups(
  provider: string,
  fields: t.SchemaField[],
): { groups: t.ProviderGroup[]; fallback: string[] } {
  const layout = providerLayout(provider);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const placed = new Set<string>();
  const groups: t.ProviderGroup[] = [];
  for (const def of layout) {
    const groupFields: t.SchemaField[] = [];
    for (const key of def.fields) {
      const field = byKey.get(key);
      if (!field || placed.has(key)) continue;
      placed.add(key);
      groupFields.push(field);
    }
    groups.push({ def, fields: groupFields });
  }
  const fallback = fields.filter((field) => !placed.has(field.key));
  let advanced = groups.find((group) => group.def.key === ADVANCED_KEY);
  if (!advanced) {
    const def = DEFAULT_PROVIDER_LAYOUT.find((group) => group.key === ADVANCED_KEY);
    advanced = { def: { ...(def as t.ProviderGroupDef), fields: [] }, fields: [] };
    const unusedIndex = groups.findIndex((group) => group.def.unused);
    groups.splice(unusedIndex === -1 ? groups.length : unusedIndex, 0, advanced);
  }
  advanced.fields.push(...fallback);
  return {
    groups: groups.filter((group) => group.fields.length > 0 || group === advanced),
    fallback: fallback.map((field) => field.key),
  };
}

/** A group made of one plain object (Checkpointer, Guardrails): its rows render directly in the group. */
export function flattenedObject(group: t.ProviderGroup): t.SchemaField | undefined {
  if (group.fields.length !== 1) return undefined;
  const [field] = group.fields;
  const isPlainObject =
    !!field.children?.length &&
    !field.isArray &&
    field.type !== 'record' &&
    !field.variants?.length &&
    !field.type.startsWith('union(');
  return isPlainObject ? field : undefined;
}

function listPreview(values: t.ConfigValue[], localize: t.LocalizeFn): string {
  const names = values.map((item) => {
    if (typeof item === 'string') return item;
    if (isConfigRecord(item) && typeof item.name === 'string') return item.name;
    return localize('com_config_providers_summary_item');
  });
  const shown = names.slice(0, MAX_LIST_PREVIEW).join(', ');
  const rest = names.length - MAX_LIST_PREVIEW;
  return rest > 0 ? localize('com_config_providers_summary_more', { shown, count: rest }) : shown;
}

/** Short text for a set value: option labels, On/Off, units, a list preview or a key count. */
export function summaryValue(
  field: t.SchemaField,
  value: t.ConfigValue,
  localize: t.LocalizeFn,
): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return localize('com_config_providers_summary_none');
    if (ENUM_LIST.test(field.type)) {
      return localize('com_config_providers_summary_selected', { count: value.length });
    }
    if (field.key === GROUPS_KEY)
      return localize('com_config_providers_groups', { count: value.length });
    if (value.every((item) => typeof item === 'string')) {
      const labels = new Map(getFieldOptions(field, localize).map((o) => [o.value, o.label]));
      return listPreview(
        value.map((item) => labels.get(String(item)) ?? item),
        localize,
      );
    }
    return listPreview(value, localize);
  }
  if (isConfigRecord(value)) {
    return localize('com_config_providers_summary_keys', { count: Object.keys(value).length });
  }
  return formatFieldValue(field, value, localize) ?? '';
}

/** A summary's text for one field: a secret (even a pending plaintext one) shows only as masked. */
function summaryText(
  field: t.SchemaField,
  path: string,
  value: t.ConfigValue,
  localize: t.LocalizeFn,
): string {
  const isHiddenSecret =
    typeof value === 'string' &&
    !isEnvReference(value) &&
    isSecretField(field, path, fieldMetaFor(field, path));
  return isHiddenSecret ? MASKED_SECRET : summaryValue(field, value, localize);
}

/**
 * The set values among `fields` (librechat.yaml, an override or a pending
 * edit), as "Label: value" items for a card or group summary line.
 */
export function summarizeFields(
  fields: t.SchemaField[],
  parentPath: string,
  read: t.SummaryReader,
  localize: t.LocalizeFn,
): t.SummaryItem[] {
  const items: t.SummaryItem[] = [];
  for (const field of fields) {
    const path = `${parentPath}.${field.key}`;
    if (!read.isSet(path)) continue;
    const value = read.valueAt(path);
    if (value === undefined) continue;
    const text = summaryText(field, path, value, localize);
    const shadow = read.shadowOf?.(path) ?? null;
    items.push({
      label: labelForPath(path, localize),
      value: shadow ? localize(SHADOW_SUMMARY_KEYS[shadow], { value: text }) : text,
    });
  }
  return items;
}

/** "Title model: gpt-5-mini · Activity labels: On · +3 more". */
export function formatSummary(
  items: t.SummaryItem[],
  localize: t.LocalizeFn,
  limit = 3,
): string | undefined {
  if (items.length === 0) return undefined;
  const shown = items
    .slice(0, limit)
    .map(({ label, value }) => localize('com_config_providers_summary_pair', { label, value }))
    .join(' · ');
  const rest = items.length - limit;
  return rest > 0
    ? `${shown} · ${localize('com_config_providers_summary_rest', { count: rest })}`
    : shown;
}

/**
 * How a provider's summaries read its values: set paths (saved or pending),
 * the shown value, and whether Global overrides win over it (`root` is the
 * shown configuration, pending edits included).
 */
export function createSummaryReader({
  providerPath,
  providerValue,
  getValue,
  configuredPaths,
  editedValues,
  root,
  titleResolution,
}: t.SummaryReaderInput): t.SummaryReader {
  return {
    isSet: (path) => isPathSet(path, configuredPaths, editedValues),
    valueAt: (path) =>
      getValue(path, getValueAtPath(providerValue, path.slice(providerPath.length + 1))),
    shadowOf: (path) => {
      const shadow = resolveShadowedBy(path, root, editedValues, titleResolution);
      if (!shadow) return null;
      if (shadow.value !== undefined) return 'wins';
      return shadow.precedence === 'pair' ? 'paired' : 'ignored';
    },
  };
}

/** Global overrides first, then the built-in providers in their usual order, then any new ones. */
function providerRank(key: string): number {
  if (key === GLOBAL_PROVIDER_KEY) return -1;
  const index = BUILT_IN_PROVIDERS.indexOf(key);
  return index === -1 ? BUILT_IN_PROVIDERS.length : index;
}

/** The provider fields of the `endpoints` section (objects other than `custom`), in tab order. */
export function providerFields(fields: t.SchemaField[]): t.SchemaField[] {
  return fields
    .filter((field) => field.key !== CUSTOM_KEY && (field.children?.length ?? 0) > 0)
    .sort((a, b) => providerRank(a.key) - providerRank(b.key));
}

/**
 * Table of contents of the AI providers tab (WS5 shell, WS9 entries): Global
 * overrides, each provider, and Network access when the schema has it.
 */
export function providerTocItems(
  fields: t.SchemaField[],
  dataKey: string,
  localize: t.LocalizeFn,
): t.TocItem[] {
  const items: t.TocItem[] = providerFields(fields).map((field) => {
    const path = `${dataKey}.${field.key}`;
    const label =
      field.key === GLOBAL_PROVIDER_KEY
        ? localize('com_config_providers_global_short')
        : labelForPath(path, localize);
    return { id: `section-${path}`, label, dataPath: path, path };
  });
  if (fields.some((field) => field.key === NETWORK_KEY)) {
    const path = `${dataKey}.${NETWORK_KEY}`;
    items.push({
      id: `section-${path}`,
      label: localize('com_config_providers_network_title'),
      dataPath: path,
      path,
    });
  }
  return items;
}
