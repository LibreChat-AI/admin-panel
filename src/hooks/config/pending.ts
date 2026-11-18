import { useId, useRef, useState, useContext, useCallback, useLayoutEffect } from 'react';
import type * as t from '@/types';
import { DraftsContext } from '@/contexts/DraftsContext';

/** Keep local input registered before another session check can replace the page. */
export function useSessionDraft(dirty: boolean): t.ConfigDraftContextValue | null {
  const context = useContext(DraftsContext);
  const register = context?.registerDraft;
  const id = useId();
  useLayoutEffect(() => {
    register?.(id, dirty);
    return () => register?.(id, false);
  }, [register, id, dirty]);
  return context;
}

/** Count draft owners without copying their input out of its component. */
export function useSessionDrafts(): t.ConfigDraftsState {
  const pending = useRef(new Set<string>());
  const [hasPendingDrafts, setHasPendingDrafts] = useState(false);
  const registerDraft = useCallback((id: string, dirty: boolean) => {
    if (dirty) pending.current.add(id);
    else pending.current.delete(id);
    setHasPendingDrafts(pending.current.size > 0);
  }, []);
  return { hasPendingDrafts, registerDraft };
}

/** Keep the current editor mounted until its local drafts are committed or discarded. */
export function useDraftBaseline<T>(value: T, pending: boolean): T {
  const baseline = useRef(value);
  if (!pending) baseline.current = value;
  return baseline.current;
}
