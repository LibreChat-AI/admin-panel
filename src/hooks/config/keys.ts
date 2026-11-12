import { useRef } from 'react';
import type * as t from '@/types';

/**
 * Keys of a reordered list: when every item of `next` is an item of `prev`
 * moved elsewhere (same identity, or the same reference where it has none),
 * each keeps its key; otherwise `null`.
 */
function reorderedKeys<T>(
  prev: readonly T[],
  prevKeys: readonly string[],
  next: readonly T[],
  identity: (item: T) => string | null,
): string[] | null {
  const slots = new Map<string | T, number[]>();
  for (let i = 0; i < prev.length; i++) {
    const slot = identity(prev[i]) ?? prev[i];
    const list = slots.get(slot);
    if (list) list.push(i);
    else slots.set(slot, [i]);
  }
  let moved = false;
  const keys: string[] = [];
  for (let i = 0; i < next.length; i++) {
    const match = slots.get(identity(next[i]) ?? next[i])?.shift();
    if (match === undefined) return null;
    if (match !== i) moved = true;
    keys.push(prevKeys[match]);
  }
  return moved ? keys : null;
}

/**
 * Carries React keys from `prev` to `next` items: a reorder moves each key
 * with its item; otherwise the same length keeps keys by position (in-place
 * edits, renames); otherwise an item reuses the key of an unused previous
 * item that is the same reference or has the same identity, and anything
 * else gets a fresh key. Reordering, removing, appending or reloading a list
 * therefore never remounts (or collapses, or swaps the state of) the entries
 * that stayed.
 */
export function reconcileKeys<T>(
  prev: readonly T[],
  prevKeys: readonly string[],
  next: readonly T[],
  identity: (item: T) => string | null,
  createKey: () => string,
): string[] {
  if (prev.length === next.length && prevKeys.length === prev.length) {
    return reorderedKeys(prev, prevKeys, next, identity) ?? [...prevKeys];
  }
  const used = new Set<number>();
  const byIdentity = new Map<string, number[]>();
  for (let i = 0; i < prev.length; i++) {
    const id = identity(prev[i]);
    if (id == null) continue;
    const slots = byIdentity.get(id);
    if (slots) slots.push(i);
    else byIdentity.set(id, [i]);
  }
  const takeMatch = (item: T): number => {
    const sameRef = prev.findIndex((p, i) => !used.has(i) && Object.is(p, item));
    if (sameRef !== -1) return sameRef;
    const id = identity(item);
    const slots = id == null ? undefined : byIdentity.get(id);
    return slots?.find((i) => !used.has(i)) ?? -1;
  };
  return next.map((item) => {
    const match = takeMatch(item);
    if (match === -1 || prevKeys[match] == null) return createKey();
    used.add(match);
    return prevKeys[match];
  });
}

/** Stable React keys for a list whose items can be added, removed, edited and renamed. */
export function useListKeys<T>({
  items,
  identity,
  prefix = 'item',
}: t.ListKeysOptions<T>): string[] {
  const counterRef = useRef(0);
  const stateRef = useRef<{ items: readonly T[]; keys: string[] } | null>(null);
  const createKey = () => `${prefix}-${counterRef.current++}`;
  const state = stateRef.current;
  if (!state) {
    const keys = items.map(createKey);
    stateRef.current = { items, keys };
    return keys;
  }
  if (state.items === items) return state.keys;
  const keys = reconcileKeys(state.items, state.keys, items, identity, createKey);
  stateRef.current = { items, keys };
  return keys;
}
