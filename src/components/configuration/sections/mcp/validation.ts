import type * as t from '@/types';
import { transportOf } from './transport';
import { isSecretPath } from '@/utils';

/** The missing field reported for an admin API key with no key, typed or stored. */
export const ADMIN_API_KEY_FIELD = 'apiKey.key';

const ENTRY_PREFIX = 'mcpServers.';
const PREVIEW_SUFFIX = 'Preview';

export const REQUIRED_BY_TRANSPORT: Record<string, Set<string>> = {
  stdio: new Set(['command', 'args']),
  sse: new Set(['url']),
  'streamable-http': new Set(['url']),
  http: new Set(['url']),
  websocket: new Set(['url']),
};

export function setLeaf(
  target: Record<string, t.ConfigValue>,
  segments: string[],
  value: t.ConfigValue,
): void {
  let cursor: Record<string, t.ConfigValue> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!isPlainObject(cursor[seg])) cursor[seg] = {};
    cursor = cursor[seg] as Record<string, t.ConfigValue>;
  }
  const leaf = segments[segments.length - 1];
  if (value === undefined) delete cursor[leaf];
  else cursor[leaf] = value;
}

export function deepClone(value: Record<string, t.ConfigValue>): Record<string, t.ConfigValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, t.ConfigValue>;
}

export function isPlainObject(value: t.ConfigValue): value is Record<string, t.ConfigValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** New entry names are blocked from containing dots, but legacy data may still hold dotted server names; longest-prefix match against known keys keeps those edits attributed to the real entry instead of carving off the first segment. */
export function resolveEntryKey(
  rest: string,
  knownKeys: Iterable<string>,
): { entryKey: string; segments: string[] } | null {
  if (rest === '') return null;
  let best: string | null = null;
  for (const key of knownKeys) {
    if (rest === key || rest.startsWith(`${key}.`)) {
      if (best === null || key.length > best.length) best = key;
    }
  }
  if (best !== null) {
    const remainder = rest.length > best.length ? rest.slice(best.length + 1) : '';
    return { entryKey: best, segments: remainder === '' ? [] : remainder.split('.') };
  }
  const dotIdx = rest.indexOf('.');
  if (dotIdx === -1) return { entryKey: rest, segments: [] };
  return { entryKey: rest.slice(0, dotIdx), segments: rest.slice(dotIdx + 1).split('.') };
}

function lookupLeaf(value: t.ConfigValue, segments: string[]): t.ConfigValue {
  let cursor = value;
  for (const segment of segments) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/** Merges leaf edits onto the baseline MCP entries (omitting deleted entries) so callers can validate the post-save state. `resetFallback`, when provided, supplies the value that an `undefined` leaf write would reveal after the actual save (e.g. in scope mode, a leaf reset removes the scope override and exposes the inherited base value). */
function mergeMcpEdits(
  baseline: Record<string, t.ConfigValue>,
  edits: Array<[string, t.ConfigValue]>,
  resetFallback?: Record<string, t.ConfigValue>,
): Record<string, t.ConfigValue> {
  const baseEntries: Record<string, Record<string, t.ConfigValue>> = {};
  for (const [k, v] of Object.entries(baseline)) {
    if (isPlainObject(v)) baseEntries[k] = JSON.parse(JSON.stringify(v));
  }
  const knownKeys = new Set(Object.keys(baseEntries));
  const deletedEntries = new Set<string>();
  const upsertEntries: Record<string, Record<string, t.ConfigValue>> = {};
  const removedSecrets = new Map<string, Set<string>>();

  for (const [path, value] of edits) {
    if (!path.startsWith(ENTRY_PREFIX)) continue;
    const parsed = resolveEntryKey(path.slice(ENTRY_PREFIX.length), knownKeys);
    if (!parsed) continue;
    const { entryKey, segments } = parsed;
    knownKeys.add(entryKey);
    if (segments.length === 0) {
      if (value === undefined) {
        const fallback = resetFallback?.[entryKey];
        if (isPlainObject(fallback)) {
          upsertEntries[entryKey] = JSON.parse(JSON.stringify(fallback));
          deletedEntries.delete(entryKey);
        } else {
          deletedEntries.add(entryKey);
          delete upsertEntries[entryKey];
          delete baseEntries[entryKey];
        }
      } else if (isPlainObject(value)) {
        upsertEntries[entryKey] = JSON.parse(JSON.stringify(value));
        deletedEntries.delete(entryKey);
      }
      continue;
    }
    if (deletedEntries.has(entryKey) && value !== undefined) {
      deletedEntries.delete(entryKey);
    }
    if (!upsertEntries[entryKey]) {
      /** Clone on promote so subsequent setLeaf mutations don't bleed into baseEntries; the assembly loop relies on baseEntries staying intact for entries that never received an upsert. */
      const seed = baseEntries[entryKey];
      upsertEntries[entryKey] = seed ? deepClone(seed) : {};
    }
    if (value === undefined) {
      resetLeaf(upsertEntries[entryKey], segments, resetFallback?.[entryKey]);
      const removed = removedSecrets.get(entryKey) ?? new Set<string>();
      removedSecrets.set(entryKey, removed.add(segments.join('.')));
    } else {
      setLeaf(upsertEntries[entryKey], segments, value);
    }
  }

  const result: Record<string, t.ConfigValue> = {};
  for (const [k, v] of Object.entries(baseEntries)) {
    if (deletedEntries.has(k)) continue;
    if (k in upsertEntries) continue;
    result[k] = v;
  }
  for (const [k, v] of Object.entries(upsertEntries)) {
    if (deletedEntries.has(k)) continue;
    result[k] = keepStoredPreviews(baseline[k], v, removedSecrets.get(k));
  }
  return result;
}

/** The secret a leaf is the masked preview of (`apiKey.keyPreview` → `apiKey.key`), else null. */
export function previewedSecret(segments: string[]): string | null {
  const last = segments[segments.length - 1];
  if (!last.endsWith(PREVIEW_SUFFIX) || last === PREVIEW_SUFFIX) return null;
  const secret = [...segments.slice(0, -1), last.slice(0, -PREVIEW_SUFFIX.length)].join('.');
  return isSecretPath(secret) ? secret : null;
}

/**
 * Secrets a server stores encrypted (`apiKey.key`, `oauth.client_secret`):
 * the admin API returns only their masked preview, never the secret itself,
 * so a copy or a rename (a new server) can't carry them over.
 */
export function storedSecrets(entry: t.ConfigValue): string[] {
  if (!isPlainObject(entry)) return [];
  const walk = (value: Record<string, t.ConfigValue>, prefix: string[]): string[] =>
    Object.entries(value).flatMap(([key, child]) => {
      const segments = [...prefix, key];
      if (isPlainObject(child)) return walk(child, segments);
      const secret = previewedSecret(segments);
      if (secret == null || typeof child !== 'string' || child === '') return [];
      return lookupLeaf(entry, secret.split('.')) == null ? [secret] : [];
    });
  return walk(entry, []);
}

function hasText(value: t.ConfigValue | undefined): boolean {
  return typeof value === 'string' && value !== '';
}

/** Where a secret's masked preview is kept beside it (`apiKey.key` → `apiKey.keyPreview`). */
function previewSegments(secret: string): string[] {
  const segments = secret.split('.');
  return [...segments.slice(0, -1), `${segments[segments.length - 1]}${PREVIEW_SUFFIX}`];
}

/**
 * Writes what removing a server's own value at `segments` leaves: the value
 * of the layer beneath (`below`), and for a secret its masked preview there
 * too, as LibreChat removes a secret with its preview.
 */
export function resetLeaf(
  target: Record<string, t.ConfigValue>,
  segments: string[],
  below: t.ConfigValue,
): void {
  setLeaf(target, segments, lookupLeaf(below, segments));
  if (!isSecretPath(segments.join('.'))) return;
  const preview = previewSegments(segments.join('.'));
  setLeaf(target, preview, lookupLeaf(below, preview));
}

/**
 * `next` (a server as a save leaves it) with the masked preview of each
 * secret `saved` stores, in each holder (`apiKey`, `oauth`) `next` still
 * writes without entering that secret: LibreChat keeps a stored secret the
 * written object omits, so the server still has it after the save. A secret
 * the edits remove themselves (`removed`, by its path in the server) goes.
 */
export function keepStoredPreviews(
  saved: t.ConfigValue,
  next: t.ConfigValue,
  removed: ReadonlySet<string> = new Set(),
): t.ConfigValue {
  if (!isPlainObject(next)) return next;
  const kept = storedSecrets(saved).filter((secret) => {
    const segments = secret.split('.');
    return (
      !removed.has(secret) &&
      isPlainObject(lookupLeaf(next, segments.slice(0, -1))) &&
      !hasText(lookupLeaf(next, segments)) &&
      !hasText(lookupLeaf(next, previewSegments(secret)))
    );
  });
  if (kept.length === 0) return next;
  const result = deepClone(next);
  for (const secret of kept) {
    const preview = previewSegments(secret);
    setLeaf(result, preview, lookupLeaf(saved, preview));
  }
  return result;
}

/**
 * Whether an entry still configures the setting a secret belongs to: the
 * secret's object is still there (authentication not switched to None or to
 * another method), and an API key is still one the admin provides.
 */
export function usesSecret(entry: t.ConfigValue, secret: string): boolean {
  const owner = lookupLeaf(entry, secret.split('.').slice(0, -1));
  if (!isPlainObject(owner)) return false;
  return secret !== ADMIN_API_KEY_FIELD || owner.source !== 'user';
}

/** The first stored secret of the server an entry was renamed from that the entry still uses but neither re-enters nor still stores. */
function lostSecret(entry: Record<string, t.ConfigValue>, original: t.ConfigValue): string | null {
  const lost = storedSecrets(original).find(
    (secret) =>
      usesSecret(entry, secret) &&
      !hasText(lookupLeaf(entry, secret.split('.'))) &&
      !hasText(lookupLeaf(entry, previewSegments(secret))),
  );
  return lost ?? null;
}

/** Returns a list of validation errors for affected MCP entries after applying edits, so the save flow can block invalid transport-state combinations the per-leaf PATCH cannot catch. `resetFallback` is the inherited baseline (e.g. base config in scope mode) whose values get revealed when a scope reset removes an override. `renames` (`mcpServers.new` → `mcpServers.saved`) marks renamed servers: a secret the saved one stores can't move to the new name, so it must be entered again (`renamedFrom` is set on that error). Servers in `carried` get the secrets of the server they were renamed or duplicated from on save (`getSecretCarry`), so they need none entered. */
export function validateMcpCrossField(
  baseline: Record<string, t.ConfigValue>,
  edits: Array<[string, t.ConfigValue]>,
  resetFallback?: Record<string, t.ConfigValue>,
  renames: Readonly<Record<string, string>> = {},
  carried: ReadonlySet<string> = new Set(),
): t.McpCrossFieldError[] {
  const merged = mergeMcpEdits(baseline, edits, resetFallback);
  const knownKeys = new Set(Object.keys(baseline));
  const affected = new Set<string>();
  /** New servers, and servers whose API key (or its source) was set: they must carry an admin key. */
  const keyChecked = new Set<string>();
  for (const [path] of edits) {
    if (!path.startsWith(ENTRY_PREFIX)) continue;
    const parsed = resolveEntryKey(path.slice(ENTRY_PREFIX.length), knownKeys);
    if (parsed) {
      knownKeys.add(parsed.entryKey);
      affected.add(parsed.entryKey);
      const [head, child] = parsed.segments;
      const setsKey = head === 'apiKey' && (child === undefined || child === 'source');
      if (setsKey || !Object.hasOwn(baseline, parsed.entryKey)) keyChecked.add(parsed.entryKey);
    }
  }
  const errors: t.McpCrossFieldError[] = [];
  for (const entryKey of affected) {
    const entry = merged[entryKey];
    if (!isPlainObject(entry)) continue;
    const isCarried = carried.has(entryKey);
    const missingField =
      missingTransportField(entry, baseline[entryKey]) ??
      (keyChecked.has(entryKey) && !isCarried && lacksAdminKey(entry) ? ADMIN_API_KEY_FIELD : null);
    if (missingField) {
      errors.push({ entryKey, missingField });
      continue;
    }
    if (isCarried) continue;
    const original = renames[`${ENTRY_PREFIX}${entryKey}`]?.slice(ENTRY_PREFIX.length);
    const lost = original === undefined ? null : lostSecret(entry, baseline[original]);
    if (lost) errors.push({ entryKey, missingField: lost, renamedFrom: original });
  }
  return errors;
}

/** The first field the entry's transport requires that it lacks. */
function missingTransportField(
  entry: Record<string, t.ConfigValue>,
  saved: t.ConfigValue,
): string | null {
  /** Clearing the field a type-less entry's transport is inferred from (a stdio `command`) leaves no transport: the saved entry's still applies, so the missing command is caught. */
  const transport = transportOf(entry) || transportOf(saved);
  const required = REQUIRED_BY_TRANSPORT[transport];
  if (!required) return null;
  for (const field of required) {
    const v = entry[field];
    /** Empty array is a valid Zod value for required array fields like stdio `args` (the schema requires presence, not non-empty). Don't flag it as missing. */
    if (v === undefined || v === null || v === '') return field;
  }
  return null;
}

/**
 * An API key the admin provides for everyone, with no key: neither typed nor
 * already stored (the admin API returns a stored key as its masked
 * `keyPreview`). A duplicate never copies a stored key, so it needs one again.
 */
function lacksAdminKey(entry: Record<string, t.ConfigValue>): boolean {
  const apiKey = entry.apiKey;
  if (!isPlainObject(apiKey) || apiKey.source !== 'admin') return false;
  const isSet = (value: t.ConfigValue) => typeof value === 'string' && value !== '';
  return !isSet(apiKey.key) && !isSet(apiKey.keyPreview);
}
