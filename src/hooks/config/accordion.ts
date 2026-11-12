import { useCallback, useEffect, useRef, useState } from 'react';
import type * as t from '@/types';
import { useExpandableState, useRevealingFilter } from './expand';

const STORAGE_PREFIX = 'librechat-admin:open:';

/** The ids stored as open under a key; empty when storage is unavailable or holds junk. */
function readOpenIds(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
    const parsed: t.ConfigValue = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function writeOpen(storageKey: string, id: string, open: boolean): void {
  try {
    const ids = readOpenIds(storageKey);
    if (open === ids.has(id)) return;
    if (open) ids.add(id);
    else ids.delete(id);
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify([...ids]));
  } catch {
    return;
  }
}

/** Ids closed by the admin that open by default (kept apart, so other defaults still apply). */
function readClosedIds(storageKey: string): Set<string> {
  return readOpenIds(`${storageKey}:closed`);
}

/** Whether `id` was left open under `storageKey`; a default-open id unless it was closed. */
export function readStoredExpanded(storageKey: string, id: string, defaultOpen: boolean): boolean {
  if (readOpenIds(storageKey).has(id)) return true;
  return defaultOpen && !readClosedIds(storageKey).has(id);
}

/**
 * A collapsible whose open state is remembered per tab (AP-8): it starts
 * collapsed (or `defaultExpanded`) on the first visit, then as the admin left
 * it, also after switching tabs. Expand all / Collapse all, the tab filter
 * and deep links (`config:expand`) still apply; while the filter holds it
 * open, nothing is remembered. Storage can be unavailable (private mode,
 * blocked site data); the state then lasts until the tab unmounts.
 */
export function usePersistentExpanded({
  storageKey,
  id,
  defaultExpanded = false,
  revealPaths,
}: t.PersistentExpandedOptions): t.PersistentExpanded {
  const [initial] = useState(() => readStoredExpanded(storageKey, id, defaultExpanded));
  const [isExpanded, setIsExpanded] = useExpandableState(initial, revealPaths);
  const [hasEverExpanded, setHasEverExpanded] = useState(isExpanded);
  const filter = useRevealingFilter(revealPaths);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (isExpanded && !hasEverExpanded) setHasEverExpanded(true);
  }, [isExpanded, hasEverExpanded]);

  useEffect(() => {
    if (filter) return;
    writeOpen(storageKey, id, isExpanded);
    writeOpen(`${storageKey}:closed`, id, defaultExpanded && !isExpanded);
  }, [filter, storageKey, id, isExpanded, defaultExpanded]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const expand = () => setIsExpanded(true);
    const collapse = () => setIsExpanded(false);
    el.addEventListener('config:expand', expand);
    el.addEventListener('config:collapse', collapse);
    return () => {
      el.removeEventListener('config:expand', expand);
      el.removeEventListener('config:collapse', collapse);
    };
  }, [setIsExpanded]);

  const toggle = useCallback(() => setIsExpanded((prev) => !prev), [setIsExpanded]);

  return { isExpanded, hasEverExpanded, sectionRef, toggle };
}
