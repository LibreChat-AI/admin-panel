import { PrincipalType } from 'librechat-data-provider';
import type { AdminGroup, AdminUserSearchResult } from '@librechat/data-schemas';
import type * as t from '@/types';
import {
  BASE_PRINCIPAL,
  KEYED_COLLECTIONS,
  getScopeGateReason,
  BUNDLED_CONFIG_FEATURES,
} from '@/constants';
import { getEntryKey, mergesByKey, getKeyedCollection } from './collections';
import { flattenObject, getValueAtPath, isConfigRecord } from './format';
import { isSecretPath, isSecretPreviewPath } from './secrets';
import { entryIdentityOf, parseKeyedPath } from './keyed';

/** The skip reason a save in a profile gets when its section is gated (`getScopeGateReason`). */
const GATE_SKIP_REASONS: Readonly<Record<t.ScopeGateReason, t.SkipReason>> = {
  baseOnly: 'baseOnly',
  yamlOnly: 'yamlOnly',
  tenantWide: 'dedicated',
  preAuth: 'baseScope',
};

/** Order of profile kinds on equal priority under `deterministicPrecedence`: roles, then groups, then users. */
const TYPE_RANK: Readonly<Record<string, number>> = {
  [PrincipalType.ROLE]: 0,
  [PrincipalType.GROUP]: 1,
  [PrincipalType.USER]: 2,
};

/**
 * The order LibreChat applies profiles in with `deterministicPrecedence`,
 * the last winning: ascending priority, then roles before groups before
 * users, then the older profile first (document id, roughly creation order).
 * Base always applies before every profile.
 */
export function compareScopePrecedence(a: t.ConfigScope, b: t.ConfigScope): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const rank = (TYPE_RANK[a.principalType] ?? 0) - (TYPE_RANK[b.principalType] ?? 0);
  if (rank !== 0) return rank;
  const [idA, idB] = [a._id ?? '', b._id ?? ''];
  if (idA === idB) return 0;
  return idA < idB ? -1 : 1;
}

/** Profile kinds a user can only belong to once, so two of them never apply together. */
const SINGLE_MEMBERSHIP_TYPES: ReadonlySet<PrincipalType> = new Set([
  PrincipalType.ROLE,
  PrincipalType.USER,
]);

/** Record sections whose entries count as one override each (an MCP server, not its fields). */
const ENTRY_COUNTED_SECTIONS: ReadonlySet<string> = new Set(['mcpServers']);

const PREVIEW_SUFFIX = 'Preview';

function isEmptyRecord(value: t.ConfigValue): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

/**
 * Leaf paths of a profile's stored overrides: nested objects become prefixes,
 * an array is one leaf, and the empty objects LibreChat leaves behind after a
 * field is removed are not overrides.
 */
export function collectOverridePaths(overrides: t.ConfigRecord): string[] {
  return Object.entries(flattenObject(overrides))
    .filter(([, value]) => !isEmptyRecord(value))
    .map(([path]) => path);
}

/** Whether two scope values point at the same profile. */
export function isSameScope(a: t.ConfigPrincipal, b: t.ConfigPrincipal): boolean {
  return a.principalType === b.principalType && a.principalId === b.principalId;
}

/** A role as principal pickers list it. */
export function roleCandidate(role: Pick<t.Role, 'id' | 'name' | 'description'>): t.ScopeCandidate {
  return {
    principalType: PrincipalType.ROLE,
    principalId: role.id,
    name: role.name,
    description: role.description,
  };
}

/** A group as principal pickers list it. */
export function groupCandidate(
  group: Pick<AdminGroup, 'id' | 'name' | 'description'>,
): t.ScopeCandidate {
  return {
    principalType: PrincipalType.GROUP,
    principalId: group.id,
    name: group.name,
    description: group.description,
  };
}

/** A user search result as principal pickers list it: by name (else username or email), with the email. */
export function userCandidate(user: AdminUserSearchResult): t.ScopeCandidate {
  return {
    principalType: PrincipalType.USER,
    principalId: user.id,
    name: user.name || user.username || user.email,
    email: user.email,
  };
}

/** A profile's principal as pickers list it: type, id, display name and a user's email. */
export function toScopeCandidate(scope: t.ConfigScope): t.ScopeCandidate {
  return {
    principalType: scope.principalType as t.ScopePrincipalType,
    principalId: scope.principalId,
    name: scope.name,
    ...(scope.email && { email: scope.email }),
  };
}

/** Whether a principal is the Base document's (`role` `__base__`). */
export function isBasePrincipal(principal: t.ConfigPrincipal): boolean {
  return isSameScope(principal, BASE_PRINCIPAL);
}

/** Whether a scope selection already points at `next` (re-selecting it is a no-op). */
export function isCurrentSelection(current: t.ScopeSelection, next: t.ScopeSelection): boolean {
  if (current.type === 'BASE' || next.type === 'BASE') return current.type === next.type;
  return isSameScope(current.scope, next.scope);
}

/** "Bob Test (bob@test.local)" for a user profile with a known email, else the name. */
export function formatScopeName(scope: Pick<t.ConfigScope, 'name' | 'email'>): string {
  if (!scope.email || scope.email === scope.name) return scope.name;
  return `${scope.name} (${scope.email})`;
}

/**
 * Identities of the entries a profile stores in each list LibreChat merges
 * entry by entry (`endpoints.custom`): the profile stores only the entries it
 * overrides or adds, so each is one override. Lists it replaces whole (model
 * specs) are one override, the list. With them, the settings each entry sets
 * (`overrideEntryPaths`), its name left out.
 */
export function scopeOverrideEntries(
  overrides: t.ConfigRecord,
  features: t.ConfigFeatures = BUNDLED_CONFIG_FEATURES,
): Required<Pick<t.ConfigScope, 'overrideEntries' | 'overrideEntryPaths'>> {
  const overrideEntries: Record<string, string[]> = {};
  const overrideEntryPaths: Record<string, Record<string, string[]>> = {};
  for (const collection of KEYED_COLLECTIONS.values()) {
    if (!mergesByKey(collection, features)) continue;
    const list = getValueAtPath(overrides, collection.path);
    if (!Array.isArray(list)) continue;
    const keys: string[] = [];
    const paths: Record<string, string[]> = {};
    for (const entry of list) {
      const key = getEntryKey(entry, collection.key);
      if (key === undefined || !isConfigRecord(entry)) continue;
      keys.push(key);
      const { [collection.key]: _name, ...settings } = entry;
      paths[key] = [...(paths[key] ?? []), ...collectOverridePaths(settings)];
    }
    if (keys.length === 0) continue;
    overrideEntries[collection.path] = keys;
    overrideEntryPaths[collection.path] = paths;
  }
  return { overrideEntries, overrideEntryPaths };
}

/**
 * What a profile changes, one item per setting: each overridden leaf, each
 * hidden path, each MCP server once however many of its fields are set, and
 * each entry of a list merged by entry (`scopeOverrideEntries`). With
 * `gated` (`appliesGroupHides`), the hides by name of Azure groups another
 * client stored are read by group too.
 */
export function listScopeOverrideItems(
  scope: Pick<t.ConfigScope, 'overridePaths' | 'overrideEntries' | 'tombstones'>,
  gated = false,
): t.ScopeOverrideItem[] {
  const items = new Map<string, t.ScopeOverrideItem>();
  for (const path of scope.overridePaths ?? []) {
    const entries = scope.overrideEntries?.[path];
    if (entries?.length) {
      for (const entry of entries) {
        items.set(`${path}[${entry}]`, { path, paths: [path], hidden: false, entry });
      }
      continue;
    }
    const [section, entry] = path.split('.', 2);
    const itemPath = ENTRY_COUNTED_SECTIONS.has(section) && entry ? `${section}.${entry}` : path;
    const item = items.get(itemPath);
    if (item) item.paths.push(path);
    else items.set(itemPath, { path: itemPath, paths: [path], hidden: false });
  }
  const hidden = (scope.tombstones ?? []).map((path): t.ScopeOverrideItem => {
    const keyed = parseKeyedPath(path, gated);
    if (!keyed) return { path, paths: [path], hidden: true };
    const { collection, key: name, rest } = keyed;
    return {
      path,
      paths: [path],
      hidden: true,
      keyed: { collection: collection.path, name, rest },
    };
  });
  return [...items.values(), ...hidden];
}

/** Number of settings a profile changes (see `listScopeOverrideItems`). */
export function countScopeOverrides(scope: t.ConfigScope): number {
  return listScopeOverrideItems(scope).length;
}

/**
 * Number of settings a config document's overrides change, counted as a
 * profile's are, its tombstones apart. A secret's masked preview stands in
 * for the secret a read withholds, and is not counted beside one it keeps.
 */
export function countDocumentOverrides(
  overrides: t.ConfigRecord,
  features: t.ConfigFeatures = BUNDLED_CONFIG_FEATURES,
): number {
  const paths = collectOverridePaths(overrides);
  const present = new Set(paths);
  const overridePaths = paths.filter(
    (path) => !isSecretPreviewPath(path) || !present.has(path.slice(0, -PREVIEW_SUFFIX.length)),
  );
  return listScopeOverrideItems({
    overridePaths,
    ...scopeOverrideEntries(overrides, features),
  }).length;
}

/** Every path a profile overrides or hides. */
function scopePaths(scope: t.ConfigScope): string[] {
  return [...(scope.overridePaths ?? []), ...(scope.tombstones ?? [])];
}

function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

/** Whether two profiles can both apply to one user (one role and one user profile per user). */
function canCoApply(a: t.ConfigScope, b: t.ConfigScope): boolean {
  return a.principalType !== b.principalType || !SINGLE_MEMBERSHIP_TYPES.has(a.principalType);
}

/**
 * Active profiles with the same priority as `scope` that can apply to the same
 * user, with whether `scope` applies after each (`compareScopePrecedence`).
 * Before `deterministicPrecedence` LibreChat orders profiles by priority
 * only, so for a user both apply to, which value of a setting they both
 * change wins is undefined; with it, the one that applies last wins.
 */
export function findPriorityTies(
  scope: t.ConfigScope,
  scopes: t.ConfigScope[],
): t.ScopePriorityTie[] {
  if (!scope.isActive) return [];
  const own = scopePaths(scope);
  return scopes
    .filter(
      (other) =>
        other.isActive &&
        other.priority === scope.priority &&
        !isSameScope(other, scope) &&
        canCoApply(scope, other),
    )
    .map((other) => {
      const otherPaths = scopePaths(other);
      const shared = own.filter((path) => otherPaths.some((p) => pathsOverlap(path, p)));
      return {
        scope: other,
        sharedPaths: shared,
        appliesAfter: compareScopePrecedence(scope, other) > 0,
      };
    });
}

/** Ancestor paths of `path`, itself included (`a.b.c` → `a`, `a.b`, `a.b.c`). */
function pathPrefixes(path: string): string[] {
  const parts = path.split('.');
  return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
}

/**
 * Indexes profiles by every path they override or hide and each ancestor of
 * it, so a settings row finds the profiles that change it (or something inside
 * it) with one lookup. Profiles are listed in the order they apply, lowest
 * priority first (`compareScopePrecedence`).
 */
export function buildScopeIndex(scopes: t.ConfigScope[]): t.ScopeIndex {
  const ordered = [...scopes].sort(compareScopePrecedence);
  const byPath = new Map<string, t.ConfigScope[]>();
  for (const scope of ordered) {
    const seen = new Set<string>();
    for (const path of scopePaths(scope)) {
      for (const prefix of pathPrefixes(path)) {
        if (seen.has(prefix)) continue;
        seen.add(prefix);
        const list = byPath.get(prefix);
        if (list) list.push(scope);
        else byPath.set(prefix, [scope]);
      }
    }
  }
  return { scopes: ordered, byPath };
}

/** Whether `path` is `entryPath` or inside it. */
function isAtOrUnder(path: string, entryPath: string): boolean {
  return path === entryPath || path.startsWith(`${entryPath}.`);
}

/**
 * The keyed tombstones (`keyedTombstones`) a profile holds for entry
 * `identity` of a list merged by key: whether it hides the entry, and
 * whether it removes values inside it.
 */
function keyedHidesOf(
  scope: t.ConfigScope,
  collection: t.KeyedCollection,
  identity: string,
): t.EntryKeyedHides {
  const result: t.EntryKeyedHides = { hidden: false, inside: false };
  const target = entryIdentityOf(collection, identity);
  for (const path of scope.tombstones ?? []) {
    const keyed = parseKeyedPath(path);
    if (keyed?.collection.path !== collection.path) continue;
    if (entryIdentityOf(collection, keyed.key) !== target) continue;
    if (keyed.rest) result.inside = true;
    else result.hidden = true;
  }
  return result;
}

/** How one profile overrides or hides collection entry `identity`, or null when it doesn't. */
function entryOverrideOf(
  scope: t.ConfigScope,
  collection: string,
  identity: string,
  keyedTombstones: boolean,
): t.EntryOverride | null {
  const stored = scope.storedSecrets ?? [];
  const keyed = getKeyedCollection(collection);
  if (keyed) {
    if (keyed.merge !== 'byKey') return null;
    const secrets = stored.flatMap(({ path, entry }) =>
      entry?.collection === collection && entry.identity === identity ? [path] : [],
    );
    const listed = (scope.overrideEntries?.[collection] ?? []).includes(identity);
    const { hidden, inside } = keyedTombstones
      ? keyedHidesOf(scope, keyed, identity)
      : { hidden: false, inside: false };
    const overrides = secrets.length > 0 || listed || inside;
    if (!overrides && !hidden) return null;
    const settings = scope.overrideEntryPaths?.[collection]?.[identity] ?? [];
    return { scope, overrides, secrets, settings, hidden };
  }
  const entryPath = `${collection}.${identity}`;
  const inside = (path: string) => path.slice(entryPath.length + 1);
  const tombstones = scope.tombstones ?? [];
  const hidden = tombstones.includes(entryPath);
  const settings: string[] = [];
  /** Before `recordSecrets`, LibreChat stores and reads back an MCP secret as a plain value. */
  const secrets = new Set(
    stored.flatMap(({ path, entry }) =>
      !entry && isAtOrUnder(path, entryPath) ? [inside(path)] : [],
    ),
  );
  for (const path of scope.overridePaths ?? []) {
    if (!path.startsWith(`${entryPath}.`)) continue;
    if (isSecretPath(path)) secrets.add(inside(path));
    else settings.push(inside(path));
  }
  const overrides =
    secrets.size > 0 ||
    settings.length > 0 ||
    tombstones.some((path) => path !== entryPath && isAtOrUnder(path, entryPath));
  if (!overrides && !hidden) return null;
  return { scope, overrides, secrets: [...secrets], settings, hidden };
}

/**
 * The profiles that override or hide collection entry `identity` (an MCP
 * server, a custom endpoint) by its name, in the order given, with the
 * secrets of its own each stores there and the settings it sets. Their
 * overrides stay under that name when Base renames or removes the entry.
 */
export function findEntryOverrides(
  scopes: readonly t.ConfigScope[],
  collection: string,
  identity: string,
  keyedTombstones = false,
): t.EntryOverride[] {
  return scopes.flatMap(
    (scope) => entryOverrideOf(scope, collection, identity, keyedTombstones) ?? [],
  );
}

const SCOPE_INDEX_CACHE = new WeakMap<t.ConfigScope[], t.ScopeIndex>();

/** `buildScopeIndex` for a scopes list, built once per list (e.g. per query result). */
export function getScopeIndex(scopes: t.ConfigScope[]): t.ScopeIndex {
  const cached = SCOPE_INDEX_CACHE.get(scopes);
  if (cached) return cached;
  const index = buildScopeIndex(scopes);
  SCOPE_INDEX_CACHE.set(scopes, index);
  return index;
}

/**
 * In a profile, marks the sections that cannot be set per profile so they
 * render as an "edit in Base" card, with no table-of-contents entries for the
 * fields the card replaces; base mode returns `sections` unchanged.
 */
export function applyScopeGates(
  sections: t.ConfigSectionConfig[],
  isEditingScope: boolean,
  rules?: t.ConfigWriteRules,
): t.ConfigSectionConfig[] {
  if (!isEditingScope) return sections;
  return sections.map((section) => {
    const scopeGate = getScopeGateReason(section.schemaKey ?? section.id, rules);
    return scopeGate ? { ...section, scopeGate, tocItems: [] } : section;
  });
}

/** Why a change to `path` is not sent to a profile: its section applies to everyone (PR-7). */
export function scopeGateSkipReason(
  path: string,
  rules?: t.ConfigWriteRules,
): t.SkipReason | undefined {
  const gate = getScopeGateReason(path, rules);
  return gate ? GATE_SKIP_REASONS[gate] : undefined;
}
