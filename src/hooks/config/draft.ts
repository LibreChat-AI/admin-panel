import { useCallback, useEffect, useRef, useState } from 'react';
import type * as t from '@/types';
import { useSessionDraft } from './pending';

/** Commit delay while typing: edits register (and mark the page dirty) without waiting for blur. */
export const DRAFT_COMMIT_DELAY = 300;

/**
 * Local draft of a field value that commits to the page `delay` ms after the
 * last keystroke, and immediately on `commit()` (blur, Enter). External value
 * changes (discard, save, reset) replace the draft. Recovery refetches keep
 * unfinished input. A pending commit is
 * flushed on unmount so a tab switch mid-typing keeps the edit.
 *
 * `onCommit` may return `false` to reject a draft (e.g. a cleared required
 * field; it stays local and uncommitted), or `'reset'` to drop the draft and
 * show the current value again (e.g. clearing a value the target does not own).
 */
export function useDraftValue<T>({
  value,
  onCommit,
  delay = DRAFT_COMMIT_DELAY,
  autoCommit,
}: t.DraftValueOptions<T>): t.DraftValue<T> {
  const [draft, setDraftState] = useState<T>(value);
  const recovery = useSessionDraft(!Object.is(draft, value));
  const committedRef = useRef<T>(value);
  const draftRef = useRef<T>(value);
  const onCommitRef = useRef(onCommit);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef(recovery?.editSessionId);
  const preserveRef = useRef(false);
  const blockedRef = useRef(false);
  blockedRef.current = recovery?.blocked === true;
  if (blockedRef.current && !Object.is(draftRef.current, committedRef.current)) {
    preserveRef.current = true;
  }
  onCommitRef.current = onCommit;

  const clearTimer = () => {
    if (timerRef.current == null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    const reset = sessionRef.current !== recovery?.editSessionId;
    sessionRef.current = recovery?.editSessionId;
    const preserve = preserveRef.current && !reset;
    if (reset) preserveRef.current = false;
    if (!reset && Object.is(value, committedRef.current)) return;
    clearTimer();
    committedRef.current = value;
    if (preserve) return;
    draftRef.current = value;
    setDraftState(value);
  }, [value, recovery?.editSessionId, recovery?.blocked]);

  const commit = useCallback(() => {
    clearTimer();
    if (blockedRef.current) return;
    const next = draftRef.current;
    if (Object.is(next, committedRef.current)) {
      preserveRef.current = false;
      return;
    }
    const result = onCommitRef.current(next);
    if (result === false) return;
    preserveRef.current = false;
    if (result === 'reset') {
      draftRef.current = committedRef.current;
      setDraftState(committedRef.current);
      return;
    }
    committedRef.current = next;
  }, []);

  const setDraft = useCallback(
    (next: T) => {
      draftRef.current = next;
      setDraftState(next);
      clearTimer();
      if (delay <= 0 || (autoCommit && !autoCommit(next))) return;
      timerRef.current = setTimeout(commit, delay);
    },
    [autoCommit, commit, delay],
  );

  useEffect(
    () => () => {
      if (timerRef.current != null) commit();
    },
    [commit],
  );

  return { draft, setDraft, commit };
}
