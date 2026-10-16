import { useState, useMemo, useCallback, startTransition } from 'react';
import type * as t from '@/types';
import { applyConfigEdit } from '@/components/configuration/edits';

/** Pending edits of the open target (base or a profile) and the handlers that change them (WS1). */
export function useConfigEdits({
  isEditingScope,
  flatBaseline,
  scopeResolvedValues,
  baseActiveConfigValues,
}: t.ConfigEditsOptions): t.ConfigEditsState {
  const [editedValues, setEditedValues] = useState<t.FlatConfigMap>({});
  const [touchedPaths, setTouchedPaths] = useState<Set<string>>(() => new Set());
  const [editSessionId, setEditSessionId] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  const scopeBaseline = useMemo(() => {
    if (!isEditingScope) return flatBaseline;
    return scopeResolvedValues ?? {};
  }, [isEditingScope, flatBaseline, scopeResolvedValues]);

  /** Container paths inferred from leaf baselines, used to tell apart subtree-deletes from no-op writes. */
  const baselineIntermediates = useMemo(() => {
    const set = new Set<string>();
    for (const leaf of Object.keys(scopeBaseline)) {
      const parts = leaf.split('.');
      for (let i = 1; i < parts.length; i++) {
        set.add(parts.slice(0, i).join('.'));
      }
    }
    return set;
  }, [scopeBaseline]);

  /** Container paths walked directly off the structured config, so an orphaned `{}` entry whose flatten dropped (or never produced) any leaf is still recognized as a real subtree-delete target. */
  const baselineContainerPaths = useMemo(() => {
    const set = new Set<string>();
    const walk = (obj: unknown, prefix: string): void => {
      if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return;
      for (const k of Object.keys(obj as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${k}` : k;
        const v = (obj as Record<string, unknown>)[k];
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          set.add(path);
          walk(v, path);
        }
      }
    };
    walk(baseActiveConfigValues, '');
    return set;
  }, [baseActiveConfigValues]);

  const handleFieldChange = useCallback(
    (path: string, value: t.ConfigValue) => {
      setSaveError(null);
      setTouchedPaths((prev) => {
        if (prev.has(path)) return prev;
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      setEditedValues((prev) => {
        return applyConfigEdit(
          prev,
          path,
          value,
          scopeBaseline,
          baselineIntermediates,
          baselineContainerPaths,
        );
      });
    },
    [scopeBaseline, baselineIntermediates, baselineContainerPaths],
  );

  /**
   * Removes `path` from `editedValues`/`touchedPaths` directly, bypassing
   * `applyConfigEdit`'s baseline-match diffing. Abandoning an in-progress
   * SecretField replacement (Cancel) is never a real edit — representing it
   * as `onChange(path, undefined)` would mean the same thing as a real reset
   * whenever a scope-resolved baseline happens to also read as empty.
   */
  const handleDiscardField = useCallback((path: string) => {
    setEditedValues((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setTouchedPaths((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const isDirty = Object.keys(editedValues).length > 0;

  const pendingResets = useMemo(() => {
    const resets = new Set<string>();
    for (const [k, v] of Object.entries(editedValues)) {
      if (v === undefined) resets.add(k);
    }
    return resets;
  }, [editedValues]);

  const handleResetField = useCallback((fieldPath: string) => {
    setSaveError(null);
    startTransition(() => {
      setTouchedPaths((prev) => {
        if (prev.has(fieldPath)) return prev;
        const next = new Set(prev);
        next.add(fieldPath);
        return next;
      });
      setEditedValues((prev) => ({ ...prev, [fieldPath]: undefined }));
    });
  }, []);

  const discardEdits = useCallback(() => {
    setEditedValues({});
    setTouchedPaths(new Set());
  }, []);

  const startNewSession = useCallback(() => setEditSessionId((id) => id + 1), []);

  const resetEdits = useCallback(() => {
    discardEdits();
    startNewSession();
  }, [discardEdits, startNewSession]);

  const handleDiscard = useCallback(() => {
    resetEdits();
    setSaveError(null);
  }, [resetEdits]);

  return {
    editedValues,
    touchedPaths,
    pendingResets,
    editSessionId,
    isDirty,
    saveError,
    setSaveError,
    handleFieldChange,
    handleResetField,
    handleDiscardField,
    discardEdits,
    startNewSession,
    resetEdits,
    handleDiscard,
  };
}
