import {
  configSchema,
  isProcessMCPServerField,
  isProcessMCPServerConfig,
} from 'librechat-data-provider';
import type * as t from '@/types';
import {
  getEntryKey,
  diffOverride,
  entriesByKey,
  entryLocation,
  hasHiddenSecret,
  mergeConfigLayers,
  getKeyedCollection,
  resolveCollectionOps,
  findKeyedCollectionEntry,
} from './collections';
import {
  credentialKey,
  withCarriedSecrets,
  findUncopiedSecrets,
  restatableCredential,
  findRebindingWarnings,
  findDroppedEndpointKey,
  findDroppedCredentials,
  findSecretReentryIssues,
} from './binding';
import {
  hasDottedKey,
  asConfigRecord,
  isConfigRecord,
  getValueAtPath,
  setValueAtPath,
  removeValueAtPath,
  isConfigValueEqual,
} from './format';
import {
  getConfigSection,
  getReadOnlyReason,
  AZURE_GROUPS_PATH,
  SECRET_PREVIEW_MASK,
  TOO_MANY_CHANGES_CODE,
  BUNDLED_WRITE_RULES,
  BUNDLED_CONFIG_LIMITS,
  BUNDLED_CONFIG_FEATURES,
} from '@/constants';
import {
  validateEntry,
  modelsByGroup,
  validateField,
  validateSection,
  describeIssueCode,
  isUnknownEnumValue,
  validateResolvableGroup,
  validateLoadableEndpoint,
} from './validation';
import {
  isSecretPath,
  holdsSecretAt,
  isStoredSecretKey,
  secretPreviewPath,
  isSecretPreviewKey,
  valueOrSecretPreview,
  secretKeyForPreviewKey,
} from './secrets';
import {
  isKeyedPath,
  isKeyedEntry,
  parseKeyedPath,
  formatKeyedPath,
  entryIdentityOf,
  isPathAtOrUnder,
  isKeyedAtOrUnder,
  getKeyedValue,
  getConfigPathValue,
  isAddressableEntryKey,
  removeConfigPathValue,
} from './keyed';
import { findYamlManagedValues, getWriteSkipReason } from './writes';
import { schemaType, resolveSubSchema, unwrapSchema } from './schema';
import { isBlankText, findBlankText, findUnsafeKeys } from './keys';
import { getSecretCarry, usesChangeBatch } from './contract';
import { selectsHiddenEndpoint } from './dependents';
import { scopeGateSkipReason } from './scopes';

/** Whether a write at `path` sets a process-backed (stdio) MCP server field, which the admin API rejects. */
export function isProcessMcpWrite(path: string, value: t.ConfigValue): boolean {
  const [section, serverName, field] = path.split('.');
  if (section !== 'mcpServers') return false;
  if (serverName == null) {
    return isConfigRecord(value) && Object.values(value).some(isProcessMCPServerConfig);
  }
  if (field == null) return isProcessMCPServerConfig(value);
  return isProcessMCPServerField(field) || (field === 'type' && value === 'stdio');
}

/**
 * Write-rule problems of one value: YAML-managed fields, process-backed MCP
 * fields and keys the server can't store (dotted keys only before its
 * `dottedKeys` feature). In a keyed collection's list, each problem names
 * its entry, since the list's positions are not the ones the page shows.
 */
export function findWriteRuleIssues(
  path: string,
  value: t.ConfigValue,
  features: t.ConfigFeatures = BUNDLED_CONFIG_FEATURES,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
): t.ConfigIssue[] {
  const issues = findValueRuleIssues(path, value, features, rules);
  const collection = getKeyedCollection(path);
  if (!collection || !Array.isArray(value) || issues.length === 0) return issues;
  return issues.map((issue) => withEntryOf(issue, collection, value));
}

function withEntryOf(
  issue: t.ConfigIssue,
  collection: t.KeyedCollection,
  entries: t.ConfigValue[],
): t.ConfigIssue {
  const located = findKeyedCollectionEntry(issue.path);
  if (!located || located.collection.path !== collection.path) return issue;
  const identity = getEntryKey(entries[located.index], collection.key);
  if (identity === undefined) return issue;
  return { ...issue, entryIdentity: identity, entryPath: located.rest };
}

function findValueRuleIssues(
  path: string,
  value: t.ConfigValue,
  features: t.ConfigFeatures,
  rules: t.ConfigWriteRules,
): t.ConfigIssue[] {
  const managed = findYamlManagedValues(path, value, rules);
  if (managed.length > 0) {
    return managed.map((managedPath) => ({
      path: managedPath,
      code: 'YAML_MANAGED',
      message: describeIssueCode('YAML_MANAGED', undefined, ''),
    }));
  }
  if (isProcessMcpWrite(path, value)) {
    return [
      {
        path,
        code: 'PROCESS_MCP_FIELD',
        message: describeIssueCode('PROCESS_MCP_FIELD', undefined, ''),
      },
    ];
  }
  const blank = [...blankPathKeys(path), ...findBlankText(value, path)].map(blankTextIssue);
  const code = features.dottedKeys ? 'RESERVED_KEY' : 'UNSAFE_KEY';
  const unsafe = findUnsafeKeys(value, path, features.dottedKeys).map(({ path: holder, key }) => ({
    path: holder,
    code,
    message: describeIssueCode(code, { key }, ''),
    params: { key },
  }));
  return [...unsafe, ...blank];
}

const BLANK_TEXT_CODES: ReadonlySet<string> = new Set(['BLANK_VALUE', 'BLANK_KEY']);

/** The model spec list, whose specs LibreChat checks select a configured endpoint where a save writes it. */
const SPEC_LIST = 'modelSpecs.list';

/** The custom endpoints, which a profile can hide by name (`keyedTombstones`). */
const CUSTOM_ENDPOINTS = 'endpoints.custom';

/** A spec that selects a custom endpoint the target hides, which LibreChat refuses as unconfigured. */
const SPEC_ENDPOINT_HIDDEN = 'spec_endpoint_hidden';

/** A blank key named by the write path itself (an imported `headers: { "  ": … }` leaf). */
function blankPathKeys(path: string): t.BlankConfigText[] {
  const segments = path.split('.');
  const at = segments.findIndex((segment) => isBlankText(segment));
  if (at <= 0) return [];
  return [{ path: segments.slice(0, at).join('.'), key: segments[at] }];
}

/** A whitespace-only string or key as a pre-flight issue: never stored as a value (no blank writes). */
function blankTextIssue({ path, key }: t.BlankConfigText): t.ConfigIssue {
  if (key === undefined) {
    return { path, code: 'BLANK_VALUE', message: describeIssueCode('BLANK_VALUE', undefined, '') };
  }
  return {
    path,
    code: 'BLANK_KEY',
    message: describeIssueCode('BLANK_KEY', undefined, ''),
    params: { key },
  };
}

interface PlanState {
  snapshot: t.WriteSnapshot;
  features: t.ConfigFeatures;
  rules: t.ConfigWriteRules;
  /** The longest entry name a keyed path may hold (`limits.maxEntryKeyLength`). */
  maxEntryKeyLength: number;
  sets: Map<string, t.ConfigValue>;
  resets: string[];
  tombstones: string[];
  untombstones: string[];
  entryOps: Map<string, t.EntryChange[]>;
  carries: t.CarryChange[];
  restates: t.RestateChange[];
  renames: t.EntryRename[];
  renameHints: t.RenameHint[];
  skipped: t.SkippedChange[];
  issues: t.ConfigIssue[];
  warnings: t.ConfigWarning[];
  effective: number;
  /** Entry identities each collection's ops touch (validated as whole entries). */
  touchedEntries: Map<string, Set<string>>;
  /** Resets of entries by key a collection's changes resolve to, counted with those changes. */
  entryResets: Set<string>;
  /** Removals by key inside entries those resets remove, written again after them (`removalsKeptThrough`). */
  keptRemovals: string[];
}

function addEntryOp(state: PlanState, op: t.EntryChange): void {
  const list = state.entryOps.get(op.path) ?? [];
  list.push(op);
  state.entryOps.set(op.path, list);
  const touched = state.touchedEntries.get(op.path) ?? new Set<string>();
  touched.add(op.key);
  if (op.identity) touched.add(op.identity);
  state.touchedEntries.set(op.path, touched);
}

/** A whole-array `set` of a `byKey` collection becomes one upsert per entry (merge, not replace). */
function expandCollectionSet(
  state: PlanState,
  collection: t.KeyedCollection,
  value: t.ConfigValue[],
): void {
  const existing = mergeConfigLayers(
    getValueAtPath(state.snapshot.lower, collection.path),
    getValueAtPath(state.snapshot.stored, collection.path),
    collection.path,
  );
  const existingKeys = new Set(
    (Array.isArray(existing) ? existing : []).map((entry) => getEntryKey(entry, collection.key)),
  );
  for (const entry of value) {
    const key = getEntryKey(entry, collection.key);
    if (key === undefined) {
      state.issues.push({
        path: collection.path,
        code: 'missing_merge_key',
        message: `${collection.path}: every entry needs a ${collection.key}`,
      });
      continue;
    }
    addEntryOp(state, {
      op: 'upsertEntry',
      path: collection.path,
      key,
      identity: existingKeys.has(key) ? key : null,
      value: entry,
    });
  }
}

/** A `set` of one indexed entry (`endpoints.custom.3`) from callers without identity tracking: upsert by the entry's own key. */
function expandIndexedEntrySet(state: PlanState, path: string, value: t.ConfigValue): boolean {
  const located = findKeyedCollectionEntry(path);
  if (!located) return false;
  const { collection, rest } = located;
  const key = getEntryKey(value, collection.key);
  if (rest !== '' || key === undefined) {
    state.issues.push({
      path,
      code: 'indexed_merge_key_write',
      message: `${path}: ${collection.path} entries are saved whole, by ${collection.key}`,
    });
    return true;
  }
  const existing = mergeConfigLayers(
    getValueAtPath(state.snapshot.lower, collection.path),
    getValueAtPath(state.snapshot.stored, collection.path),
    collection.path,
  );
  const exists =
    Array.isArray(existing) && existing.some((entry) => getEntryKey(entry, collection.key) === key);
  addEntryOp(state, {
    op: 'upsertEntry',
    path: collection.path,
    key,
    identity: exists ? key : null,
    value,
  });
  return true;
}

const INDEXED_PATH_RE = /^(.+)\.(\d+)$/;

/** `{ arrayPath, index }` when `fieldPath` addresses an item of an array setting (`x.list.2`). */
export function parseIndexedArrayPath(
  fieldPath: string,
): { arrayPath: string; index: number } | null {
  const match = INDEXED_PATH_RE.exec(fieldPath);
  if (!match) return null;
  const [, arrayPath, indexStr] = match;
  const schema = resolveSubSchema(configSchema as t.ZodSchemaLike, arrayPath.split('.'));
  if (!schema || schemaType(unwrapSchema(schema)) !== 'array') return null;
  return { arrayPath, index: Number(indexStr) };
}

/**
 * A `set` of one item of a plain array setting becomes a `set` of the whole
 * array (the target's own array, else the one it inherits, with the item
 * replaced): a PATCH of `list.2` alone would store an object with key `2`.
 */
function expandIndexedArraySet(state: PlanState, path: string, value: t.ConfigValue): boolean {
  const parsed = parseIndexedArrayPath(path);
  if (!parsed) return false;
  const { arrayPath, index } = parsed;
  const pending = state.sets.get(arrayPath);
  const source =
    pending ??
    getValueAtPath(state.snapshot.stored, arrayPath) ??
    getValueAtPath(state.snapshot.lower, arrayPath);
  const next = Array.isArray(source) ? [...source] : [];
  next[index] = value;
  if (pending === undefined) state.effective++;
  state.sets.set(arrayPath, next);
  return true;
}

/**
 * Sorts the ops into the plan. A hide removes what the target stores at and
 * under its path, so a set there in the same batch is not written: the hide
 * wins, whatever order the two are written in, and the set is reported as
 * not sent (`hiddenBySave`).
 */
function collectOps(state: PlanState, ops: t.ConfigChange[]): void {
  const isProfile = state.snapshot.lowerKind === 'inherited';
  const sets: Array<[string, t.ConfigValue]> = [];
  for (const op of ops) {
    const isRemoval = op.op === 'reset' || op.op === 'untombstone' || op.op === 'removeEntry';
    const reason =
      getWriteSkipReason(op.path, isRemoval, state.rules) ??
      (isProfile && !isRemoval ? scopeGateSkipReason(op.path, state.rules) : undefined);
    if (reason) {
      state.skipped.push({ fieldPath: op.path, reason });
      continue;
    }
    if (op.op === 'set') sets.push([op.path, op.value]);
    else if (op.op === 'carry') state.carries.push(op);
    else if (op.op === 'restate') state.restates.push(op);
    else if (op.op === 'upsertEntry' || op.op === 'removeEntry') addEntryOp(state, op);
    else if (op.op === 'reset') state.resets.push(op.path);
    else if (op.op === 'tombstone') state.tombstones.push(op.path);
    else state.untombstones.push(op.path);
  }
  for (const [path, value] of sets) {
    if (state.tombstones.some((hidden) => isAtOrUnder(path, hidden))) {
      state.skipped.push({ fieldPath: path, reason: 'hiddenBySave' });
      continue;
    }
    collectSet(state, path, value);
  }
}

function collectSet(state: PlanState, path: string, value: t.ConfigValue): void {
  const collection = getKeyedCollection(path);
  if (collection?.merge === 'byKey' && Array.isArray(value)) {
    expandCollectionSet(state, collection, value);
    return;
  }
  if (expandIndexedEntrySet(state, path, value) || expandIndexedArraySet(state, path, value)) {
    return;
  }
  state.sets.set(path, value);
  state.effective++;
}

function resolveCollections(state: PlanState): void {
  for (const [path, list] of state.entryOps) {
    const collection = getKeyedCollection(path);
    if (!collection) {
      state.issues.push({
        path,
        code: 'NOT_A_COLLECTION',
        message: `${path} is not a keyed collection`,
      });
      continue;
    }
    const resolution = resolveCollectionOps({
      collection,
      stored: getValueAtPath(state.snapshot.stored, path),
      lower: getValueAtPath(state.snapshot.lower, path),
      lowerKind: state.snapshot.lowerKind,
      ops: list,
      carriesSecrets: carriesEntrySecrets(state, collection),
    });
    state.issues.push(...resolution.issues);
    if (usesChangeBatch(state.features)) state.renames.push(...resolution.renames);
    else state.renameHints.push(...resolution.renames.map(toRenameHint));
    state.warnings.push(...resolution.warnings);
    state.effective += resolution.effective;
    const next = keepRestatedKeys(state, collection, resolution.next, list);
    const restated = !isConfigValueEqual(next, resolution.next);
    if (restated && !resolution.changed) state.effective++;
    const reverted = keyedResetsOfReverts(state, collection, list);
    if (!resolution.changed && !restated) {
      addEntryResets(state, reverted);
      if (reverted.length > 0) state.effective++;
      continue;
    }
    if (usesKeyedResets(state, collection)) {
      writeByKey(state, collection, next, resolution.renames, reverted);
      continue;
    }
    if (next !== undefined) state.sets.set(path, next);
    else state.resets.push(path);
  }
}

/**
 * Whether a rename keeps the secret the entry stores: a batch `rename` moves
 * the stored entry whole; a field PATCH's `renames` hint carries a custom
 * endpoint's key (`renameHints`), but no hint names a gated list
 * (Azure groups), so a renamed group needs its key again there.
 */
function carriesEntrySecrets(state: PlanState, collection: t.KeyedCollection): boolean {
  if (collection.gate !== undefined) return usesChangeBatch(state.features);
  return getSecretCarry(state.features).endpointRename;
}

/** A carried rename as the `renames` hint of the field PATCH that writes the renamed entry. */
function toRenameHint({ path, from, to }: t.EntryRename): t.RenameHint {
  return { path, previousName: from, name: to };
}

/**
 * Whether a collection's own entries are reset by key (`keyedTombstones`),
 * never by rewriting or resetting the list. A list merged by key behind a
 * gate (Azure groups) has no keyed paths, so its list is written whole.
 */
function usesKeyedResets(state: PlanState, collection: t.KeyedCollection): boolean {
  return (
    state.features.keyedTombstones && collection.merge === 'byKey' && collection.gate === undefined
  );
}

/** An entry's identity as LibreChat matches it, or undefined for an entry without a key. */
function identityIn(collection: t.KeyedCollection, entry: t.ConfigValue): string | undefined {
  const name = getEntryKey(entry, collection.key);
  return name === undefined ? undefined : entryIdentityOf(collection, name);
}

/** The entries of a collection that keyed tombstones in `paths` hide whole, by identity. */
function hiddenIdentities(paths: readonly string[], collection: t.KeyedCollection): Set<string> {
  const identities = new Set<string>();
  for (const path of paths) {
    const keyed = parseKeyedPath(path);
    if (keyed && !keyed.rest && keyed.collection.path === collection.path) {
      identities.add(entryIdentityOf(collection, keyed.key));
    }
  }
  return identities;
}

/**
 * The entries of a collection the target hides whole once the save is
 * applied, each with why a change of it is not sent: hidden by the same
 * save (`hiddenBySave`), or hidden already and not unhidden by it
 * (`hiddenEntry`).
 */
function hiddenAfterSave(
  state: PlanState,
  collection: t.KeyedCollection,
): Map<string, t.SkipReason> {
  const shown = hiddenIdentities(state.untombstones, collection);
  const hidden = new Map<string, t.SkipReason>();
  for (const identity of hiddenIdentities(state.snapshot.tombstones, collection)) {
    if (!shown.has(identity)) hidden.set(identity, 'hiddenEntry');
  }
  for (const identity of hiddenIdentities(state.tombstones, collection)) {
    hidden.set(identity, 'hiddenBySave');
  }
  return hidden;
}

/**
 * Entry changes of entries the target hides whole once the save is applied
 * (`keyedTombstones`): LibreChat takes a write of a hidden entry as showing
 * it again (and a hide removes what the target stores for it), so they are
 * not sent; Unhide shows one again.
 */
function dropHiddenEntryOps(state: PlanState): void {
  if (!state.features.keyedTombstones) return;
  for (const [path, list] of state.entryOps) {
    const collection = getKeyedCollection(path);
    if (!collection) continue;
    const hidden = hiddenAfterSave(state, collection);
    if (hidden.size === 0) continue;
    const kept = list.filter((op) => {
      const name = op.identity ?? op.key;
      const reason = hidden.get(entryIdentityOf(collection, name));
      if (!reason) return true;
      state.skipped.push({ fieldPath: entryLocation(path, name), reason });
      return false;
    });
    state.entryOps.set(path, kept);
  }
}

/** The keyed tombstones the target stores inside entry `identity` of a collection (`…["Name"].headers.X`). */
function removalsInside(
  state: PlanState,
  collection: t.KeyedCollection,
  identity: string,
): string[] {
  return state.snapshot.tombstones.filter((path) => {
    const keyed = parseKeyedPath(path);
    return (
      keyed !== null &&
      keyed.rest !== '' &&
      keyed.collection.path === collection.path &&
      entryIdentityOf(collection, keyed.key) === identity
    );
  });
}

/**
 * The removals by key inside the inherited entries a save writes that its
 * edits take back, each reset by its own path: every removal inside an
 * entry set back to the layer beneath whole ("Remove overrides"), and each
 * one whose value the entry holds again as the layer beneath sets it (a key
 * added back as it was), so its users get what the edit shows. A write
 * can't take one back: LibreChat keeps a removal under a write of its
 * entry, and the write leaves out a value equal to the layer beneath's. A
 * reset of the whole entry would also remove a key the target stores for
 * it. A removal the save writes again (a pending removal) stays.
 */
function keyedResetsOfReverts(
  state: PlanState,
  collection: t.KeyedCollection,
  ops: readonly t.EntryChange[],
): string[] {
  if (!usesKeyedResets(state, collection)) return [];
  const rewritten = state.tombstones.flatMap((path) => parseKeyedPath(path) ?? []);
  return ops.flatMap((op) => {
    if (op.op !== 'upsertEntry' || op.identity === null || op.key !== op.identity) return [];
    const identity = entryIdentityOf(collection, op.identity);
    const inside = removalsInside(state, collection, identity).filter(
      (removal) => !rewritten.some((keyed) => isKeyedAtOrUnder(removal, keyed)),
    );
    if (inside.length === 0) return [];
    const lowerEntry = withoutEntryPreview(collection, lowerEntryOf(state, collection, identity));
    const value = withoutEntryPreview(collection, op.value);
    if (isConfigValueEqual(value, lowerEntry)) return inside;
    return inside.filter((removal) => holdsLowerValue(removal, value, lowerEntry));
  });
}

/** Whether `entry` holds the value of the layer beneath's entry at the path removal `path` removes inside it. */
function holdsLowerValue(path: string, entry: t.ConfigValue, lowerEntry: t.ConfigValue): boolean {
  const rest = parseKeyedPath(path)?.rest ?? '';
  const held = getValueAtPath(entry, rest);
  return held !== undefined && isConfigValueEqual(held, getValueAtPath(lowerEntry, rest));
}

/** The entry `identity` of a collection in the layer beneath the target, if it defines one. */
function lowerEntryOf(
  state: PlanState,
  collection: t.KeyedCollection,
  identity: string,
): t.ConfigValue {
  const lower = getValueAtPath(state.snapshot.lower, collection.path);
  return (Array.isArray(lower) ? lower : []).find(
    (entry) => identityIn(collection, entry) === identity,
  );
}

/**
 * The removals by key the target stores inside an inherited entry whose own
 * entry the save resets by key (its last own setting cleared): that reset
 * also removes every keyed tombstone of the entry, so those the save does not
 * take back itself ("Remove overrides", Restore) are written again after it.
 */
function removalsKeptThrough(
  state: PlanState,
  collection: t.KeyedCollection,
  identity: string,
  reverted: readonly string[],
): string[] {
  if (lowerEntryOf(state, collection, identity) === undefined) return [];
  const takenBack = [...reverted, ...state.untombstones].flatMap(
    (path) => parseKeyedPath(path) ?? [],
  );
  return removalsInside(state, collection, identity).filter(
    (removal) => !takenBack.some((keyed) => isKeyedAtOrUnder(removal, keyed)),
  );
}

function addEntryResets(state: PlanState, paths: readonly string[]): void {
  for (const path of paths) {
    if (state.resets.includes(path)) continue;
    state.resets.push(path);
    state.entryResets.add(path);
  }
}

/**
 * A collection's resolved override, written by key (`keyedTombstones`): an
 * own entry the save drops (a reverted override, a deleted entry) is reset
 * by its key, which also removes the target's keyed tombstones inside it, so
 * the removals of an inherited entry the save keeps are written again after
 * it; the list is written only for what else changes, and never reset whole,
 * which would also remove every keyed tombstone under it (another entry's
 * hide among them). An entry the save hides is left out of the list (its
 * hide removes it, and a write of it would show it again), and so is one an
 * unhide resets by key already.
 */
function writeByKey(
  state: PlanState,
  collection: t.KeyedCollection,
  next: t.ConfigValue[] | undefined,
  renames: readonly t.EntryRename[],
  reverted: readonly string[],
): void {
  const { path } = collection;
  const hidden = hiddenIdentities(state.tombstones, collection);
  const shown = hiddenIdentities(state.untombstones, collection);
  const renamedFrom = new Set(renames.map(({ from }) => entryIdentityOf(collection, from)));
  const written = withoutKeyedRemovals(
    state,
    collection,
    (next ?? []).filter((entry) => !hidden.has(identityIn(collection, entry) ?? '')),
  );
  const writtenIds = new Set(written.map((entry) => identityIn(collection, entry)));
  const stored = getValueAtPath(state.snapshot.stored, path);
  const own = withoutKeyedRemovals(
    state,
    collection,
    (Array.isArray(stored) ? stored : []).map((entry) => withoutEntryPreview(collection, entry)),
  );
  refuseUnaddressableEntries(state, collection, written, own);
  const kept: t.ConfigValue[] = [];
  const resets: string[] = [...reverted];
  for (const entry of own) {
    const identity = identityIn(collection, entry);
    const name = getEntryKey(entry, collection.key);
    const goes =
      identity !== undefined &&
      name !== undefined &&
      !writtenIds.has(identity) &&
      !renamedFrom.has(identity) &&
      isAddressableEntryKey(name, state.maxEntryKeyLength);
    if (!goes) {
      if (!hidden.has(identity ?? '')) kept.push(entry);
      continue;
    }
    if (hidden.has(identity) || shown.has(identity)) continue;
    resets.push(formatKeyedPath(path, name));
    state.keptRemovals.push(...removalsKeptThrough(state, collection, identity, reverted));
  }
  addEntryResets(state, resets);
  if (isConfigValueEqual(written, kept)) return;
  state.sets.set(path, written);
}

/** An entry a save adds by a name LibreChat can't address by key, so it could not be removed later. */
const ENTRY_KEY_UNADDRESSABLE = 'entry_key_unaddressable';

/**
 * Refuses the entries a by-key save adds to the target (`written`, not already stored by it in
 * `own`) under a name a keyed path can't hold (`isAddressableEntryKey`): LibreChat removes and
 * hides entries of such a list only by key, so one stored under that name could never be removed
 * or reverted again. That includes a first override of an entry defined beneath the target under
 * such a name. An entry the target already stores under such a name stays as it is.
 */
function refuseUnaddressableEntries(
  state: PlanState,
  collection: t.KeyedCollection,
  written: readonly t.ConfigValue[],
  own: readonly t.ConfigValue[],
): void {
  const known = new Set(own.map((entry) => identityIn(collection, entry)));
  for (const entry of written) {
    const name = getEntryKey(entry, collection.key);
    if (name === undefined || known.has(identityIn(collection, entry))) continue;
    if (isAddressableEntryKey(name, state.maxEntryKeyLength)) continue;
    const params = { name, max: state.maxEntryKeyLength };
    state.issues.push({
      path: collection.path,
      code: ENTRY_KEY_UNADDRESSABLE,
      params,
      message: describeIssueCode(ENTRY_KEY_UNADDRESSABLE, params, ENTRY_KEY_UNADDRESSABLE),
      entryIdentity: name,
      entryPath: collection.key,
    });
  }
}

/**
 * `entries` without the values the save removes inside them by key
 * (`endpoints.custom["Name"].headers.X-Team`): LibreChat removes the
 * target's own value there with the tombstone, and a list written with it
 * would set it again. An entry left with only its key goes.
 */
function withoutKeyedRemovals(
  state: PlanState,
  collection: t.KeyedCollection,
  entries: t.ConfigValue[],
): t.ConfigValue[] {
  let root: t.ConfigRecord = setValueAtPath({}, collection.path, entries);
  for (const tombstone of state.tombstones) {
    const keyed = parseKeyedPath(tombstone);
    if (keyed?.rest && keyed.collection.path === collection.path) {
      root = removeConfigPathValue(root, tombstone, true);
    }
  }
  const result = getValueAtPath(root, collection.path);
  return Array.isArray(result) ? result : [];
}

function withoutEntryPreview(collection: t.KeyedCollection, entry: t.ConfigValue): t.ConfigValue {
  const preview = collection.secret?.preview;
  if (!preview || !isConfigRecord(entry) || !(preview in entry)) return entry;
  const { [preview]: _omit, ...rest } = entry;
  return rest;
}

/**
 * The credentials of `path` a save restates (`restate`) that LibreChat binds
 * to a destination, each with the value the layer beneath holds; none before
 * `secretRebinding`.
 */
function restatedCredentials(state: PlanState, path: string): t.RestatedCredential[] {
  if (!state.features.secretRebinding) return [];
  return state.restates.flatMap((ref) => {
    if (ref.path !== path) return [];
    const value = restatableCredential(state.snapshot.lower, ref);
    return value === undefined ? [] : [{ ref, value }];
  });
}

/**
 * Collections a save restates a credential in are resolved even when it
 * changes none of their entries, validating the restated entries.
 */
function addRestatedEntries(state: PlanState): void {
  for (const ref of state.restates) {
    if (!getKeyedCollection(ref.path)) continue;
    if (!state.entryOps.has(ref.path)) state.entryOps.set(ref.path, []);
    const touched = state.touchedEntries.get(ref.path) ?? new Set<string>();
    touched.add(ref.entry);
    state.touchedEntries.set(ref.path, touched);
  }
}

/** Whether the save's changes of entry `identity` leave its `key` as it was. */
function leavesKey(ops: readonly t.EntryChange[], identity: string, key: string): boolean {
  return ops.every((op) => {
    if (op.op !== 'upsertEntry' || op.identity !== identity) return true;
    if (op.baseline === undefined) return !(key in asConfigRecord(op.value));
    return isConfigValueEqual(asConfigRecord(op.baseline)[key], asConfigRecord(op.value)[key]);
  });
}

/**
 * The key of an inherited entry its override restates, where the override
 * moves where the entry sends it (`secretRebinding`): the one the save
 * restates (`restate`), or the one the target's override already holds as
 * a readable value and the save's changes of the entry leave alone. An
 * override otherwise stores only what differs from the layer beneath, so it
 * would leave the key out, and LibreChat would drop it.
 */
function keepRestatedKeys(
  state: PlanState,
  collection: t.KeyedCollection,
  next: t.ConfigValue[] | undefined,
  ops: readonly t.EntryChange[],
): t.ConfigValue[] | undefined {
  const secretKey = collection.secret?.key;
  if (!secretKey || !next || !state.features.secretRebinding) return next;
  const restated = new Map(
    restatedCredentials(state, collection.path)
      .filter(({ ref }) => ref.secret === secretKey)
      .map(({ ref, value }) => [ref.entry, value]),
  );
  const lower = entriesByKey(getValueAtPath(state.snapshot.lower, collection.path), collection.key);
  const stored = entriesByKey(
    getValueAtPath(state.snapshot.stored, collection.path),
    collection.key,
  );
  return next.map((entry) => {
    const identity = getEntryKey(entry, collection.key);
    if (identity === undefined || asConfigRecord(entry)[secretKey] !== undefined) return entry;
    const own = asConfigRecord(stored.get(identity))[secretKey];
    const kept = typeof own === 'string' && leavesKey(ops, identity, secretKey) ? own : undefined;
    const value = restated.get(identity) ?? kept;
    if (value === undefined) return entry;
    if (findDroppedEndpointKey(lower.get(identity), entry).length === 0) return entry;
    if (restated.has(identity)) {
      state.warnings.push({
        path: collection.path,
        entryIdentity: identity,
        warning: 'secretRestated',
        keys: [secretKey],
      });
    }
    return { ...asConfigRecord(entry), [secretKey]: value };
  });
}

/** Writes `value` at `path` within the plan's sets: into the set at or above it, else as a set of its own. */
function setWithin(state: PlanState, path: string, value: t.ConfigValue): void {
  const holder = [...state.sets.keys()].find((setPath) => isAtOrUnder(path, setPath));
  if (holder === undefined) {
    state.sets.set(path, value);
    state.effective++;
    return;
  }
  const inner = path.slice(holder.length + 1);
  const held = asConfigRecord(state.sets.get(holder));
  state.sets.set(holder, inner === '' ? value : setValueAtPath(held, inner, value));
}

/**
 * MCP server credentials a save restates (`restate`), written into the
 * server's override where the plan leaves it moving the credential the layer
 * beneath holds without one of its own, so LibreChat sends it there too. A
 * restate of a credential the plan does not drop writes nothing.
 */
function resolveServerRestates(state: PlanState): void {
  const restated = restatedCredentials(state, 'mcpServers');
  if (restated.length === 0) return;
  const dropped = new Set(
    findDroppedCredentials(applyToStored(state), state.snapshot.lower).map(credentialKey),
  );
  for (const { ref, value } of restated) {
    if (!dropped.has(credentialKey(ref))) continue;
    const path = `${ref.path}.${ref.entry}.${ref.secret}`;
    setWithin(state, path, value);
    state.warnings.push({ path, warning: 'secretRestated' });
  }
}

/** Whether the target's own stored record at `path` has key `key`. */
function storesKey(record: t.ConfigValue, key: string): boolean {
  return isConfigRecord(record) && Object.hasOwn(record, key);
}

/**
 * Whether the server can carry what the target stores on record entry
 * `from` to the new name `to` (a rename or copy): the target stores `from`
 * itself (an entry of the layer beneath can't be renamed, and a hint names a
 * stored entry), and `to` is free in both layers, so a swap or a chain onto
 * a stored name can't carry.
 */
export function isCarriableRename(
  stored: t.ConfigValue,
  lower: t.ConfigValue,
  from: string,
  to: string,
): boolean {
  if (from === to || !storesKey(stored, from) || storesKey(lower, from)) return false;
  return !storesKey(stored, to) && !storesKey(lower, to);
}

/** Whether a carry can apply (`isCarriableRename`) to an MCP server the save writes. */
function isCarriable(state: PlanState, op: t.CarryChange): boolean {
  if (op.path !== 'mcpServers') return false;
  const stored = getValueAtPath(state.snapshot.stored, op.path);
  const lower = getValueAtPath(state.snapshot.lower, op.path);
  if (!isCarriableRename(stored, lower, op.from, op.to)) return false;
  const target = `${op.path}.${op.to}`;
  return [...state.sets.keys()].some((path) => isAtOrUnder(path, target));
}

/** Folds every set at and under `path` into one set of `path`, as one object. */
function foldInto(state: PlanState, path: string): void {
  const held = state.sets.get(path);
  let combined: t.ConfigRecord = isConfigRecord(held) ? held : {};
  for (const [setPath, value] of [...state.sets]) {
    if (!setPath.startsWith(`${path}.`)) continue;
    combined = setValueAtPath(combined, setPath.slice(path.length + 1), value);
    state.sets.delete(setPath);
  }
  state.sets.set(path, combined);
}

/**
 * Plans what a renamed or duplicated MCP server takes along of the secrets
 * its source stores (`getSecretCarry`). A batch renames the stored server
 * (`rename`) and then sets the renamed one whole, so a field removed since
 * the rename stays removed, and the removal of the old name goes. Field
 * PATCHes carry the secrets through a `renames` hint; the old name is still
 * removed. A carry that can't apply is left out: its secrets are entered again.
 */
function resolveCarries(state: PlanState): void {
  const carry = getSecretCarry(state.features);
  const batch = usesChangeBatch(state.features);
  for (const op of state.carries) {
    const allowed = op.copy ? carry.mcpCopy : carry.mcpRename;
    if (!allowed || !isCarriable(state, op)) continue;
    if (op.copy || !batch) {
      state.renameHints.push({ path: op.path, previousName: op.from, name: op.to });
      continue;
    }
    const source = `${op.path}.${op.from}`;
    state.renames.push({ path: op.path, from: op.from, to: op.to });
    state.resets = state.resets.filter((path) => !isAtOrUnder(path, source));
    foldInto(state, `${op.path}.${op.to}`);
  }
}

function isScalarValue(value: t.ConfigValue): boolean {
  return value !== undefined && !Array.isArray(value) && !isConfigRecord(value);
}

/**
 * The ancestor a set must be written through: another set in the batch (a
 * `boolean | object` switch turned on, then one of its settings), or a stored
 * scalar (`schedules: false`), which the admin API cannot write a key into.
 */
function findSetHolder(state: PlanState, path: string): string | undefined {
  for (let dot = path.indexOf('.'); dot > 0; dot = path.indexOf('.', dot + 1)) {
    const ancestor = path.slice(0, dot);
    if (state.sets.has(ancestor)) {
      return Array.isArray(state.sets.get(ancestor)) ? undefined : ancestor;
    }
    if (isScalarValue(getValueAtPath(state.snapshot.stored, ancestor))) return ancestor;
  }
  return undefined;
}

/**
 * Folds each set beneath another set or a stored scalar into one set of that
 * ancestor, as an object (`schedules: true` + `schedules.maxPerUser: 5` →
 * `schedules: { maxPerUser: 5 }`): LibreChat reads an object as enabled.
 */
function foldNestedSets(state: PlanState): void {
  const byDepth = [...state.sets.keys()].sort((a, b) => a.split('.').length - b.split('.').length);
  for (const path of byDepth) {
    const holder = findSetHolder(state, path);
    if (!holder) continue;
    const current = state.sets.get(holder);
    const record = isConfigRecord(current) ? current : {};
    const rest = path.slice(holder.length + 1);
    state.sets.set(holder, setValueAtPath(record, rest, state.sets.get(path)));
    state.sets.delete(path);
  }
}

function hasAncestorIn(path: string, paths: Iterable<string>): boolean {
  for (const other of paths) {
    if (path !== other && path.startsWith(`${other}.`)) return true;
  }
  return false;
}

/**
 * Resets are applied after sets, so a reset of a path that also has new
 * descendant values (an entry replaced with different fields, a rename onto
 * the same name) becomes one `set` of the whole new value, and resets under
 * a path being set are dropped (the set replaces that subtree anyway).
 */
function foldResets(state: PlanState): void {
  const resets = [...new Set(state.resets)].filter((path) => !hasAncestorIn(path, state.resets));
  const kept: string[] = [];
  for (const reset of resets) {
    if (state.sets.has(reset) || hasAncestorIn(reset, state.sets.keys())) continue;
    const prefix = `${reset}.`;
    const descendants = [...state.sets.keys()].filter((path) => path.startsWith(prefix));
    if (descendants.length === 0) {
      kept.push(reset);
      continue;
    }
    let combined: t.ConfigRecord = {};
    for (const path of descendants) {
      combined = setValueAtPath(combined, path.slice(prefix.length), state.sets.get(path));
      state.sets.delete(path);
    }
    state.sets.set(reset, combined);
  }
  state.resets = kept;
}

/**
 * Only an override the target holds can be removed (D3): a reset of a value
 * that comes from the layer beneath is reported as `yamlValue` and never
 * sent, and a reset of nothing at all is dropped.
 */
function dropNoopResets(state: PlanState): void {
  const { stored, lower } = state.snapshot;
  state.resets = state.resets.filter((path) => {
    if (isKeyedPath(path)) return keepsKeyedReset(state, path);
    if (valueOrSecretPreview(stored, path) !== undefined) {
      state.effective++;
      return true;
    }
    if (getValueAtPath(lower, path) !== undefined) {
      const reason = state.snapshot.lowerKind === 'inherited' ? 'inheritedValue' : 'yamlValue';
      state.skipped.push({ fieldPath: path, reason });
    }
    return false;
  });
}

/**
 * Whether a reset by key (`endpoints.custom["Name"]`) removes anything: the
 * target's own entry or value there, or a keyed tombstone at or inside it.
 * One a collection's changes resolved to is counted with those changes.
 */
function keepsKeyedReset(state: PlanState, path: string): boolean {
  const keyed = parseKeyedPath(path);
  const removes =
    keyed !== null &&
    (getKeyedValue(state.snapshot.stored, keyed) !== undefined ||
      state.snapshot.tombstones.some((tombstone) => isKeyedAtOrUnder(tombstone, keyed)));
  if (removes && !state.entryResets.has(path)) state.effective++;
  return removes;
}

/**
 * An unhide of a whole entry by key (`endpoints.custom["Name"]`) also resets
 * the keyed tombstones inside it (a removed header), so those the save keeps
 * are written again after it: Unhide shows the entry, as it was before the
 * hide. So are the removals a reset of the target's own entry would take
 * along (`removalsKeptThrough`). They are not counted as changes of their own.
 */
function keepRemovalsInside(state: PlanState): void {
  if (!state.features.keyedTombstones) return;
  const keep = (tombstone: string) => {
    if (state.untombstones.includes(tombstone) || state.tombstones.includes(tombstone)) return;
    state.tombstones.push(tombstone);
  };
  for (const shown of state.untombstones) {
    const keyed = parseKeyedPath(shown);
    if (!keyed || keyed.rest) continue;
    for (const tombstone of state.snapshot.tombstones) {
      if (tombstone !== shown && isKeyedAtOrUnder(tombstone, keyed)) keep(tombstone);
    }
  }
  state.keptRemovals.forEach(keep);
}

function parentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('.')));
}

function isAtOrUnder(path: string, ancestor: string): boolean {
  return isPathAtOrUnder(path, ancestor);
}

/**
 * Whether removing `ancestor` would also remove a tombstone that removing
 * `path` leaves: LibreChat drops every tombstone at or under a removed path,
 * so widening a reset over one would show again a value the target hides.
 */
function holdsOtherTombstone(
  ancestor: string,
  path: string,
  tombstones: readonly string[],
): boolean {
  return tombstones.some(
    (tombstone) => isAtOrUnder(tombstone, ancestor) && !isAtOrUnder(tombstone, path),
  );
}

/**
 * The highest ancestor a removal leaves empty, so no `{}` remains stored: a
 * parent whose only key is the emptied child (`endpoints.anthropic.models`
 * after its last key goes, then `endpoints.anthropic`, then `endpoints`).
 * It never widens past an ancestor with another tombstone under it (stored,
 * or written by this batch), which the wider removal would drop.
 */
function emptiedAncestor(
  storedAfter: t.ConfigRecord,
  path: string,
  tombstones: readonly string[],
): string {
  if (isKeyedPath(path)) return path;
  let current = path;
  const leftEmpty = getValueAtPath(storedAfter, current);
  if (isConfigRecord(leftEmpty) && Object.keys(leftEmpty).length > 0) return current;
  let parent = parentPath(current);
  while (parent) {
    const value = getValueAtPath(storedAfter, parent);
    const child = current.slice(parent.length + 1);
    if (!isConfigRecord(value) || Object.keys(value).some((key) => key !== child)) break;
    if (holdsOtherTombstone(parent, path, tombstones)) break;
    current = parent;
    parent = parentPath(current);
  }
  return current;
}

/**
 * Removes `path` from stored overrides, with a secret's preview companion
 * (LibreChat removes both); a keyed path by its entry, which goes once it
 * holds nothing but its key.
 */
function removeStored(stored: t.ConfigRecord, path: string): t.ConfigRecord {
  if (isKeyedPath(path)) return removeConfigPathValue(stored, path, true);
  const removed = removeValueAtPath(stored, path);
  return isSecretPath(path) ? removeValueAtPath(removed, secretPreviewPath(path)) : removed;
}

/** `record` with key `from` moved to `to`, keeping the key order. */
function renameKey(record: t.ConfigRecord, from: string, to: string): t.ConfigRecord {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key === from ? to : key, value]),
  );
}

/**
 * `next` as LibreChat stores it over `previous`: an object that omits a
 * stored secret keeps it, so its preview companion (all the redacted read
 * shows of it) stays beside the new value.
 */
function keepOmittedSecrets(previous: t.ConfigValue, next: t.ConfigValue): t.ConfigValue {
  if (!isConfigRecord(previous) || !isConfigRecord(next)) return next;
  const result: t.ConfigRecord = { ...next };
  for (const [key, value] of Object.entries(previous)) {
    const secret = secretKeyForPreviewKey(key);
    if (secret !== null && typeof value === 'string' && !(secret in next) && !(key in next)) {
      result[key] = value;
    } else if (isConfigRecord(value) && isConfigRecord(next[key])) {
      result[key] = keepOmittedSecrets(value, next[key]);
    }
  }
  return result;
}

/**
 * `stored` without what the plan's unhides by key reset
 * (`endpoints.custom["Name"].headers.X-Team`): LibreChat removes the
 * target's own value there with the tombstone, before anything else
 * (`keyedTombstones`; before it, such an unset touched no stored value).
 */
function withoutKeyedUnhides(state: PlanState, stored: t.ConfigRecord): t.ConfigRecord {
  if (!state.features.keyedTombstones) return stored;
  return state.untombstones
    .filter(isKeyedPath)
    .reduce((current, path) => removeStored(current, path), stored);
}

/**
 * The target's stored overrides once the plan is applied as LibreChat
 * applies it: unhides by key (which reset what the target stores there),
 * renames, sets (a stored secret an object omits is kept), the secrets
 * `renames` hints carry from the stored entry each names, then removals.
 */
function applyToStored(state: PlanState): t.ConfigRecord {
  let stored = withoutKeyedUnhides(state, state.snapshot.stored);
  for (const { path, from, to } of state.renames) {
    const record = getValueAtPath(stored, path);
    if (isConfigRecord(record)) stored = setValueAtPath(stored, path, renameKey(record, from, to));
  }
  for (const [path, value] of state.sets) {
    stored = setValueAtPath(stored, path, keepOmittedSecrets(getValueAtPath(stored, path), value));
  }
  for (const { path, previousName, name } of state.renameHints) {
    const collection = getKeyedCollection(path);
    if (collection) {
      stored = withCarriedEntrySecret(
        stored,
        state.snapshot.stored,
        collection,
        previousName,
        name,
      );
      continue;
    }
    const target = `${path}.${name}`;
    const server = getValueAtPath(stored, target);
    if (!isConfigRecord(server)) continue;
    const source = getValueAtPath(state.snapshot.stored, `${path}.${previousName}`);
    stored = setValueAtPath(stored, target, withCarriedSecrets(server, source));
  }
  for (const path of [...state.resets, ...state.tombstones]) stored = removeStored(stored, path);
  return stored;
}

/**
 * `stored` with the masked preview of the key entry `from` stores (in
 * `source`) on entry `to`, which a `renames` hint carries it to: LibreChat
 * moves the encrypted key to the renamed entry when the write omits one.
 */
function withCarriedEntrySecret(
  stored: t.ConfigRecord,
  source: t.ConfigRecord,
  collection: t.KeyedCollection,
  from: string,
  to: string,
): t.ConfigRecord {
  const secret = collection.secret;
  const list = getValueAtPath(stored, collection.path);
  const sourceList = getValueAtPath(source, collection.path);
  if (!secret || !Array.isArray(list) || !Array.isArray(sourceList)) return stored;
  const preview = asConfigRecord(
    sourceList.find((entry) => getEntryKey(entry, collection.key) === from),
  )[secret.preview];
  if (typeof preview !== 'string' || preview === '') return stored;
  const next = list.map((entry) => {
    if (getEntryKey(entry, collection.key) !== to || !isConfigRecord(entry)) return entry;
    return secret.key in entry ? entry : { ...entry, [secret.preview]: preview };
  });
  return setValueAtPath(stored, collection.path, next);
}

/**
 * Widens each reset to the highest parent it leaves empty, then returns the
 * stored overrides afterwards. A server that prunes emptied parents itself
 * (`prunesEmptyParents`) gets each reset as planned. A stored tombstone the
 * plan unhides does not stop the widening: the unhide removes it first.
 */
function pruneEmptyParents(state: PlanState): t.ConfigRecord {
  if (state.features.prunesEmptyParents) return applyToStored(state);
  const removed = applyToStored(state);
  const kept = state.snapshot.tombstones.filter(
    (path) => !state.untombstones.some((shown) => isAtOrUnder(path, shown)),
  );
  const tombstones = [...kept, ...state.tombstones];
  const widened = state.resets.map((path) => emptiedAncestor(removed, path, tombstones));
  state.resets = [...new Set(widened)].filter((path) => !hasAncestorIn(path, widened));
  return applyToStored(state);
}

function issueKey(issue: t.ConfigIssue): string {
  return `${issue.path}|${issue.code ?? ''}|${issue.entryIdentity ?? ''}`;
}

/**
 * An entry as schema validation sees it: a secret held hidden (read back
 * only as its preview) is present, so a schema that requires the key (an
 * Azure group's `apiKey`) passes. LibreChat keeps a key the target stores
 * encrypted for a write that omits it, and an entry merged over the layer
 * beneath keeps that layer's key: one Base stores, or a librechat.yaml
 * literal the server redacts.
 */
function withHeldSecret(
  entry: t.ConfigValue,
  collection: t.KeyedCollection,
  held: boolean,
): t.ConfigValue {
  const key = collection.secret?.key;
  if (!held || !key || !isConfigRecord(entry) || entry[key] !== undefined) return entry;
  return { ...entry, [key]: SECRET_PREVIEW_MASK };
}

function validateCollectionSet(
  state: PlanState,
  collection: t.KeyedCollection,
  value: t.ConfigValue[],
): t.ConfigIssue[] {
  const touched = state.touchedEntries.get(collection.path);
  const lowerEntries = getValueAtPath(state.snapshot.lower, collection.path);
  const lowerList = Array.isArray(lowerEntries) ? lowerEntries : [];
  const storedEntries = getValueAtPath(state.snapshot.stored, collection.path);
  /** Entries with a stored key: those the target stores, and those a batch renames with theirs. */
  const storedKeys = new Set([
    ...(Array.isArray(storedEntries) ? storedEntries : [])
      .filter((entry) => hasHiddenSecret(entry, collection))
      .map((entry) => getEntryKey(entry, collection.key)),
    ...state.renames.filter(({ path }) => path === collection.path).map(({ to }) => to),
    ...state.renameHints.filter(({ path }) => path === collection.path).map(({ name }) => name),
  ]);
  const servedBy =
    collection.path === AZURE_GROUPS_PATH
      ? modelsByGroup(mergeConfigLayers(lowerList, value, collection.path))
      : undefined;
  return value.flatMap((entry, index) => {
    const identity = getEntryKey(entry, collection.key);
    const lowerEntry =
      collection.merge === 'byKey'
        ? lowerList.find((candidate) => getEntryKey(candidate, collection.key) === identity)
        : undefined;
    const merged = mergeConfigLayers(lowerEntry, entry);
    /**
     * LibreChat resolves the target's groups together and refuses a write
     * where one doesn't, touched or not (a leftover of a group Base removed).
     */
    const unresolved = servedBy ? validateResolvableGroup(merged, index, identity, servedBy) : [];
    if (touched && (identity === undefined || !touched.has(identity))) return unresolved;
    const held =
      (identity !== undefined && storedKeys.has(identity)) ||
      hasHiddenSecret(lowerEntry, collection);
    const issues = validateEntry(
      collection.path,
      withHeldSecret(merged, collection, held),
      index,
      identity,
    );
    if (servedBy) return [...issues, ...unresolved];
    /** The layer beneath owns its entries (and its literal keys are redacted on read): check only the target's own. */
    if (collection.path !== 'endpoints.custom' || lowerEntry !== undefined) return issues;
    return [
      ...issues,
      ...validateLoadableEndpoint(merged, index, identity, storedKeys.has(identity)),
    ];
  });
}

/**
 * Blank text in a collection's list counts only in the entries this batch
 * touches: an entry stored earlier (and not edited now) never blocks an
 * unrelated save.
 */
function isIntroducedIssue(state: PlanState, path: string, issue: t.ConfigIssue): boolean {
  if (!issue.code || !BLANK_TEXT_CODES.has(issue.code) || issue.entryIdentity === undefined) {
    return true;
  }
  const touched = state.touchedEntries.get(path);
  return touched === undefined || touched.has(issue.entryIdentity);
}

/**
 * Whether a schema issue blocks the write. A text value an enum of the
 * bundled schema doesn't list is written (`isUnknownEnumValue`): LibreChat
 * may know it, and from v0.8.8 refuses it on the field when it doesn't.
 */
function isBlockingIssue(issue: t.ConfigIssue): boolean {
  return !isUnknownEnumValue(issue);
}

/** Validates every set; returns the paths a write rule blocks outright. */
function validateSets(state: PlanState): Set<string> {
  const blocked = new Set<string>();
  for (const [path, value] of state.sets) {
    const ruleIssues = findWriteRuleIssues(path, value, state.features, state.rules).filter(
      (issue) => isIntroducedIssue(state, path, issue),
    );
    if (ruleIssues.length > 0) {
      state.issues.push(...ruleIssues);
      blocked.add(path);
      continue;
    }
    const collection = getKeyedCollection(path);
    const issues =
      collection && Array.isArray(value)
        ? validateCollectionSet(state, collection, value)
        : validateField(path, value);
    state.issues.push(...issues.filter(isBlockingIssue));
  }
  return blocked;
}

function isInCollection(path: string): boolean {
  return findKeyedCollectionEntry(path) !== undefined;
}

/**
 * The layer beneath without the values `tombstones` hide; a keyed one only
 * where LibreChat applies it (`keyedTombstones`).
 */
function hideAll(
  lower: t.ConfigRecord,
  tombstones: Iterable<string>,
  keyedTombstones: boolean,
): t.ConfigRecord {
  let result = lower;
  for (const path of tombstones) {
    if (!isKeyedPath(path)) result = removeValueAtPath(result, path);
    else if (keyedTombstones) result = removeConfigPathValue(result, path);
  }
  return result;
}

/**
 * The target's tombstones once a batch is applied: a set clears those at its
 * path and above it, a removal those at or below it, and new hides are added.
 */
function tombstonesAfter(state: PlanState, sets: readonly string[]): string[] {
  const removals = [...state.resets, ...state.untombstones];
  const kept = state.snapshot.tombstones.filter(
    (tombstone) =>
      !removals.some((path) => isAtOrUnder(tombstone, path)) &&
      !sets.some(
        (path) => isAtOrUnder(path, tombstone) || writesHiddenEntry(state, path, tombstone),
      ),
  );
  return [...new Set([...kept, ...state.tombstones])];
}

/**
 * Whether the set at `path` writes the entry a whole-entry keyed tombstone
 * hides, which LibreChat takes as showing it again.
 */
function writesHiddenEntry(state: PlanState, path: string, tombstone: string): boolean {
  const keyed = parseKeyedPath(tombstone);
  if (!keyed || keyed.rest || !isAtOrUnder(keyed.collection.path, path)) return false;
  const value = state.sets.get(path);
  const list =
    path === keyed.collection.path
      ? value
      : getValueAtPath(value, keyed.collection.path.slice(path.length + 1));
  return Array.isArray(list) && list.some((entry) => isKeyedEntry(keyed, entry));
}

/**
 * The layer beneath the target before and after the write, as LibreChat
 * validates against it. A change batch (`usesChangeBatch`) is judged on its
 * end state: the layer without the tombstones the target holds before and
 * after it, for every section it writes (a hide alone included). Separate
 * field writes go tombstones first, and LibreChat validates a field PATCH
 * against the layer without the target's tombstones, so a section the plan
 * sets values in is validated without the values it hides; a hide alone is
 * not validated by LibreChat, and is not here either.
 */
function validationFloors(
  state: PlanState,
  sets: readonly string[],
): { before: t.ConfigRecord; after: t.ConfigRecord } {
  const { lower, tombstones } = state.snapshot;
  const { keyedTombstones } = state.features;
  if (usesChangeBatch(state.features)) {
    return {
      before: hideAll(lower, tombstones, keyedTombstones),
      after: hideAll(lower, tombstonesAfter(state, sets), keyedTombstones),
    };
  }
  const setSections = new Set(sets.map(getConfigSection));
  const hidden = state.tombstones.filter((path) => setSections.has(getConfigSection(path)));
  return { before: lower, after: hideAll(lower, hidden, keyedTombstones) };
}

/**
 * Whole-section validation of the merged result (lower layer + overrides
 * after the write), so refinements and required siblings are checked. An
 * issue is reported when the write introduced it, or when it lies at or
 * under a written path; issues the configuration already had elsewhere do
 * not block an unrelated write, and neither does an enum value the bundled
 * schema doesn't list (`isBlockingIssue`). Collection entries are validated
 * per entry.
 */
function validateSections(state: PlanState, blocked: ReadonlySet<string>): void {
  const sets = [...state.sets.keys()].filter((path) => !blocked.has(path));
  let storedAfter = withoutKeyedUnhides(state, state.snapshot.stored);
  for (const path of sets) storedAfter = setValueAtPath(storedAfter, path, state.sets.get(path));
  for (const path of [...state.resets, ...state.tombstones]) {
    storedAfter = removeStored(storedAfter, path);
  }
  const written = [
    ...sets,
    ...state.resets,
    ...state.tombstones,
    ...(usesChangeBatch(state.features) ? state.untombstones : []),
  ];
  /** LibreChat reads librechat.yaml-only sections from the file alone: removing an override there can't break them. */
  const sections = new Set(
    written
      .filter((path) => getReadOnlyReason(path, state.rules) !== 'yamlOnly')
      .map(getConfigSection),
  );
  const reported = new Set(state.issues.map(issueKey));
  const { stored } = state.snapshot;
  const floors = validationFloors(state, sets);
  for (const section of sections) {
    const before = mergeConfigLayers(floors.before[section], stored[section], section);
    const after = mergeConfigLayers(floors.after[section], storedAfter[section], section);
    const existing = new Set(validateSection(section, before).map(issueKey));
    for (const issue of validateSection(section, after)) {
      if (!isBlockingIssue(issue) || isInCollection(issue.path) || reported.has(issueKey(issue))) {
        continue;
      }
      const underWrite = written.some(
        (path) => issue.path === path || issue.path.startsWith(`${path}.`),
      );
      if (existing.has(issueKey(issue)) && !underWrite) continue;
      reported.add(issueKey(issue));
      state.issues.push(issue);
    }
  }
}

/**
 * Keys of a whole object written over a lower-layer object that the write
 * leaves out: LibreChat merges objects key by key, so those keys come back
 * (e.g. a librechat.yaml MCP header removed in the panel).
 */
function findMergedBackKeys(state: PlanState): void {
  for (const [path, value] of state.sets) {
    if (!isConfigRecord(value) || getKeyedCollection(path)) continue;
    const lowerValue = getValueAtPath(state.snapshot.lower, path);
    if (!isConfigRecord(lowerValue)) continue;
    const keys = diffOverride(lowerValue, value).unremovable.filter((key) => !isSecretPath(key));
    if (keys.length > 0) state.warnings.push({ path, warning: 'yamlOnly', keys });
  }
}

/** The plan's write paths, a keyed collection's by the entries its changes touch. */
function changedLocations(state: PlanState): string[] {
  const paths = [...state.sets.keys(), ...state.resets, ...state.tombstones, ...state.untombstones];
  return paths.flatMap((path) => {
    const keyed = parseKeyedPath(path);
    if (keyed) {
      const entry = entryLocation(keyed.collection.path, keyed.key);
      return [keyed.rest ? `${entry}.${keyed.rest}` : entry];
    }
    const entries = state.touchedEntries.get(path);
    return entries ? [...entries].map((name) => entryLocation(path, name)) : [path];
  });
}

/**
 * Model specs a save writes that select a custom endpoint the target hides
 * once the save is applied (`keyedTombstones`). A server that derives what
 * specs offer (`specInterfaceRederive`) refuses a spec whose endpoint the
 * target's layers leave unconfigured (`unknown_spec_endpoint`), and checks
 * the list only where the save writes it: a hide alone takes the specs along.
 */
function findHiddenSpecEndpoints(state: PlanState, storedAfter: t.ConfigRecord): void {
  const custom = getKeyedCollection(CUSTOM_ENDPOINTS);
  const { specInterfaceRederive, keyedTombstones } = state.features;
  if (!custom || !specInterfaceRederive || !keyedTombstones) return;
  const sets = [...state.sets.keys()];
  const written = [...sets, ...state.resets, ...state.tombstones];
  const writesSpecs = written.some(
    (path) => isAtOrUnder(path, SPEC_LIST) || isAtOrUnder(SPEC_LIST, path),
  );
  const specs = getValueAtPath(storedAfter, SPEC_LIST);
  if (!writesSpecs || !Array.isArray(specs)) return;
  const ownList = getValueAtPath(storedAfter, CUSTOM_ENDPOINTS);
  const own = new Set(
    (Array.isArray(ownList) ? ownList : []).flatMap((entry) => identityIn(custom, entry) ?? []),
  );
  const hidden = new Set(
    [...hiddenIdentities(tombstonesAfter(state, sets), custom)].filter((id) => !own.has(id)),
  );
  if (hidden.size === 0) return;
  state.issues.push(
    ...specs.flatMap((spec, index): t.ConfigIssue[] => {
      const endpoint = getValueAtPath(spec, 'preset.endpoint');
      if (typeof endpoint !== 'string' || !selectsHiddenEndpoint(spec, hidden)) return [];
      const params = { endpoint };
      return [
        {
          path: `${SPEC_LIST}.${index}.preset.endpoint`,
          code: SPEC_ENDPOINT_HIDDEN,
          params,
          message: describeIssueCode(SPEC_ENDPOINT_HIDDEN, params, SPEC_ENDPOINT_HIDDEN),
          entryIdentity: getEntryKey(spec, 'name'),
          entryPath: 'preset.endpoint',
        },
      ];
    }),
  );
}

/**
 * Duplicated MCP servers the plan writes without the stored secrets of the
 * server they copy (no `renames` hint carries them): a `secretNotCopied`
 * warning names the secrets each one uses but doesn't enter.
 */
function findUncopiedCopies(state: PlanState, storedAfter: t.ConfigRecord): void {
  const { lower, stored } = state.snapshot;
  for (const op of state.carries) {
    if (!op.copy) continue;
    const carried = state.renameHints.some(
      (hint) => hint.path === op.path && hint.name === op.to && hint.previousName === op.from,
    );
    const target = `${op.path}.${op.to}`;
    if (carried || getValueAtPath(storedAfter, target) === undefined) continue;
    const source = `${op.path}.${op.from}`;
    const keys = findUncopiedSecrets(
      mergeConfigLayers(getValueAtPath(lower, source), getValueAtPath(stored, source)),
      mergeConfigLayers(getValueAtPath(lower, target), getValueAtPath(storedAfter, target)),
    );
    if (keys.length === 0) continue;
    state.warnings.push({ path: op.path, entryIdentity: op.to, warning: 'secretNotCopied', keys });
  }
}

/**
 * Where the plan moves a credential (`binding.ts`): a stored secret it keeps
 * while changing its destination blocks the save until it is entered again,
 * and an inherited one it stops LibreChat from sending is a warning. A
 * renamed or copied MCP server is judged against the server it comes from.
 */
function findBindingChanges(state: PlanState, storedAfter: t.ConfigRecord): void {
  const renamedIn = (record: string) =>
    state.renames.filter(({ path }) => path === record).map(({ from, to }) => [to, from] as const);
  const hintedIn = (record: string) =>
    state.renameHints
      .filter(({ path }) => path === record)
      .map(({ previousName, name }) => [name, previousName] as const);
  const origins = new Map([...renamedIn('mcpServers'), ...hintedIn('mcpServers')]);
  const input: t.CredentialBindingInput = {
    stored: state.snapshot.stored,
    storedAfter,
    lower: state.snapshot.lower,
    hidden: {
      before: state.snapshot.tombstones,
      after: tombstonesAfter(state, [...state.sets.keys()]),
    },
    origins,
    endpointOrigins: new Map([...renamedIn('endpoints.custom'), ...hintedIn('endpoints.custom')]),
  };
  state.issues.push(...findSecretReentryIssues(input, state.features));
  state.warnings.push(...findRebindingWarnings(input, state.features));
}

/**
 * Resolves a batch of changes against the target's stored overrides and the
 * layer beneath it, into the admin API writes that implement it, by the
 * server's contract `features`, write `rules` and `limits` (the bundled ones:
 * an older server). Everything
 * is checked before anything may be written: write rules (read-only and
 * YAML-managed paths, process-backed MCP fields, unsafe keys), field and
 * entry schemas, whole sections, and the keyed collection rules. The client
 * runs it for the review and inline errors; the server runs it again against
 * freshly read layers right before writing.
 */
export function planConfigChanges(
  ops: t.ConfigChange[],
  snapshot: t.WriteSnapshot,
  features: t.ConfigFeatures = BUNDLED_CONFIG_FEATURES,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
  limits: Pick<t.ConfigLimits, 'maxEntryKeyLength'> = BUNDLED_CONFIG_LIMITS,
): t.WritePlan {
  const state: PlanState = {
    snapshot,
    features,
    rules,
    maxEntryKeyLength: limits.maxEntryKeyLength,
    sets: new Map(),
    resets: [],
    tombstones: [],
    untombstones: [],
    entryOps: new Map(),
    carries: [],
    restates: [],
    renames: [],
    renameHints: [],
    skipped: [],
    issues: [],
    warnings: [],
    effective: 0,
    touchedEntries: new Map(),
    entryResets: new Set(),
    keptRemovals: [],
  };
  collectOps(state, ops);
  dropHiddenEntryOps(state);
  addRestatedEntries(state);
  resolveCollections(state);
  resolveCarries(state);
  foldNestedSets(state);
  foldResets(state);
  dropNoopResets(state);
  resolveServerRestates(state);
  state.effective += state.tombstones.length + state.untombstones.length;
  keepRemovalsInside(state);
  const storedAfter = pruneEmptyParents(state);
  validateSections(state, validateSets(state));
  findHiddenSpecEndpoints(state, storedAfter);
  findMergedBackKeys(state);
  findBindingChanges(state, storedAfter);
  findUncopiedCopies(state, storedAfter);
  return {
    sets: [...state.sets].map(([fieldPath, value]) => ({ fieldPath, value })),
    resets: state.resets,
    tombstones: state.tombstones,
    untombstones: state.untombstones,
    renames: state.renames,
    renameHints: state.renameHints,
    skipped: state.skipped,
    issues: state.issues,
    warnings: state.warnings,
    storedAfter,
    effective: state.effective,
    changed: changedLocations(state),
  };
}

/** `carry` changes of one kind, from new entry path → the saved entry path it comes from. */
function toCarries(entries: Readonly<Record<string, string>>, copy: boolean): t.ConfigChange[] {
  return Object.entries(entries).flatMap(([toPath, fromPath]): t.ConfigChange[] => {
    const dot = toPath.lastIndexOf('.');
    const path = toPath.slice(0, Math.max(dot, 0));
    if (dot <= 0 || !fromPath.startsWith(`${path}.`)) return [];
    const from = fromPath.slice(path.length + 1);
    const to = toPath.slice(dot + 1);
    return [{ op: 'carry', path, from, to, ...(copy && { copy }) }];
  });
}

/**
 * The `carry` changes of the record entries renamed (`renames`) and
 * duplicated (`copies`) this session, each keyed by its new entry path
 * (`mcpServers.acme-docs`) and naming the saved entry it comes from.
 */
export function carryChanges(
  renames: Readonly<Record<string, string>>,
  copies: Readonly<Record<string, string>>,
): t.ConfigChange[] {
  return [...toCarries(renames, false), ...toCarries(copies, true)];
}

/** The `restate` changes of the inherited credentials restated this session. */
export function restateChanges(
  restates: Readonly<Record<string, t.CredentialRef>>,
): t.ConfigChange[] {
  return Object.values(restates).map(({ path, entry, secret }): t.ConfigChange => ({
    op: 'restate',
    path,
    entry,
    secret,
  }));
}

/** Entries a plan gives the secrets of the entry they come from, in the record at `path`. */
export function carriedEntries(plan: t.WritePlan, path: string): Set<string> {
  return new Set([
    ...plan.renames.filter((rename) => rename.path === path).map((rename) => rename.to),
    ...plan.renameHints.filter((hint) => hint.path === path).map((hint) => hint.name),
  ]);
}

/** How many changes of a batch fall in each config section, in the order the sections first appear. */
export function countSectionChanges(ops: t.ConfigBatchOp[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { fieldPath } of ops) {
    const section = getConfigSection(fieldPath);
    counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  return counts;
}

/**
 * The sections holding more changes than one batch takes (`maxChangeOps`):
 * a save never splits a section, so LibreChat can't take one of these.
 */
export function findOversizedSections(
  counts: ReadonlyMap<string, number>,
  limit: number,
): t.ConfigIssue[] {
  if (limit <= 0) return [];
  return [...counts].flatMap(([section, count]): t.ConfigIssue[] => {
    if (count <= limit) return [];
    const params = { count, limit };
    const message = describeIssueCode(TOO_MANY_CHANGES_CODE, params, '');
    return [{ path: section, code: TOO_MANY_CHANGES_CODE, message, params }];
  });
}

function toUnsetOp(fieldPath: string): t.ConfigBatchOp {
  return { op: 'unset', fieldPath };
}

function toTombstoneOp(fieldPath: string): t.ConfigBatchOp {
  return { op: 'tombstone', fieldPath };
}

/**
 * A plan's tombstones split by when they are sent: those at or inside what
 * a reset of the plan removes by key (`endpoints.custom["Name"]`) go after
 * the resets (`late`), since that reset removes every keyed tombstone there
 * (a removed header the save keeps, or one it adds there); the rest go
 * before the sets (`early`).
 */
export function orderTombstones(
  plan: Pick<t.WritePlan, 'resets' | 'tombstones'>,
): t.TombstoneOrder {
  const keyedResets = plan.resets.flatMap((path) => parseKeyedPath(path) ?? []);
  const order: t.TombstoneOrder = { early: [], late: [] };
  for (const tombstone of plan.tombstones) {
    const late = keyedResets.some((keyed) => isKeyedAtOrUnder(tombstone, keyed));
    (late ? order.late : order.early).push(tombstone);
  }
  return order;
}

/**
 * A plan as the changes of one `POST …/changes` batch: unhides, hides,
 * renames, sets, resets, then the hides inside an entry a reset removes
 * whole (`orderTombstones`), one `unset` per path a hide or set does not
 * already write (a batch refuses two changes at one path). An unhide removes
 * everything at and under its path, so it goes first: after them, it would
 * remove a set or hide inside it (an MCP server shown again with its URL
 * edited). A rename moves a stored entry, secrets included, before the sets
 * write it under its new name. The server applies the changes in that order
 * and validates the end state.
 */
export function toBatchOps(plan: t.WritePlan): t.ConfigBatchOp[] {
  const written = new Set([...plan.tombstones, ...plan.sets.map(({ fieldPath }) => fieldPath)]);
  const unhides = [...new Set(plan.untombstones)].filter((path) => !written.has(path));
  const removed = new Set([...written, ...unhides]);
  const resets = [...new Set(plan.resets)].filter((path) => !removed.has(path));
  const { early, late } = orderTombstones(plan);
  return [
    ...unhides.map(toUnsetOp),
    ...early.map(toTombstoneOp),
    ...plan.renames.map(({ path, from, to }): t.ConfigBatchOp => ({
      op: 'rename',
      fieldPath: path,
      from,
      to,
    })),
    ...plan.sets.map(({ fieldPath, value }): t.ConfigBatchOp => ({ op: 'set', fieldPath, value })),
    ...resets.map(toUnsetOp),
    ...late.map(toTombstoneOp),
  ];
}

/** Whether `key` (inside `parent`) is what the admin API redacts on read: a secret's value, or its masked preview. */
function isRedactedKey(parent: string | undefined, key: string, value: t.ConfigValue): boolean {
  return (
    (!isConfigRecord(value) && isStoredSecretKey(parent, key)) || isSecretPreviewKey(parent, key)
  );
}

/** A stored value without its secrets and their masked previews (`key`: where it is stored); an object left empty reads as absent. */
function stripSecrets(value: t.ConfigValue, key?: string): t.ConfigValue {
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item));
  if (!isConfigRecord(value)) return value;
  const result: t.ConfigRecord = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (!isRedactedKey(key, childKey, child)) result[childKey] = stripSecrets(child, childKey);
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

/** `key` inside the relative path `prefix` (the value itself when empty). */
function childPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

/** Where (relative) a stored value holds a secret: its value or the masked preview a redacted read keeps of it. */
function heldSecrets(value: t.ConfigValue, prefix = '', key?: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => heldSecrets(item, childPath(prefix, String(index))));
  }
  if (!isConfigRecord(value)) return [];
  return Object.entries(value).flatMap(([childKey, child]) => {
    const at = childPath(prefix, secretKeyForPreviewKey(childKey) ?? childKey);
    if (isRedactedKey(key, childKey, child)) return typeof child === 'string' && child ? [at] : [];
    return heldSecrets(child, childPath(prefix, childKey), childKey);
  });
}

/**
 * Whether `stored` (what LibreChat stores, as its redacted read returns it)
 * holds what the plan stores at `path` (`intended`): the same settings, and
 * every secret the plan stores there, read from its value or its masked
 * preview. A secret LibreChat keeps that the write leaves out (a stored key
 * of an entry the write doesn't touch) is not the write's to check.
 */
function storesWrite(intended: t.ConfigRecord, stored: t.ConfigRecord, path: string): boolean {
  const value = getValueAtPath(intended, path);
  if (!isConfigRecord(value) && !Array.isArray(value) && isSecretPath(path)) {
    return !holdsSecretAt(intended, path) || holdsSecretAt(stored, path);
  }
  const key = path.slice(path.lastIndexOf('.') + 1);
  const actual = getValueAtPath(stored, path);
  if (!isConfigValueEqual(stripSecrets(value, key), stripSecrets(actual, key))) return false;
  return heldSecrets(value, '', key).every((secret) => holdsSecretAt(actual, secret));
}

/** Whether `stored` still holds something at `path`: a value, or for a secret its masked preview. */
function holdsAt(stored: t.ConfigRecord, path: string): boolean {
  if (isKeyedPath(path)) return getConfigPathValue(stored, path) !== undefined;
  const value = getValueAtPath(stored, path);
  if (isConfigRecord(value) || !isSecretPath(path)) return value !== undefined;
  return holdsSecretAt(stored, path);
}

/**
 * Leaf paths (relative) and values of a value; arrays are leaves, and so is an
 * object with a dotted key, which no path can split (`hasDottedKey`); secrets
 * and their masked previews are skipped (`key`: where `value` is stored).
 */
function leavesOf(value: t.ConfigValue, prefix = '', key?: string): Array<[string, t.ConfigValue]> {
  if (!isConfigRecord(value) || hasDottedKey(value)) return [[prefix, value]];
  return Object.entries(value).flatMap(([childKey, child]) =>
    isRedactedKey(key, childKey, child)
      ? []
      : leavesOf(child, prefix ? `${prefix}.${childKey}` : childKey, childKey),
  );
}

function joinPath(base: string, rest: string): string {
  return rest ? `${base}.${rest}` : base;
}

/** Whether every leaf written at `path` shows in the effective config, or some still show the lower value. */
function lacksEffect(
  path: string,
  value: t.ConfigValue,
  snapshot: t.WriteSnapshot,
  effective: t.ConfigRecord,
): boolean {
  return leavesOf(value, '', path.slice(path.lastIndexOf('.') + 1)).some(([rest, leaf]) => {
    const leafPath = joinPath(path, rest);
    const actual = getValueAtPath(effective, leafPath);
    const lowerLeaf = getValueAtPath(snapshot.lower, leafPath);
    if (lowerLeaf === undefined || isConfigValueEqual(actual, leaf)) return false;
    return isConfigValueEqual(actual, lowerLeaf);
  });
}

function collectionLacksEffect(
  collection: t.KeyedCollection,
  entries: t.ConfigValue[],
  effective: t.ConfigRecord,
): string[] {
  const live = getValueAtPath(effective, collection.path);
  const liveEntries = Array.isArray(live) ? live : [];
  return entries.flatMap((entry) => {
    const identity = getEntryKey(entry, collection.key);
    const actual = liveEntries.find((item) => getEntryKey(item, collection.key) === identity);
    const missing =
      actual === undefined ||
      leavesOf(entry).some(
        ([rest, leaf]) => !isConfigValueEqual(getValueAtPath(actual, rest), leaf),
      );
    return missing ? [`${collection.path} › ${identity ?? '?'}`] : [];
  });
}

/**
 * After a write: every change that did not take effect, and why. A stored
 * value that differs from what was sent (LibreChat dropped keys or a whole
 * section) is `notStored`; with the effective config (base target), a value
 * that still reads as the lower layer's is `notApplied`; and keys a merge
 * brings back from the lower layer (`yamlOnly` warnings) are `yamlMerged`.
 */
export function verifyWrite(
  plan: t.WritePlan,
  snapshot: t.WriteSnapshot,
  storedActual: t.ConfigRecord,
  effective?: t.ConfigRecord,
): t.SkippedChange[] {
  const result: t.SkippedChange[] = [];
  const flagged = new Set<string>();
  const flag = (fieldPath: string, reason: t.SkipReason) => {
    if (flagged.has(fieldPath)) return;
    flagged.add(fieldPath);
    result.push({ fieldPath, reason });
  };
  for (const { fieldPath, value } of plan.sets) {
    if (!storesWrite(plan.storedAfter, storedActual, fieldPath)) {
      flag(fieldPath, 'notStored');
      continue;
    }
    if (!effective || (!isConfigRecord(value) && isSecretPath(fieldPath))) continue;
    const collection = getKeyedCollection(fieldPath);
    if (collection && Array.isArray(value)) {
      if (collection.merge === 'byKey') {
        collectionLacksEffect(collection, value, effective).forEach((path) =>
          flag(path, 'notApplied'),
        );
      }
      continue;
    }
    if (lacksEffect(fieldPath, value, snapshot, effective)) flag(fieldPath, 'notApplied');
  }
  for (const path of plan.resets) {
    if (holdsAt(storedActual, path)) flag(path, 'notStored');
  }
  for (const { fieldPath, reason } of mergedBackChanges(plan.warnings, snapshot)) {
    flag(fieldPath, reason);
  }
  return result;
}

/** `endpoints.custom.<n>`: where an entry sits in the list the page (and its labels) read. */
function entryPathOf(path: string, identity: string, snapshot?: t.WriteSnapshot): string {
  const collection = getKeyedCollection(path);
  if (!collection || !snapshot) return path;
  const merged = mergeConfigLayers(
    getValueAtPath(snapshot.lower, path),
    getValueAtPath(snapshot.stored, path),
    path,
  );
  const index = Array.isArray(merged)
    ? merged.findIndex((entry) => getEntryKey(entry, collection.key) === identity)
    : -1;
  return index < 0 ? path : `${path}.${index}`;
}

/**
 * The lower-layer keys a write leaves out but LibreChat merges back, one change
 * per key: `yamlMerged` for Base, `inheritedMerged` for a profile (the keys
 * come from Base). Entry keys are dot-paths through the entry's position in
 * the merged list (`endpoints.custom.3.models.fetch`), so labels resolve to
 * "Custom endpoints › Moonshot › Fetch model list"; without the snapshot the
 * position is unknown and the path stops at the collection.
 */
export function mergedBackChanges(
  warnings: t.ConfigWarning[],
  snapshot?: t.WriteSnapshot,
): t.SkippedChange[] {
  const reason = snapshot?.lowerKind === 'inherited' ? 'inheritedMerged' : 'yamlMerged';
  return warnings.flatMap((warning) => {
    if (warning.warning !== 'yamlOnly') return [];
    const identity = warning.entryIdentity;
    const holder = identity ? entryPathOf(warning.path, identity, snapshot) : warning.path;
    return (warning.keys ?? []).map((key) => ({
      fieldPath: `${holder}.${key}`,
      reason,
      entryIdentity: identity,
      entryPath: identity ? key : undefined,
    }));
  });
}
