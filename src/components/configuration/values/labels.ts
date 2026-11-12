import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { MASKED_SECRET, isEnvReference } from '@/utils';
import { AZURE_GROUPS_PATH } from '@/constants';
import { getFieldMeta } from '../meta';

const MAX_TEXT_LENGTH = 40;

/** Keys whose values are credentials; their text never reaches chips or labels. */
const SECRET_KEY_PATTERN = /(apikey|secret|password|token|servicekey)$/i;

const SCOPE_SOURCE_KEYS: Readonly<Partial<Record<PrincipalType, string>>> = {
  [PrincipalType.ROLE]: 'com_config_values_source_role',
  [PrincipalType.GROUP]: 'com_config_values_source_group',
  [PrincipalType.USER]: 'com_config_values_source_user',
};

const SOURCE_KEYS: Readonly<Record<t.ProvenanceSource, string>> = {
  default: 'com_config_values_source_default',
  runtimeDefault: 'com_config_values_source_runtime',
  yaml: 'com_config_values_source_yaml',
  admin: 'com_config_values_source_admin',
  scope: 'com_config_values_source_scope',
  inherited: 'com_config_values_source_inherited',
};

const INHERITED_KEYS: t.RevertKeys = {
  label: 'com_config_values_revert_inherited',
  aria: 'com_config_values_revert_inherited_aria',
  compact: 'com_config_values_revert_inherited_compact',
};

/** Removing an override that falls back to no value at all. */
const UNSET_KEYS: t.RevertKeys = {
  label: 'com_config_values_revert_unset',
  aria: 'com_config_values_revert_unset_aria',
  compact: 'com_config_values_revert_unset_compact',
};

/** Revert keys by the layer a field reverts to. */
const REVERT_KEYS: Readonly<Record<t.ProvenanceSource, t.RevertKeys>> = {
  yaml: {
    label: 'com_config_values_revert_yaml',
    aria: 'com_config_values_revert_yaml_aria',
    compact: 'com_config_values_revert_yaml_compact',
  },
  default: {
    label: 'com_config_values_revert_default',
    aria: 'com_config_values_revert_default_aria',
    compact: 'com_config_values_revert_default_compact',
  },
  runtimeDefault: {
    label: 'com_config_values_revert_runtime',
    aria: 'com_config_values_revert_runtime_aria',
    compact: 'com_config_values_revert_runtime_compact',
  },
  inherited: INHERITED_KEYS,
  admin: INHERITED_KEYS,
  scope: INHERITED_KEYS,
};

function lastSegment(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? path : path.slice(dot + 1);
}

/**
 * Short display text for a config value in chips, hover cards and revert
 * labels: On/Off, grouped numbers, truncated text, item counts for lists and
 * objects, and a mask for credentials.
 */
export function formatConfigValue(value: t.ConfigValue, localize: t.LocalizeFn, path = ''): string {
  if (value === undefined || value === null || value === '') {
    return localize('com_config_values_not_set');
  }
  if (typeof value === 'boolean') {
    /** A switch shown inverted (`memory.disabled` as "Enable memory") names its values from the meta. */
    const labelKey = path ? getFieldMeta(path)?.enumLabels?.[String(value)] : undefined;
    if (labelKey) return localize(labelKey);
    return localize(value ? 'com_config_values_on' : 'com_config_values_off');
  }
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(lastSegment(path)) && !isEnvReference(value)) return MASKED_SECRET;
    return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH - 1)}…` : value;
  }
  if (Array.isArray(value)) return localize('com_config_values_items', { count: value.length });
  return localize('com_config_values_keys', { count: Object.keys(value).length });
}

/** Layers that store their own values; a secret they hold comes back redacted (no value). */
const STORING_SOURCES: ReadonlySet<t.ProvenanceSource> = new Set(['admin', 'scope']);

/**
 * One layer of the hover stack: Hidden for a tombstone, the masked secret for
 * a secret an override stores (the backend redacts it, so it has no value
 * here), else the value.
 */
export function formatLayerValue(layer: t.FieldLayer, localize: t.LocalizeFn, path = ''): string {
  if (layer.hidden) return localize('com_config_values_source_hidden');
  const isRedacted =
    layer.value === undefined &&
    STORING_SOURCES.has(layer.source) &&
    SECRET_KEY_PATTERN.test(lastSegment(path));
  return isRedacted ? MASKED_SECRET : formatConfigValue(layer.value, localize, path);
}

/** "Role: USER", "Group: Design", or the profile name. */
export function scopeSourceLabel(
  scope: Pick<t.ScopeLayer, 'principalType' | 'name'> | null | undefined,
  localize: t.LocalizeFn,
): string {
  if (!scope) return localize(SOURCE_KEYS.scope, { name: '' }).trim();
  return localize(SCOPE_SOURCE_KEYS[scope.principalType] ?? SOURCE_KEYS.scope, {
    name: scope.name,
  });
}

/** "Role: USER, Group: Design" for the profiles a note names. */
function profileList(overrides: readonly t.EntryOverride[], localize: t.LocalizeFn): string {
  return overrides.map(({ scope }) => scopeSourceLabel(scope, localize)).join(', ');
}

/** The locale keys of a change's sentences: on the profiles that override the entry, store their own keys there, and hide it. */
function entryNoteKeys(change: t.EntryOverrideChange): [string?, string?, string?] {
  switch (change.kind) {
    case 'removed':
      return ['com_config_entry_profiles_removed', 'com_config_entry_profiles_keys_kept'];
    case 'moved':
      return [undefined, 'com_config_entry_profiles_keys_unbound'];
    case 'took':
      return [
        'com_config_entry_profiles_took',
        change.sendsKeys
          ? 'com_config_entry_profiles_keys_took'
          : 'com_config_entry_profiles_keys_took_unbound',
        'com_config_entry_profiles_hidden_took',
      ];
    case 'renamed':
      return change.taken
        ? ['com_config_entry_profiles_taken', 'com_config_entry_profiles_keys_kept']
        : [
            'com_config_entry_profiles_renamed',
            'com_config_entry_profiles_keys_renamed',
            'com_config_entry_profiles_hidden',
          ];
  }
}

/** The settings that say where an Azure group is served; a group needs one of its own to resolve. */
const AZURE_DESTINATION_KEYS: ReadonlySet<string> = new Set(['instanceName', 'baseURL']);

/**
 * The locale key of a profile's override of an Azure group that a removal or
 * rename leaves as a group of its own (`leavesUnresolvedGroup`): LibreChat
 * resolves a profile's groups together, so one that doesn't resolve makes it
 * ignore them all. None for other changes, or other collections.
 */
function orphanedGroupKey(change: t.EntryOverrideChange, collection?: string): string | undefined {
  if (collection !== AZURE_GROUPS_PATH) return undefined;
  if (change.kind === 'removed') return 'com_config_entry_profiles_group_removed';
  if (change.kind === 'renamed' && !change.taken) return 'com_config_entry_profiles_group_renamed';
  return undefined;
}

/** Whether a profile's override of an Azure group sets no instance or base URL, so left alone the group can't resolve. */
function leavesUnresolvedGroup(override: t.EntryOverride): boolean {
  return !override.settings.some((setting) => AZURE_DESTINATION_KEYS.has(setting));
}

/**
 * What a change in Base does to the profiles that override the entry by
 * name (`EntryOverrideChange`), one sentence each: their overrides, the keys
 * of their own they store there, and their hides. A rename or removal leaves
 * them under the old name, a moved destination stops their keys (the
 * profiles given are those `findUnboundOverrides` finds), and a rename or a
 * new entry onto a name they override takes them. An Azure group's
 * (`collection`) left without an instance or base URL makes LibreChat ignore
 * every group override of the profile. Empty when no profile is affected.
 */
export function describeEntryOverrides(
  overrides: readonly t.EntryOverride[],
  change: t.EntryOverrideChange,
  localize: t.LocalizeFn,
  collection?: string,
): string[] {
  const next = change.kind === 'renamed' ? change.next : '';
  const sentence = (key: string | undefined, matching: t.EntryOverride[]): string[] =>
    key === undefined || matching.length === 0
      ? []
      : [
          localize(key, {
            count: matching.length,
            profiles: profileList(matching, localize),
            name: change.name,
            next,
          }),
        ];
  const [overridesKey, keysKey, hidesKey] = entryNoteKeys(change);
  const own = overrides.filter((override) => override.overrides);
  const orphanKey = orphanedGroupKey(change, collection);
  const orphaned = orphanKey ? own.filter(leavesUnresolvedGroup) : [];
  return [
    ...sentence(orphanKey, orphaned),
    ...sentence(
      overridesKey,
      own.filter((override) => !orphaned.includes(override)),
    ),
    ...sentence(
      keysKey,
      overrides.filter((override) => override.secrets.length > 0),
    ),
    ...sentence(
      hidesKey,
      overrides.filter((override) => override.hidden),
    ),
  ];
}

/** Every note on the profiles that override an entry by name, worded (`describeEntryOverrides`). */
export function describeOverrideNotes(
  notes: readonly t.EntryOverrideNote[],
  localize: t.LocalizeFn,
): string[] {
  return notes.flatMap(({ overrides, change, collection }) =>
    describeEntryOverrides(overrides, change, localize, collection),
  );
}

/** Display name of a value layer. */
export function sourceLabel(
  source: t.ProvenanceSource,
  localize: t.LocalizeFn,
  scope?: Pick<t.ScopeLayer, 'principalType' | 'name'> | null,
): string {
  if (source === 'scope') return scopeSourceLabel(scope, localize);
  return localize(SOURCE_KEYS[source], { name: scope?.name ?? '' });
}

/**
 * Label and accessible names of a field's revert action (EV-4): what removing
 * the edit target's own override falls back to, e.g. "Revert to
 * librechat.yaml (1,000,000)" or "Remove override (inherits On)". Each
 * accessible name starts with the words its control shows (WCAG 2.5.3).
 * Undefined when the field has no override to revert.
 */
export function getRevertLabels(
  state: t.FieldState,
  name: string,
  localize: t.LocalizeFn,
  path = '',
  scope?: Pick<t.ScopeLayer, 'principalType' | 'name'> | null,
): t.RevertLabels | undefined {
  const target = state.revertTarget;
  if (!target) return undefined;
  const value = formatConfigValue(target.value, localize, path);
  const keys =
    target.value === undefined && target.source === 'default'
      ? UNSET_KEYS
      : REVERT_KEYS[target.source];
  const options = { name, value, scope: scopeSourceLabel(scope, localize) };
  return {
    label: localize(keys.label, options),
    ariaLabel: localize(keys.aria, options),
    compactAriaLabel: localize(keys.compact, options),
  };
}

/** Accessible summary of where a value comes from, e.g. "Default 20,000 · librechat.yaml 1,000,000". */
export function describeStack(
  state: t.FieldState,
  localize: t.LocalizeFn,
  path = '',
  scope?: Pick<t.ScopeLayer, 'principalType' | 'name'> | null,
  formatLayer?: (layer: t.FieldLayer) => string,
): string {
  return (state.stack ?? [])
    .map((layer) => {
      const label = sourceLabel(layer.source, localize, scope);
      const value = formatLayer?.(layer) ?? formatLayerValue(layer, localize, path);
      return localize('com_config_values_stack_item', { source: label, value });
    })
    .join(' · ');
}
