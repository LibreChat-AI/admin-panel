import { useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  saveBaseConfigFn,
  resetBaseConfigFn,
  resetBaseConfigFieldFn,
  bulkSaveProfileValuesFn,
  validateConfigChangesFn,
  removeFieldProfileValueFn,
  tombstoneFieldProfileValueFn,
} from '@/server';
import {
  notifyInfo,
  notifyError,
  notifyWarning,
  notifySuccess,
  findUnsafeKeys,
  getValueAtPath,
  stripSecretPreviewValues,
} from '@/utils';
import { buildSavePayload, partitionScopeResetPaths } from '@/components/configuration/edits';
import { validateMcpCrossField } from '@/components/configuration/sections/mcp/validation';
import { BLOCK_UNSAFE_CONFIG_KEYS, SKIP_REASON_KEYS } from '@/constants';
import { hasPathOverlap } from '@/components/configuration/counts';
import { useLocalize } from '../useLocalize';

/**
 * The save pipeline of the configuration page (WS1): what Save would send,
 * the change review values, and the one validated write path shared by saves
 * and imports.
 */
export function useConfigSave({
  schemaTree,
  schemaPathSet,
  editingScope,
  layers,
  edits,
}: t.ConfigSaveOptions): t.ConfigSaveState {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const {
    configValues,
    dbOverrides,
    yamlConfig,
    yamlMcpServers,
    schemaDefaults,
    overridePaths,
    baseActiveConfigValues,
  } = layers;
  const { editedValues, touchedPaths, resetEdits, setSaveError } = edits;
  const isEditingScope = editingScope !== undefined;

  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const clearEdits = useCallback(() => {
    resetEdits();
    setConfirmSaveOpen(false);
    setSaving(false);
    setSaveError(null);
  }, [resetEdits, setSaveError]);

  /**
   * Toast for a finished write. When anything was not stored, a warning lists
   * each path with the reason, and only claims a save if something was written.
   */
  const announceWrite = useCallback(
    (skipped: t.SkippedChange[], written: number, successMessage: string) => {
      if (skipped.length === 0) {
        notifySuccess(successMessage);
        return;
      }
      const details = skipped
        .map((s) => `${s.fieldPath}: ${localize(SKIP_REASON_KEYS[s.reason])}`)
        .join('\n');
      const titleKey = written > 0 ? 'com_config_saved_with_skipped' : 'com_config_nothing_stored';
      notifyWarning(localize(titleKey, { count: skipped.length }), details);
    },
    [localize],
  );

  const invalidateTarget = useCallback(
    (target: t.WriteTarget) => {
      if (target.type === 'base') {
        return queryClient.invalidateQueries({ queryKey: ['baseConfig'] });
      }
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] }),
        queryClient.invalidateQueries({ queryKey: ['profileMap'] }),
        queryClient.invalidateQueries({ queryKey: ['availableScopes'] }),
      ]);
    },
    [queryClient],
  );

  /**
   * The one write path for saves and imports. Every entry is validated before
   * anything is written, so a rejected batch never leaves resets half-applied;
   * queries are refetched afterwards whether or not the write succeeded, so
   * the page always shows what was actually persisted.
   */
  const writeChanges = useCallback(
    async (
      target: t.WriteTarget,
      saves: t.SaveEntry[],
      resets: string[],
      inheritedMcpKeys: Set<string> = new Set(),
    ): Promise<t.SkippedChange[]> => {
      try {
        const check = await validateConfigChangesFn({
          data: { target: target.type, saves, resets },
        });
        if (check.errors.length > 0) {
          throw new Error(
            `${localize('com_config_validation_failed')} — ${check.errors.map((e) => e.error).join('; ')}`,
          );
        }
        const skippedPaths = new Set(check.skipped.map((s) => s.fieldPath));
        const writableResets = resets.filter((p) => !skippedPaths.has(p));
        const writableSaves = saves.filter((e) => !skippedPaths.has(e.fieldPath));

        /** Resets land before saves so a delete-then-recreate at the same path (e.g. MCP entry replaced with different fields) wipes stale fields first and the new leaf PATCHes don't race against the DELETE. */
        if (target.type === 'scope') {
          const { principalType, principalId } = target.scope;
          const { resetPaths, tombstonePaths } = partitionScopeResetPaths(
            writableResets,
            inheritedMcpKeys,
          );
          await Promise.all([
            ...resetPaths.map((fieldPath) =>
              removeFieldProfileValueFn({ data: { fieldPath, principalType, principalId } }),
            ),
            ...tombstonePaths.map((fieldPath) =>
              tombstoneFieldProfileValueFn({ data: { fieldPath, principalType, principalId } }),
            ),
          ]);
        } else {
          await Promise.all(
            writableResets.map((fieldPath) => resetBaseConfigFieldFn({ data: { fieldPath } })),
          );
        }

        if (writableSaves.length === 0) return check.skipped;
        const result =
          target.type === 'scope'
            ? await bulkSaveProfileValuesFn({
                data: {
                  principalType: target.scope.principalType,
                  principalId: target.scope.principalId,
                  entries: writableSaves,
                },
              })
            : await saveBaseConfigFn({ data: { entries: writableSaves } });
        return [...check.skipped, ...result.skipped];
      } finally {
        await invalidateTarget(target);
      }
    },
    [localize, invalidateTarget],
  );

  const saveContext = useMemo<t.SaveContext>(
    () => ({
      fields: schemaTree,
      baselineAt: (path) => getValueAtPath(baseActiveConfigValues, path),
      hasOverride: (path) => hasPathOverlap(path, overridePaths),
    }),
    [schemaTree, baseActiveConfigValues, overridePaths],
  );

  /** What Save would actually send: normalized, unchanged edits dropped, read-only paths skipped. */
  const savePlan = useMemo(
    () => buildSavePayload(touchedPaths, editedValues, schemaPathSet, saveContext),
    [touchedPaths, editedValues, schemaPathSet, saveContext],
  );

  const unsafeKeys = useMemo(
    () =>
      BLOCK_UNSAFE_CONFIG_KEYS
        ? savePlan.saves.flatMap((entry) => findUnsafeKeys(entry.value, entry.fieldPath))
        : [],
    [savePlan],
  );

  const editTarget = useMemo<t.WriteTarget>(
    () =>
      isEditingScope && editingScope ? { type: 'scope', scope: editingScope } : { type: 'base' },
    [isEditingScope, editingScope],
  );

  const handleConfirmSave = useCallback(async () => {
    if (saving || unsafeKeys.length > 0) return;
    const { touched, saves, resets, skipped } = savePlan;
    if (saves.length === 0 && resets.length === 0) {
      clearEdits();
      if (skipped.length > 0) {
        announceWrite(skipped, 0, localize('com_config_saved'));
      } else {
        notifyInfo(localize('com_config_nothing_to_save'));
      }
      return;
    }

    /** Per-leaf saves can land an MCP entry in a transport state whose required siblings are missing (e.g. type=stdio with no command/args). Server-side per-field validation only sees one path at a time, so do the cross-field check here against the merged effective entry before any PATCH fires. Use baseActiveConfigValues so scope-mode edits validate against the scope-resolved baseline (where prior scope overrides supply some required fields) instead of the base config alone. */
    const mcpBaseline = (() => {
      const v = baseActiveConfigValues?.mcpServers;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, t.ConfigValue>;
      }
      return {};
    })();
    const savedValues = new Map(saves.map((e) => [e.fieldPath, e.value]));
    const resetSet = new Set(resets);
    const mcpEdits: Array<[string, t.ConfigValue]> = touched
      .filter((p) => p.startsWith('mcpServers.') && (savedValues.has(p) || resetSet.has(p)))
      .map((p) => [p, savedValues.get(p)]);
    /** A leaf reset (undefined write) removes the override and reveals the value of the next-lower layer. In scope mode that next layer is the base config; in base mode it is the un-merged YAML config (the baseOnly response). Feed whichever layer applies as the resetFallback so the cross-field validator does not falsely flag a reset-but-still-valid field as missing. */
    const mcpResetFallback = (() => {
      const source = isEditingScope ? configValues?.mcpServers : yamlMcpServers;
      if (source && typeof source === 'object' && !Array.isArray(source)) {
        return source as Record<string, t.ConfigValue>;
      }
      return undefined;
    })();
    if (mcpEdits.length > 0) {
      const mcpErrors = validateMcpCrossField(mcpBaseline, mcpEdits, mcpResetFallback);
      if (mcpErrors.length > 0) {
        const { entryKey, missingField } = mcpErrors[0];
        const message = localize('com_config_mcp_invalid_after_edit', {
          entry: entryKey,
          field: missingField,
        });
        setSaveError(message);
        notifyError(message);
        return;
      }
    }

    const inheritedMcpKeys = (() => {
      const source = isEditingScope ? configValues?.mcpServers : undefined;
      if (source && typeof source === 'object' && !Array.isArray(source)) {
        return new Set(Object.keys(source as Record<string, t.ConfigValue>));
      }
      return new Set<string>();
    })();

    setSaving(true);
    setSaveError(null);

    try {
      const writeSkipped = await writeChanges(editTarget, saves, resets, inheritedMcpKeys);
      const written = Math.max(0, saves.length + resets.length - writeSkipped.length);
      clearEdits();
      announceWrite([...skipped, ...writeSkipped], written, localize('com_config_saved'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaving(false);
      setSaveError(message);
      notifyError(message);
    }
  }, [
    saving,
    unsafeKeys,
    savePlan,
    clearEdits,
    announceWrite,
    baseActiveConfigValues,
    isEditingScope,
    configValues,
    yamlMcpServers,
    localize,
    writeChanges,
    editTarget,
    setSaveError,
  ]);

  /** The review lists exactly what Save sends: a value for each save, "removed" for each reset. */
  const reviewValues = useMemo(() => {
    const result: t.FlatConfigMap = {};
    for (const { fieldPath, value } of savePlan.saves) result[fieldPath] = value;
    for (const fieldPath of savePlan.resets) result[fieldPath] = undefined;
    return result;
  }, [savePlan]);

  /**
   * BEFORE values come from the target being edited (the open profile's own
   * values in scope mode). A reset removes the target's own override, so its
   * BEFORE is that stored override, not the merged value (which for a
   * YAML-managed field such as Azure groups is the librechat.yaml one).
   */
  const originalValuesForDialog = useMemo(() => {
    const result: t.FlatConfigMap = {};
    const ownValues = isEditingScope ? baseActiveConfigValues : dbOverrides;
    for (const path of Object.keys(reviewValues)) {
      const before =
        (reviewValues[path] === undefined ? getValueAtPath(ownValues, path) : undefined) ??
        getValueAtPath(baseActiveConfigValues, path);
      if (before !== undefined) {
        result[path] = stripSecretPreviewValues(before, path, schemaPathSet);
      }
    }
    return result;
  }, [reviewValues, isEditingScope, baseActiveConfigValues, dbOverrides, schemaPathSet]);

  /**
   * What each reset falls back to: the librechat.yaml value for base (or the
   * schema default when the YAML does not set it), the base value for a profile.
   */
  const revertValuesForDialog = useMemo(() => {
    const result: t.FlatConfigMap = {};
    const fallback = isEditingScope ? configValues : yamlConfig;
    for (const path of savePlan.resets) {
      const value = getValueAtPath(fallback, path) ?? schemaDefaults[path];
      result[path] = stripSecretPreviewValues(value, path, schemaPathSet);
    }
    return result;
  }, [savePlan, isEditingScope, configValues, yamlConfig, schemaDefaults, schemaPathSet]);

  const review = useMemo<t.ConfigReviewValues>(
    () => ({
      editedValues: reviewValues,
      originalValues: originalValuesForDialog,
      revertValues: revertValuesForDialog,
    }),
    [reviewValues, originalValuesForDialog, revertValuesForDialog],
  );

  const openReview = useCallback(() => {
    setSaveError(null);
    setConfirmSaveOpen(true);
  }, [setSaveError]);

  const cancelReview = useCallback(() => {
    setConfirmSaveOpen(false);
    setSaveError(null);
  }, [setSaveError]);

  const closeReview = useCallback(() => setConfirmSaveOpen(false), []);

  return {
    confirmSaveOpen,
    saving,
    savePlan,
    unsafeKeys,
    review,
    handleConfirmSave,
    openReview,
    cancelReview,
    closeReview,
    writeChanges,
    announceWrite,
  };
}

/** The "Reset base config" action: deletes every base admin override (WS1). */
export function useResetBaseConfig({ onReset }: t.ResetBaseConfigOptions): t.ResetBaseConfigState {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [resetBaseOpen, setResetBaseOpen] = useState(false);
  const [resettingBase, setResettingBase] = useState(false);
  const [resetBaseError, setResetBaseError] = useState<string | null>(null);

  const handleResetBaseConfig = useCallback(async () => {
    if (resettingBase) return;
    setResettingBase(true);
    setResetBaseError(null);
    try {
      await resetBaseConfigFn();
      /** resolvedConfig holds each scope's own overrides (not a base merge), so a
       *  base reset doesn't make it stale on its own — but base-derived data
       *  (schemaDefaults, base values used for MCP inheritance) feeds scope mode,
       *  so flush it too, consistent with how scope saves invalidate. */
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['baseConfig'] }),
        queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] }),
      ]);
      onReset();
      setResettingBase(false);
      setResetBaseOpen(false);
      notifySuccess(localize('com_config_reset_base_success'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResettingBase(false);
      setResetBaseError(message);
      notifyError(message);
    }
  }, [resettingBase, queryClient, localize, onReset]);

  const openResetBase = useCallback(() => {
    setResetBaseError(null);
    setResetBaseOpen(true);
  }, []);

  const cancelResetBase = useCallback(() => {
    if (resettingBase) return;
    setResetBaseOpen(false);
    setResetBaseError(null);
  }, [resettingBase]);

  return {
    resetBaseOpen,
    resettingBase,
    resetBaseError,
    openResetBase,
    cancelResetBase,
    handleResetBaseConfig,
  };
}
