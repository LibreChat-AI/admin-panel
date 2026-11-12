import { useState, useMemo, useCallback, startTransition } from 'react';
import type * as t from '@/types';
import {
  applyConfigEdit,
  hasEffectiveEdits,
  normalizeEditValue,
  trackCollectionEdit,
} from '@/components/configuration/edits';
import { findSchemaField } from '@/components/configuration/controls';
import { credentialKey, getValueAtPath } from '@/utils';

const NO_EDITS: t.PendingEdits = {
  values: {},
  collections: {},
  baselines: {},
  visibility: {},
  renames: {},
  copies: {},
  restates: {},
};

/** `restored` put back over `current`: its values win, and its baselines are the first ones recorded. */
function mergePending(current: t.PendingEdits, restored: t.PendingEdits): t.PendingEdits {
  return {
    values: { ...current.values, ...restored.values },
    collections: { ...current.collections, ...restored.collections },
    baselines: { ...current.baselines, ...restored.baselines },
    visibility: { ...current.visibility, ...restored.visibility },
    renames: { ...current.renames, ...restored.renames },
    copies: { ...current.copies, ...restored.copies },
    restates: { ...current.restates, ...restored.restates },
  };
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/** Pending edits of the open target (base or a profile) and the handlers that change them (WS1). */
export function useConfigEdits({
  isEditingScope,
  flatBaseline,
  scopeResolvedValues,
  baseActiveConfigValues,
  schemaTree,
  schemaPathSet,
}: t.ConfigEditsOptions): t.ConfigEditsState {
  const [pending, setPending] = useState<t.PendingEdits>(NO_EDITS);
  const [touchedPaths, setTouchedPaths] = useState<Set<string>>(() => new Set());
  const [editSessionId, setEditSessionId] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editedValues = pending.values;

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

  /** Compares edits with the saved value as Save would store it (SV-6). */
  const structuredBaseline = useMemo<t.EditBaseline | undefined>(() => {
    if (!schemaTree || !schemaPathSet) return undefined;
    return {
      root: baseActiveConfigValues,
      isArrayPath: (path) => findSchemaField(schemaTree, path)?.isArray === true,
      normalize: (path, value) => normalizeEditValue(path, value, schemaTree, schemaPathSet),
    };
  }, [baseActiveConfigValues, schemaTree, schemaPathSet]);

  const touch = useCallback((path: string) => {
    setTouchedPaths((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, []);

  const handleFieldChange = useCallback(
    (path: string, value: t.ConfigValue) => {
      setSaveError(null);
      touch(path);
      setPending((prev) => ({
        ...prev,
        collections: trackCollectionEdit(
          prev.collections,
          prev.values,
          path,
          value,
          baseActiveConfigValues,
        ),
        baselines:
          path in prev.baselines
            ? prev.baselines
            : { ...prev.baselines, [path]: getValueAtPath(baseActiveConfigValues, path) },
        values: applyConfigEdit(
          prev.values,
          path,
          value,
          scopeBaseline,
          baselineIntermediates,
          baselineContainerPaths,
          structuredBaseline,
        ),
      }));
    },
    [
      touch,
      baseActiveConfigValues,
      scopeBaseline,
      baselineIntermediates,
      baselineContainerPaths,
      structuredBaseline,
    ],
  );

  /**
   * Removes `path` from `editedValues`/`touchedPaths` (and a pending
   * Hide/Unhide of it, so a row's Undo covers both) directly, bypassing
   * `applyConfigEdit`'s baseline-match diffing. Abandoning an in-progress
   * SecretField replacement (Cancel) is never a real edit — representing it
   * as `onChange(path, undefined)` would mean the same thing as a real reset
   * whenever a scope-resolved baseline happens to also read as empty.
   */
  const handleDiscardField = useCallback((path: string) => {
    setPending((prev) => {
      if (!(path in prev.values) && !(path in prev.visibility)) return prev;
      return {
        ...prev,
        values: withoutKey(prev.values, path),
        visibility: withoutKey(prev.visibility, path),
      };
    });
    setTouchedPaths((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const isDirty = useMemo(
    () =>
      Object.keys(pending.visibility).length > 0 ||
      Object.keys(pending.restates).length > 0 ||
      hasEffectiveEdits(editedValues, structuredBaseline),
    [pending.visibility, pending.restates, editedValues, structuredBaseline],
  );

  const pendingResets = useMemo(() => {
    const resets = new Set<string>();
    for (const [k, v] of Object.entries(editedValues)) {
      if (v === undefined) resets.add(k);
    }
    return resets;
  }, [editedValues]);

  const handleResetField = useCallback(
    (fieldPath: string) => {
      setSaveError(null);
      startTransition(() => {
        touch(fieldPath);
        setPending((prev) => ({
          ...prev,
          baselines:
            fieldPath in prev.baselines
              ? prev.baselines
              : {
                  ...prev.baselines,
                  [fieldPath]: getValueAtPath(baseActiveConfigValues, fieldPath),
                },
          values: { ...prev.values, [fieldPath]: undefined },
        }));
      });
    },
    [touch, baseActiveConfigValues],
  );

  const setVisibility = useCallback((path: string, edit: t.VisibilityEdit) => {
    setSaveError(null);
    setPending((prev) => {
      const visibility =
        prev.visibility[path] !== undefined && prev.visibility[path] !== edit
          ? withoutKey(prev.visibility, path)
          : { ...prev.visibility, [path]: edit };
      return { ...prev, visibility };
    });
  }, []);

  const handleHideField = useCallback(
    (path: string) => setVisibility(path, 'hide'),
    [setVisibility],
  );
  const handleUnhideField = useCallback(
    (path: string) => setVisibility(path, 'unhide'),
    [setVisibility],
  );

  /**
   * A rename of a renamed (or duplicated) entry still points at the saved
   * entry it started from, and a duplicate at the saved entry its source is;
   * `to: null` drops the record of `from`, and so does a rename back onto
   * the saved entry it started from (no rename is left).
   */
  const handleRenameEntry = useCallback((from: string, to: string | null, copy = false) => {
    setPending((prev) => {
      const source = prev.renames[from] ?? prev.copies[from] ?? from;
      if (copy && to !== null) return { ...prev, copies: { ...prev.copies, [to]: source } };
      const renames = withoutKey(prev.renames, from);
      const copies = withoutKey(prev.copies, from);
      if (to === null || to === source) return { ...prev, renames, copies };
      if (from in prev.copies) return { ...prev, renames, copies: { ...copies, [to]: source } };
      return { ...prev, renames: { ...renames, [to]: source }, copies };
    });
  }, []);

  /** Restates an inherited credential the target's overrides move (a `restate` change), or takes that back. */
  const handleRestateCredential = useCallback((ref: t.CredentialRef, restated: boolean) => {
    const key = credentialKey(ref);
    setPending((prev) => {
      if (!restated) return { ...prev, restates: withoutKey(prev.restates, key) };
      return { ...prev, restates: { ...prev.restates, [key]: ref } };
    });
  }, []);

  const discardEdits = useCallback(() => {
    setPending(NO_EDITS);
    setTouchedPaths(new Set());
  }, []);

  /** A new edit session (another scope opened) never carries pending edits over, not even blank drafts. */
  const startNewSession = useCallback(() => {
    discardEdits();
    setEditSessionId((id) => id + 1);
  }, [discardEdits]);

  const resetEdits = startNewSession;

  const handleDiscard = useCallback(() => {
    resetEdits();
    setSaveError(null);
  }, [resetEdits]);

  const snapshot = useMemo<t.EditsSnapshot>(
    () => ({ pending, touched: touchedPaths }),
    [pending, touchedPaths],
  );

  /**
   * Puts a snapshot's edits back in one update, as they were: replaying them
   * one by one would lose what renamed and duplicated entries carry, and
   * would mix a deferred removal with immediate writes.
   */
  const handleRestoreEdits = useCallback((restored: t.EditsSnapshot) => {
    setSaveError(null);
    setPending((prev) => mergePending(prev, restored.pending));
    setTouchedPaths((prev) => new Set([...prev, ...restored.touched]));
  }, []);

  return {
    editedValues,
    touchedPaths,
    pendingResets,
    editSessionId,
    isDirty,
    saveError,
    setSaveError,
    collectionEdits: pending.collections,
    editBaselines: pending.baselines,
    visibilityEdits: pending.visibility,
    renameEdits: pending.renames,
    copyEdits: pending.copies,
    restateEdits: pending.restates,
    handleFieldChange,
    handleResetField,
    handleHideField,
    handleUnhideField,
    handleRenameEntry,
    handleRestateCredential,
    handleDiscardField,
    discardEdits,
    startNewSession,
    resetEdits,
    handleDiscard,
    snapshot,
    handleRestoreEdits,
  };
}
