import type * as t from '@/types';
import { getReadOnlyReason, KEYED_COLLECTIONS } from '@/constants';
import { hasPathOrAncestor, pathIndexOverlaps } from './paths';
import { getValueAtPath, isConfigRecord } from './format';
import { toSecretPreviewKey } from './secrets';

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
 * Title settings. LibreChat reads them from `endpoints.all` as a whole block
 * whenever one exists (`titleResolution: 'block'`), or per field like the
 * settings below (`'field'`), with the title endpoint and model as one choice.
 */
const TITLE_KEYS: ReadonlySet<string> = new Set([
  'titleConvo',
  'titleModel',
  'titleMethod',
  'titleEndpoint',
  'titlePrompt',
  'titlePromptTemplate',
]);

/** With `titleResolution: 'field'`, both come from the first layer that sets either. */
const TITLE_ROUTING_KEYS: readonly string[] = ['titleEndpoint', 'titleModel'];

/** Settings where a value in `endpoints.all` wins per field: title timing, stream rate, activity and reasoning labels. */
const FIELD_SHADOWED_KEYS: ReadonlySet<string> = new Set([
  'titleTiming',
  'streamRate',
  'activityLabel',
  'activityModel',
  'activityEndpoint',
  'activityPrompt',
  'activityMaxPerRun',
  'activityCharLimit',
  'activityPhaseLabel',
  'activityPhaseModel',
  'activityPhaseEndpoint',
  'activityPhasePrompt',
  'activityPhaseMaxPerRun',
  'reasoningLabel',
  'reasoningLabelModel',
  'reasoningLabelEndpoint',
  'reasoningLabelPrompt',
  'reasoningLabelMinChars',
  'reasoningLabelUpdateChars',
  'reasoningLabelUpdateIntervalMs',
  'reasoningLabelMaxPerRun',
]);

const INDEX_SEGMENT = /^\d+$/;

/** Whether two config values match (object key order counts; good enough for defaults). */
function sameValue(a: t.ConfigValue, b: t.ConfigValue): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The `endpoints.all` setting that takes precedence over a provider or custom
 * endpoint field (EV-8). Activity and reasoning-label settings resolve per
 * field (`all[key] ?? endpoint[key]`). Titles, on a server that resolves them
 * as a block (`titleResolution: 'block'`), read the whole `all` block
 * whenever one exists (`endpoints.all ?? endpoints[x]`), so every
 * per-endpoint title setting is ignored, even one that `all` leaves unset;
 * on one that resolves them per field (`'field'`), only a title setting `all`
 * sets wins, and the title endpoint and model are one choice: both come from
 * `all` when it sets either, so the half `all` leaves unset points to the
 * half it sets.
 */
export function resolveShadowedBy(
  path: string,
  root: t.ConfigValue,
  editedValues: t.FlatConfigMap = {},
  titleResolution: t.ConfigRules['titleResolution'] = 'block',
): t.ShadowedBy | undefined {
  const segments = path.split('.');
  if (segments[0] !== 'endpoints') return undefined;
  const key = segments[segments.length - 1];
  const isProviderField =
    segments.length === 3 && segments[1] !== 'all' && segments[1] !== 'custom';
  const isCustomField =
    segments.length === 4 && segments[1] === 'custom' && INDEX_SEGMENT.test(segments[2]);
  if (!isProviderField && !isCustomField) return undefined;
  const isTitle = TITLE_KEYS.has(key);
  if (!isTitle && !FIELD_SHADOWED_KEYS.has(key)) return undefined;
  const all = getValueAtPath(root, 'endpoints.all');
  if (!isConfigRecord(all)) return undefined;
  const valueOf = (name: string): t.ConfigValue => {
    const allPath = `endpoints.all.${name}`;
    return allPath in editedValues ? editedValues[allPath] : all[name];
  };
  const allPath = `endpoints.all.${key}`;
  const value = valueOf(key);
  if (isTitle && titleResolution === 'block') return { path: allPath, value, precedence: 'block' };
  if (value !== undefined) return { path: allPath, value, precedence: 'field' };
  if (!isTitle || !TITLE_ROUTING_KEYS.includes(key)) return undefined;
  const other = TITLE_ROUTING_KEYS.find((name) => name !== key && valueOf(name) !== undefined);
  return other ? { path: `endpoints.all.${other}`, value, precedence: 'pair' } : undefined;
}

interface BaseReadout {
  /** The value Base users get. */
  effective: t.ConfigValue;
  source: t.ProvenanceSource;
  /** Set by librechat.yaml, a base override or a base tombstone. */
  isConfigured: boolean;
  isOverride: boolean;
  isHidden: boolean;
  /** What removing the base override leaves: librechat.yaml, a runtime default or the schema default. */
  lower: t.RevertTarget;
  stack: t.FieldLayer[];
}

/** An entry of a keyed list (`endpoints.custom`), which LibreChat merges by key across layers. */
interface KeyedLocation {
  arrayPath: string;
  keyField: string;
  key: t.ConfigValue;
  /** The path inside the entry ('' for the entry itself). */
  rest: string;
  /** LibreChat replaces the list whole (model specs) instead of merging it by key. */
  replaced: boolean;
}

/** Reads one path from every layer: by path, or by entry key inside keyed lists. */
interface PathReader {
  /** The path without array indices inside keyed lists, for schema lookups. */
  schemaPath: string;
  valueIn: (root: t.ConfigValue) => t.ConfigValue;
  /** Whether a layer sets the path (or something inside it). */
  sets: (root: t.ConfigValue, index: t.PathIndex) => boolean;
  /**
   * Whether a layer holds its own copy of a list LibreChat replaces whole
   * (model specs): the layers beneath it then don't reach the entry at all,
   * though their entry of the same name still serves as revert metadata.
   */
  replaces: (root: t.ConfigValue) => boolean;
  /** Whether the path is inside an entry of a keyed list (not the entry itself). */
  inEntry: boolean;
}

/**
 * Where `path` points inside a keyed list, identified by the entry's key in
 * the displayed tree (indices differ between layers; names do not). Lists
 * LibreChat replaces whole (model specs) are read the same way: the layer
 * beneath's value for a spec is that same spec's, not whichever sits at its index.
 */
function locateKeyed(path: string, displayRoot: t.ConfigValue): KeyedLocation | null {
  for (const { path: arrayPath, key: keyField, merge } of KEYED_COLLECTIONS.values()) {
    if (!path.startsWith(`${arrayPath}.`)) continue;
    const tail = path.slice(arrayPath.length + 1);
    const dot = tail.indexOf('.');
    const index = dot === -1 ? tail : tail.slice(0, dot);
    if (!INDEX_SEGMENT.test(index)) return null;
    const entry = getValueAtPath(displayRoot, `${arrayPath}.${index}`);
    if (!isConfigRecord(entry) || entry[keyField] == null) return null;
    return {
      arrayPath,
      keyField,
      key: entry[keyField],
      rest: dot === -1 ? '' : tail.slice(dot + 1),
      replaced: merge === 'replace',
    };
  }
  return null;
}

/** `models.apiKey` → `models.apiKeyPreview`: where the API puts a redacted secret's preview. */
function toSecretPreviewKeyPath(rest: string): string {
  const dot = rest.lastIndexOf('.');
  return `${rest.slice(0, dot + 1)}${toSecretPreviewKey(rest.slice(dot + 1))}`;
}

function keyedValue(root: t.ConfigValue, location: KeyedLocation): t.ConfigValue {
  const list = getValueAtPath(root, location.arrayPath);
  if (!Array.isArray(list)) return undefined;
  const entry = list.find(
    (item) => isConfigRecord(item) && item[location.keyField] === location.key,
  );
  return location.rest ? getValueAtPath(entry, location.rest) : entry;
}

function createReader(path: string, displayRoot: t.ConfigValue): PathReader {
  const location = locateKeyed(path, displayRoot);
  if (!location) {
    return {
      schemaPath: path,
      valueIn: (root) => getValueAtPath(root, path),
      /** A leaf above `path` sets it only when it holds a value there (a list does, `schedules: true` does not). */
      sets: (root, index) =>
        index.ancestors.has(path) ||
        index.paths.has(path) ||
        (pathIndexOverlaps(index, path) && getValueAtPath(root, path) !== undefined),
      replaces: () => false,
      inEntry: false,
    };
  }
  /** A redacted secret is returned as its preview companion (`apiKey` → `apiKeyPreview`). */
  const preview = location.rest
    ? { ...location, rest: toSecretPreviewKeyPath(location.rest) }
    : null;
  return {
    schemaPath: location.rest ? `${location.arrayPath}.${location.rest}` : location.arrayPath,
    valueIn: (root) => keyedValue(root, location),
    sets: (root) =>
      keyedValue(root, location) !== undefined ||
      (preview != null && keyedValue(root, preview) !== undefined),
    replaces: (root) =>
      location.replaced && Array.isArray(getValueAtPath(root, location.arrayPath)),
    inEntry: location.rest !== '',
  };
}

/**
 * `target`, what the layer beneath (`lower`) gives a path, as the edit
 * target's own values merge over it: inside an entry the target removes
 * values of by key (`ValueLayers.beneath`), without them, since removing
 * the target's own value there leaves its removals in place. The entry
 * itself keeps them: removing the override of a whole entry takes them back.
 */
function beneathTarget(
  target: t.RevertTarget,
  reader: PathReader,
  layers: t.ValueLayers,
  lower: t.ConfigValue,
): t.RevertTarget {
  if (!layers.beneath || !reader.inEntry) return target;
  const value = reader.valueIn(layers.beneath);
  return sameValue(value, reader.valueIn(lower)) ? target : { ...target, value };
}

/** What reaches users once a layer replaces the whole list: only the schema default. */
function replacedLower(path: string, layers: t.ValueLayers, reader: PathReader): t.RevertTarget {
  const value = layers.schemaDefaults[path] ?? layers.schemaDefaults[reader.schemaPath];
  return { value, source: 'default' };
}

/** The layers that still reach users once a layer replaces the whole list. */
function defaultsOnly(stack: t.FieldLayer[]): t.FieldLayer[] {
  return stack.filter((layer) => layer.source === 'default');
}

/** The layers under any override: schema default, what LibreChat fills in, librechat.yaml. */
function readLowerLayers(
  path: string,
  layers: t.ValueLayers,
  reader: PathReader,
  stack: t.FieldLayer[],
): { lower: t.RevertTarget; yamlSets: boolean } {
  const schemaDefault = layers.schemaDefaults[path] ?? layers.schemaDefaults[reader.schemaPath];
  const yamlValue = reader.valueIn(layers.yamlEffective);
  const yamlSets = reader.sets(layers.yamlEffective, layers.yamlPaths);
  const synthesized =
    !yamlSets && yamlValue !== undefined && !sameValue(yamlValue, schemaDefault)
      ? yamlValue
      : layers.runtimeDefaultAt?.(path);
  if (schemaDefault !== undefined) stack.push({ source: 'default', value: schemaDefault });
  if (synthesized !== undefined) stack.push({ source: 'runtimeDefault', value: synthesized });
  if (yamlSets) {
    stack.push({ source: 'yaml', value: yamlValue });
    return { lower: { value: yamlValue, source: 'yaml' }, yamlSets };
  }
  if (synthesized !== undefined) {
    return { lower: { value: synthesized, source: 'runtimeDefault' }, yamlSets };
  }
  return { lower: { value: schemaDefault, source: 'default' }, yamlSets };
}

/** The default that applies once a value is removed outright (tombstoned). */
function defaultAt(path: string, layers: t.ValueLayers): t.ConfigValue {
  return layers.runtimeDefaultAt?.(path) ?? layers.schemaDefaults[path];
}

/**
 * What Base users get at `path`, and from which layer. When the base
 * overrides replace the whole list (model specs), librechat.yaml's entry of
 * the same name doesn't reach users: it stays only as the revert target.
 */
function readBase(path: string, layers: t.ValueLayers, reader: PathReader): BaseReadout {
  const lowerStack: t.FieldLayer[] = [];
  const { lower, yamlSets } = readLowerLayers(path, layers, reader, lowerStack);
  const replaced = reader.replaces(layers.baseOverrides);
  const reaching = replaced ? replacedLower(path, layers, reader) : lower;
  const stack = replaced ? defaultsOnly(lowerStack) : lowerStack;
  const reachingYaml = yamlSets && !replaced;
  const isOverride = reader.sets(layers.baseOverrides, layers.baseOverridePaths);
  const isHidden = !isOverride && hasPathOrAncestor(layers.baseTombstones, path);
  const baseValue = reader.valueIn(layers.base);
  if (isOverride) stack.push({ source: 'admin', value: baseValue });
  if (isHidden) stack.push({ source: 'admin', value: undefined, hidden: true });
  const effective = baseValue ?? (isHidden ? defaultAt(path, layers) : reaching.value);
  let source: t.ProvenanceSource = reaching.source;
  if (isOverride || isHidden) {
    source = 'admin';
  } else if (!reachingYaml && baseValue !== undefined && reaching.source === 'default') {
    source = sameValue(baseValue, reaching.value) ? 'default' : 'runtimeDefault';
  }
  return {
    effective,
    source,
    isConfigured: reachingYaml || isOverride || isHidden,
    isOverride,
    isHidden,
    lower,
    stack,
  };
}

/** Whether a change is pending at `path`, and what the control shows for it. */
function readPending(
  path: string,
  editedValues: t.FlatConfigMap,
  revertValue: t.ConfigValue,
): { isEdited: boolean; isPendingReset: boolean; value: t.ConfigValue } {
  if (!(path in editedValues)) return { isEdited: false, isPendingReset: false, value: undefined };
  const edited = editedValues[path];
  if (edited === undefined) return { isEdited: true, isPendingReset: true, value: revertValue };
  return { isEdited: true, isPendingReset: false, value: edited };
}

function deriveBaseModeState(
  path: string,
  data: t.ConfigValuesData,
  layers: t.ValueLayers,
): t.FieldState {
  const reader = createReader(path, data.configValues ?? layers.effective);
  const base = readBase(path, layers, reader);
  const revertTarget =
    base.isOverride || base.isHidden
      ? beneathTarget(base.lower, reader, layers, layers.yamlEffective)
      : undefined;
  const revertValue = revertTarget ? revertTarget.value : base.effective;
  const pending = readPending(path, data.editedValues, revertValue);
  /** D5: LibreChat reads this section only from librechat.yaml, so a stored override has no effect. */
  if (base.isOverride && getReadOnlyReason(path, data.writeRules) === 'yamlOnly') {
    return {
      value: pending.isEdited ? pending.value : base.lower.value,
      effective: base.lower.value,
      source: base.lower.source,
      revertTarget: base.lower,
      isConfigured: base.isConfigured,
      isOverride: true,
      isEdited: pending.isEdited,
      isPendingReset: pending.isPendingReset,
      isHidden: false,
      ignoredOverride: true,
      stack: base.stack,
    };
  }
  const shown = getValueAtPath(data.configValues, path);
  const shadowedBy = resolveShadowedBy(
    path,
    data.configValues ?? layers.effective,
    data.editedValues,
    data.titleResolution,
  );
  return {
    value: pending.isEdited ? pending.value : (shown ?? base.effective),
    effective: base.effective,
    source: base.source,
    ...(revertTarget && { revertTarget }),
    isConfigured: base.isConfigured || (data.configuredPaths?.has(path) ?? false),
    isOverride: base.isOverride,
    isEdited: pending.isEdited,
    isPendingReset: pending.isPendingReset,
    isHidden: base.isHidden,
    ...(shadowedBy && { shadowedBy }),
    stack: base.stack,
  };
}

function deriveScopeModeState(
  path: string,
  data: t.ConfigValuesData,
  layers: t.ValueLayers,
  scope: t.ScopeLayer,
): t.FieldState {
  const reader = createReader(path, data.configValues ?? layers.effective);
  const base = readBase(path, layers, reader);
  const inherited = beneathTarget(
    { value: base.effective, source: base.source },
    reader,
    layers,
    layers.base,
  );
  const isOverride = reader.sets(scope.overrides, scope.overridePaths);
  const visibility = data.visibilityEdits?.[path];
  const isHidden = visibility
    ? visibility === 'hide'
    : !isOverride && hasPathOrAncestor(scope.tombstones, path);
  /** A profile's own copy of a list replaced whole (model specs): Base's entry doesn't reach its users. */
  const replaced = reader.replaces(scope.overrides);
  const reaching = replaced ? replacedLower(path, layers, reader) : inherited;
  const merged = reader.valueIn(layers.effective);
  const effective = merged ?? (isHidden ? defaultAt(path, layers) : reaching.value);
  const stack = replaced ? defaultsOnly(base.stack) : [...base.stack];
  if (isOverride) stack.push({ source: 'scope', value: merged });
  if (isHidden) stack.push({ source: 'scope', value: undefined, hidden: true });
  const ownsValue = isOverride || isHidden;
  const unownedSource: t.ProvenanceSource = replaced ? 'default' : 'inherited';
  const revertTarget: t.RevertTarget | undefined = ownsValue
    ? { value: inherited.value, source: 'inherited' }
    : undefined;
  const pending = readPending(path, data.editedValues, ownsValue ? inherited.value : effective);
  const shown = getValueAtPath(data.configValues, path);
  const shadowedBy = resolveShadowedBy(
    path,
    data.configValues ?? layers.effective,
    data.editedValues,
    data.titleResolution,
  );
  return {
    value: pending.isEdited ? pending.value : (shown ?? effective),
    effective,
    source: ownsValue ? 'scope' : unownedSource,
    ...(revertTarget && { revertTarget }),
    isConfigured: ownsValue,
    isOverride,
    isEdited: pending.isEdited || visibility != null,
    isPendingReset: pending.isPendingReset,
    isHidden,
    ...(visibility && { visibilityEdit: visibility }),
    ...(shadowedBy && { shadowedBy }),
    inherited,
    stack,
  };
}

/** Provenance from the path sets alone, for callers without the layer model. */
function resolveLegacyProvenance(
  data: t.ConfigValuesData,
  isOverride: boolean,
  isConfigured: boolean,
): t.ProvenanceSource {
  if (isOverride) return data.isEditingScope ? 'scope' : 'admin';
  if (data.isEditingScope) return 'inherited';
  return isConfigured ? 'yaml' : 'default';
}

function deriveLegacyState(path: string, data: t.ConfigValuesData): t.FieldState {
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
    source: resolveLegacyProvenance(data, isOverride, isConfigured),
    isConfigured,
    isOverride,
    isEdited: path in data.editedValues,
    isPendingReset: data.pendingResets?.has(path) ?? false,
    isHidden: false,
  };
}

/**
 * `FieldState` for a path from the page's value layers (EV-1, EV-4, EV-5).
 *
 * Base mode: the effective value is librechat.yaml plus the base overrides.
 * Its source is the highest layer that sets it (admin override,
 * librechat.yaml, a value LibreChat fills in at startup, or the schema
 * default), and a base override reverts to the next layer down
 * (`yamlEffective`, else the default).
 *
 * Profile mode: the profile's own override (or tombstone) wins, otherwise the
 * field inherits Base. An override reverts to the inherited Base value.
 *
 * `value` is what the control shows: the pending edit (a pending reset shows
 * its revert target), else the displayed tree, else the effective value.
 */
export function deriveFieldState(path: string, data: t.ConfigValuesData | null): t.FieldState {
  if (!data) return NO_VALUES_STATE;
  const layers = data.layers;
  if (!layers) return deriveLegacyState(path, data);
  if (layers.scope) return deriveScopeModeState(path, data, layers, layers.scope);
  return deriveBaseModeState(path, data, layers);
}

/**
 * Value for `getValue(path, fallback)` callers: the field state's value, else
 * the caller's fallback (e.g. an empty record for a collection renderer). A
 * pending reset always shows its revert target, even when that is unset.
 */
export function deriveFieldValue(
  path: string,
  fallback: t.ConfigValue,
  data: t.ConfigValuesData | null,
): t.ConfigValue {
  const state = deriveFieldState(path, data);
  return state.isPendingReset || state.ignoredOverride ? state.value : (state.value ?? fallback);
}

/**
 * What `path` falls back to without the edit target's own override, and from
 * which layer (EV-4): in base mode librechat.yaml, else what LibreChat fills
 * in, else the schema default; in a profile what Base gives. Keyed list
 * entries (`endpoints.custom.3`) are found by name in the effective tree.
 * Undefined when nothing beneath sets a value. The change review reads it.
 */
export function revertTargetAt(path: string, layers: t.ValueLayers): t.RevertTarget | undefined {
  const reader = createReader(path, layers.effective);
  const target: t.RevertTarget = layers.scope
    ? beneathTarget(
        { value: readBase(path, layers, reader).effective, source: 'inherited' },
        reader,
        layers,
        layers.base,
      )
    : beneathTarget(
        readLowerLayers(path, layers, reader, []).lower,
        reader,
        layers,
        layers.yamlEffective,
      );
  return target.value === undefined ? undefined : target;
}
