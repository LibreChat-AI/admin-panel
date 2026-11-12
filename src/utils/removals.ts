import type * as t from '@/types';
import { holdsSecretAt, isStoredSecretKey, secretKeyForPreviewKey } from './secrets';
import { getEntryKey, findEntryIndex, getKeyedCollection } from './collections';
import { isConfigRecord, getValueAtPath } from './format';

function join(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

/** The secrets of a keyed list's entries, each by its entry's identity. */
function listSecrets(path: string, list: t.ConfigValue[]): t.StoredSecret[] {
  const collection = getKeyedCollection(path);
  if (!collection) return [];
  return list.flatMap((entry) => {
    const identity = getEntryKey(entry, collection.key);
    return identity === undefined ? [] : secretsIn(entry, '', { collection: path, identity });
  });
}

/** The secrets `value` (at `prefix`) stores: those it reads back only as their masked preview. */
function secretsIn(
  value: t.ConfigValue,
  prefix: string,
  entry?: t.StoredSecret['entry'],
): t.StoredSecret[] {
  if (!isConfigRecord(value)) return [];
  const parent = prefix === '' ? undefined : prefix.slice(prefix.lastIndexOf('.') + 1);
  return Object.entries(value).flatMap(([key, child]): t.StoredSecret[] => {
    const secret = secretKeyForPreviewKey(key);
    const isPreview = typeof child === 'string' && child !== '';
    if (secret !== null && isPreview && isStoredSecretKey(parent, secret)) {
      return [{ path: join(prefix, secret), ...(entry && { entry }) }];
    }
    if (Array.isArray(child)) return entry ? [] : listSecrets(join(prefix, key), child);
    return secretsIn(child, join(prefix, key), entry);
  });
}

/** Where a plan's renames (`rename` changes, `renames` hints) move a record entry's secret. */
function movedPaths(path: string, plan: t.WritePlan): string[] {
  const moves = [
    ...plan.renames.map(({ path: record, from, to }) => [record, from, to] as const),
    ...plan.renameHints.map(({ path: record, previousName, name }) => {
      return [record, previousName, name] as const;
    }),
  ];
  return moves.flatMap(([record, from, to]) => {
    const prefix = `${record}.${from}.`;
    return path.startsWith(prefix) ? [`${record}.${to}.${path.slice(prefix.length)}`] : [];
  });
}

/**
 * Whether a plan keeps a stored secret: where it was or where a rename
 * moves it, the target still stores a value or its preview. A list entry
 * keeps its secret while the list still holds the entry (or the entry a
 * rename moves it to): LibreChat keeps a stored key an entry's write omits.
 */
function keepsSecret(secret: t.StoredSecret, plan: t.WritePlan): boolean {
  if (!secret.entry) {
    return [secret.path, ...movedPaths(secret.path, plan)].some((path) =>
      holdsSecretAt(plan.storedAfter, path),
    );
  }
  const { collection, identity } = secret.entry;
  const key = getKeyedCollection(collection)?.key;
  if (key === undefined) return false;
  const renamed = [
    ...plan.renames
      .filter((rename) => rename.path === collection && rename.from === identity)
      .map((rename) => rename.to),
    ...plan.renameHints
      .filter((hint) => hint.path === collection && hint.previousName === identity)
      .map((hint) => hint.name),
  ];
  const list = getValueAtPath(plan.storedAfter, collection);
  return [identity, ...renamed].some((name) => findEntryIndex(list, key, name) >= 0);
}

/** The secrets a stored config document holds: those its redacted read shows only as a masked preview. */
export function findStoredSecrets(stored: t.ConfigRecord): t.StoredSecret[] {
  return secretsIn(stored, '');
}

/**
 * The stored secrets a plan takes away (WS1): every secret the target
 * stores (`stored`, where the redacted read shows only its masked preview)
 * that the target no longer stores once the plan is applied. The review
 * names each one (`useChangeReview`), whatever change removes it.
 */
export function findRemovedSecrets(stored: t.ConfigRecord, plan: t.WritePlan): t.StoredSecret[] {
  return findStoredSecrets(stored).filter((secret) => !keepsSecret(secret, plan));
}
