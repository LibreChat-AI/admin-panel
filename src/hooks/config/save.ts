import { useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, useEffect, useCallback } from 'react';
import type * as t from '@/types';
import {
  errorText,
  notifyInfo,
  notifyError,
  uniqueSkipped,
  notifyWarning,
  notifySuccess,
  getValueAtPath,
  termsRefusalUrl,
  toBatchOps,
  carryChanges,
  asConfigRecord,
  carriedEntries,
  describeIssueCode,
  restateChanges,
  isRestateWarning,
  findEntryKeyMoves,
  findRemovedSecrets,
  countSectionChanges,
  findOversizedSections,
  usesChangeBatch,
  planConfigChanges,
  mergedBackChanges,
  toRevisionPrecondition,
} from '@/utils';
import {
  UNSAFE_KEY_CODES,
  TERMS_NOT_ACCEPTED_CODE,
  TERMS_NOT_ACCEPTED_ISSUE,
  RESOLVED_READ_QUERY_KEYS,
  MCP_API_KEY_MISSING_CODE,
  MCP_SECRET_NOT_CARRIED_CODE,
} from '@/constants';
import {
  ADMIN_API_KEY_FIELD,
  validateMcpCrossField,
} from '@/components/configuration/sections/mcp/validation';
import { buildConfigChanges, normalizeEditValue } from '@/components/configuration/edits';
import { specListIssues } from '@/components/configuration/sections/specs/validation';
import { isResetSent, summarizeChanges } from '@/components/configuration/summary';
import { describeSkippedChanges } from '@/components/configuration/review/group';
import { useConfigContract, useConfigWriteRules } from './contract';
import { applyConfigChangesFn, resetBaseConfigFn } from '@/server';
import { describeIssues } from '@/components/configuration/issues';
import { hasPathOverlap } from '@/components/configuration/counts';
import { useLocalize } from '../useLocalize';

function toTargetRef(target: t.WriteTarget): t.WriteTargetRef {
  if (target.type === 'base') return { type: 'base' };
  const { principalType, principalId } = target.scope;
  return { type: 'scope', scope: { principalType, principalId } };
}

/** A problem `validateMcpCrossField` finds, as a pre-flight issue on the field it names. */
function toMcpIssue({ entryKey, missingField, renamedFrom }: t.McpCrossFieldError): t.ConfigIssue {
  const path = `mcpServers.${entryKey}.${missingField}`;
  if (renamedFrom !== undefined) {
    const params = { from: renamedFrom };
    const code = MCP_SECRET_NOT_CARRIED_CODE;
    return { path, code, params, message: describeIssueCode(code, params, '') };
  }
  const code = missingField === ADMIN_API_KEY_FIELD ? MCP_API_KEY_MISSING_CODE : 'required';
  return { path, code, message: describeIssueCode(code, undefined, '') };
}

function hasWrites(plan: t.WritePlan): boolean {
  return (
    plan.sets.length + plan.resets.length + plan.tombstones.length + plan.untombstones.length > 0
  );
}

/**
 * The revision the pending edits were made against: the target's loaded
 * revision when the first of them was made, held while any is pending. A
 * re-read meanwhile (the review opening, a window-focus refetch) does not
 * move it, so a save over a version someone else saved since is a conflict
 * rather than a silent overwrite. Once the edits are saved or dropped it
 * follows the loaded revision again; `hold` puts back the revision of edits
 * restored with them (Discard's Undo).
 */
function useEditRevision(loaded: t.Revision, pending: boolean): t.HeldRevision {
  const [held, setHeld] = useState({ pending, revision: loaded });
  if (held.pending !== pending) setHeld({ pending, revision: loaded });
  const hold = useCallback((revision: t.Revision) => setHeld({ pending: true, revision }), []);
  return { revision: pending && held.pending ? held.revision : loaded, hold };
}

/** The admin session ended (signed out elsewhere or expired): the save never reached LibreChat. */
const SESSION_ERROR_RE = /no admin session token|session (has )?expired|unauthori[sz]ed|\b401\b/i;

function isSessionError(message: string): boolean {
  return SESSION_ERROR_RE.test(message);
}

/** Where to accept LibreChat's terms when a save was refused until the admin does (`null` otherwise). */
function termsUrlOf(result: t.ApplyConfigChangesResult): string | null {
  const issue = result.failed.find(({ code }) => code === TERMS_NOT_ACCEPTED_ISSUE);
  if (!issue) return null;
  return typeof issue.params?.url === 'string' ? issue.params.url : '';
}

/**
 * The save pipeline of the configuration page (WS1). Pending edits become
 * `ConfigChange` ops (keyed collection entries by identity), which are
 * planned against the target's layers on the client for the review, the
 * inline errors and the skipped list, and applied on the server in one
 * validated, all-or-nothing call that reports what did not take effect.
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
  const { features, limits } = useConfigContract();
  const writeRules = useConfigWriteRules();
  const {
    configValues,
    dbOverrides,
    yamlConfig,
    yamlMcpServers,
    schemaDefaults,
    overridePaths,
    valueLayers,
    baseActiveConfigValues,
    targetRevision,
  } = layers;
  const {
    editedValues,
    touchedPaths,
    resetEdits,
    setSaveError,
    collectionEdits,
    editBaselines,
    visibilityEdits,
    renameEdits,
    copyEdits,
    restateEdits,
    handleRestateCredential,
  } = edits;
  const isEditingScope = editingScope !== undefined;

  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverIssues, setServerIssues] = useState<t.ConfigIssue[]>([]);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [termsUrl, setTermsUrl] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  useEffect(() => setServerIssues([]), [editedValues, visibilityEdits]);

  const hasPendingEdits = [editedValues, visibilityEdits, restateEdits].some(
    (pending) => Object.keys(pending).length > 0,
  );
  const { revision: editRevision, hold: holdRevision } = useEditRevision(
    targetRevision,
    hasPendingEdits,
  );

  /** The revision the edits are saved against (`changesBatch`): see `useEditRevision`. */
  const expectedRevision = useMemo(
    () => (usesChangeBatch(features) ? toRevisionPrecondition(editRevision) : undefined),
    [features, editRevision],
  );

  const clearEdits = useCallback(() => {
    resetEdits();
    setConfirmSaveOpen(false);
    setSaving(false);
    setConflict(false);
    setSaveError(null);
  }, [resetEdits, setSaveError]);

  const describeSkipped = useCallback(
    (skipped: t.SkippedChange[]) =>
      describeSkippedChanges(skipped, {
        localize,
        fields: schemaTree,
        tree: baseActiveConfigValues,
      }),
    [localize, schemaTree, baseActiveConfigValues],
  );

  /**
   * Toast for a finished write: "Changes saved" only when everything took
   * effect; otherwise a warning that lists each change with the reason.
   */
  const announceWrite = useCallback(
    (skipped: t.SkippedChange[], written: number, successMessage: string) => {
      const unique = uniqueSkipped(skipped);
      if (unique.length === 0) {
        notifySuccess(successMessage);
        return;
      }
      const titleKey = written > 0 ? 'com_config_apply_not_effective' : 'com_config_nothing_stored';
      notifyWarning(localize(titleKey, { count: unique.length }), describeSkipped(unique));
    },
    [localize, describeSkipped],
  );

  /** The target's own reads, and the server-resolved ones (catalogs, env status, previews) any save can change. */
  const invalidateTarget = useCallback(
    (target: t.WriteTarget) => {
      const keys: ReadonlyArray<readonly string[]> =
        target.type === 'base'
          ? [['baseConfig'], ...RESOLVED_READ_QUERY_KEYS]
          : [['resolvedConfig'], ['availableScopes'], ...RESOLVED_READ_QUERY_KEYS];
      return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    [queryClient],
  );

  /**
   * Applies ops through the server's validated apply; queries are refetched
   * whatever the outcome, so after a conflict the page shows what is stored
   * now. A call that fails outright (an ended session) is reported at once:
   * the refetch, which retries, runs in the background.
   */
  const applyChanges = useCallback(
    async (target: t.WriteTarget, ops: t.ConfigChange[], revision?: string) => {
      try {
        const result = await applyConfigChangesFn({
          data: { target: toTargetRef(target), ops, expectedRevision: revision },
        });
        await invalidateTarget(target);
        return result;
      } catch (err) {
        void invalidateTarget(target);
        throw err;
      }
    },
    [invalidateTarget],
  );

  const describeFailure = useCallback(
    (result: t.ApplyConfigChangesResult, collections: t.PendingCollection[]) => {
      if (termsUrlOf(result) !== null) return localize('com_config_terms_not_accepted');
      const blocking = [...result.issues, ...result.failed];
      const { summaries } = describeIssues(blocking, collections, localize);
      const titleKey = (() => {
        if (result.issues.length > 0) return 'com_config_validation_failed';
        if (result.partiallyWritten) return 'com_config_apply_partial';
        return result.compensated === false
          ? 'com_config_apply_rollback_incomplete'
          : 'com_config_apply_failed';
      })();
      return `${localize(titleKey)} — ${summaries.join('; ')}`;
    },
    [localize],
  );

  /** The write path shared with imports: saves and resets as ops, all or nothing. */
  const writeChanges = useCallback<t.WriteChangesFn>(
    async (target, saves, resets) => {
      const ops: t.ConfigChange[] = [
        ...saves.map(
          ({ fieldPath, value }): t.ConfigChange => ({
            op: 'set',
            path: fieldPath,
            value,
          }),
        ),
        ...resets.map((path): t.ConfigChange => ({ op: 'reset', path })),
      ];
      const result = await applyChanges(target, ops);
      /** A terms refusal keeps its code, so the caller (Import) words it and links to LibreChat. */
      const terms = termsUrlOf(result);
      if (terms !== null) throw new Error(`${TERMS_NOT_ACCEPTED_CODE} ${terms}`.trim());
      if (result.issues.length > 0 || result.failed.length > 0) {
        throw new Error(describeFailure(result, []));
      }
      return { skipped: result.skipped, reported: result.reported };
    },
    [applyChanges, describeFailure],
  );

  const changeContext = useMemo<t.ChangeContext>(
    () => ({
      fields: schemaTree,
      baselineAt: (path) => getValueAtPath(baseActiveConfigValues, path),
      hasOverride: (path) => hasPathOverlap(path, overridePaths),
      isScope: isEditingScope,
      root: baseActiveConfigValues,
      collections: collectionEdits,
      visibility: visibilityEdits,
      writeRules,
    }),
    [
      schemaTree,
      baseActiveConfigValues,
      overridePaths,
      isEditingScope,
      collectionEdits,
      visibilityEdits,
      writeRules,
    ],
  );

  const changeSet = useMemo(
    () => buildConfigChanges(touchedPaths, editedValues, schemaPathSet, changeContext),
    [touchedPaths, editedValues, schemaPathSet, changeContext],
  );

  /** The target's stored overrides and tombstones and the layer beneath, as loaded (the server re-reads them). */
  const snapshot = useMemo<t.WriteSnapshot>(() => {
    if (isEditingScope) {
      return {
        stored: valueLayers?.scope?.overrides ?? {},
        tombstones: [...(valueLayers?.scope?.tombstones ?? [])],
        lower: configValues ?? {},
        lowerKind: 'inherited',
      };
    }
    return {
      stored: dbOverrides ?? {},
      tombstones: [...(valueLayers?.baseTombstones ?? [])],
      lower: yamlConfig ?? {},
      lowerKind: 'yaml',
    };
  }, [isEditingScope, valueLayers, configValues, dbOverrides, yamlConfig]);

  /**
   * The edits as ops, with what renamed and duplicated MCP servers carry of
   * their stored secrets, and the inherited credentials the edits restate.
   */
  const ops = useMemo(
    () => [
      ...changeSet.ops,
      ...carryChanges(renameEdits, copyEdits),
      ...restateChanges(restateEdits),
    ],
    [changeSet.ops, renameEdits, copyEdits, restateEdits],
  );

  const plan = useMemo(
    () => planConfigChanges(ops, snapshot, features, writeRules, limits),
    [ops, snapshot, features, writeRules, limits],
  );

  /**
   * A restate of a credential the edits no longer move (its destination set
   * back) changes nothing: it is dropped, so it leaves no pending change.
   */
  useEffect(() => {
    for (const ref of Object.values(restateEdits)) {
      if (!plan.warnings.some((warning) => isRestateWarning(warning, ref))) {
        handleRestateCredential(ref, false);
      }
    }
  }, [plan, restateEdits, handleRestateCredential]);

  /**
   * Per-leaf saves can leave an MCP server without a field its transport
   * needs, or without a key it uses; the merged server (scope-resolved in a
   * profile, stored keys kept as LibreChat keeps them) is checked before
   * anything is sent, so the review and the card name the problem first.
   */
  const mcpIssues = useMemo((): t.ConfigIssue[] => {
    const { touched, saves, resets } = changeSet.payload;
    const savedValues = new Map(saves.map((e) => [e.fieldPath, e.value]));
    const resetSet = new Set(resets);
    const mcpEdits: Array<[string, t.ConfigValue]> = touched
      .filter((p) => p.startsWith('mcpServers.') && (savedValues.has(p) || resetSet.has(p)))
      .map((p) => [p, savedValues.get(p)]);
    if (mcpEdits.length === 0) return [];
    /** A reset reveals the next-lower layer: the base config in a profile, librechat.yaml in base. */
    const fallback = asConfigRecord(isEditingScope ? configValues?.mcpServers : yamlMcpServers);
    return validateMcpCrossField(
      asConfigRecord(baseActiveConfigValues?.mcpServers),
      mcpEdits,
      fallback,
      renameEdits,
      carriedEntries(plan, 'mcpServers'),
    ).map(toMcpIssue);
  }, [
    changeSet.payload,
    isEditingScope,
    configValues,
    yamlMcpServers,
    baseActiveConfigValues,
    renameEdits,
    plan,
  ]);

  /** A section with more changes than one batch takes is refused whole: said before Save (`changesBatch`). */
  const oversizedIssues = useMemo(
    () =>
      usesChangeBatch(features)
        ? findOversizedSections(countSectionChanges(toBatchOps(plan)), limits.maxChangeOps)
        : [],
    [features, plan, limits.maxChangeOps],
  );

  /** The stored secrets the save takes away, whatever change removes them: the review names each. */
  const removedSecrets = useMemo(
    () => findRemovedSecrets(snapshot.stored, plan),
    [snapshot.stored, plan],
  );

  /** In Base, the entries the save keeps while moving where profiles' own keys there go: the review names them. */
  const keyMoves = useMemo(
    () =>
      isEditingScope
        ? []
        : findEntryKeyMoves({ ...snapshot, storedAfter: plan.storedAfter }, features),
    [isEditingScope, snapshot, plan.storedAfter, features],
  );

  const clientIssues = useMemo(
    () => [
      ...changeSet.issues,
      ...plan.issues,
      ...mcpIssues,
      ...oversizedIssues,
      ...specListIssues(changeSet),
    ],
    [changeSet, plan.issues, mcpIssues, oversizedIssues],
  );

  const issues = useMemo(() => [...clientIssues, ...serverIssues], [clientIssues, serverIssues]);

  const { fieldErrors, summaries: issueSummaries } = useMemo(
    () => describeIssues(issues, changeSet.collections, localize),
    [issues, changeSet.collections, localize],
  );

  /**
   * What Save changes, as the admin edited it (the review reads it): plain
   * saves the plan sends, each edited keyed collection as its whole pending
   * list (sent as per-entry ops), the resets the plan sends, and what is left
   * out and why.
   */
  const savePlan = useMemo<t.SavePayload>(() => {
    const notSent = new Set(plan.skipped.map((s) => s.fieldPath));
    const collectionSaves = changeSet.collections.map(({ collection, items }) => ({
      fieldPath: collection.path,
      value: items.map((item) =>
        normalizeEditValue(`${collection.path}.0`, item, schemaTree, schemaPathSet),
      ),
    }));
    return {
      touched: changeSet.payload.touched,
      saves: [
        ...changeSet.payload.saves.filter((s) => !notSent.has(s.fieldPath)),
        ...collectionSaves,
      ],
      resets: changeSet.ops
        .filter((op) => op.op === 'reset' && isResetSent(plan, op.path))
        .map((op) => op.path),
      skipped: uniqueSkipped([
        ...changeSet.payload.skipped,
        ...plan.skipped,
        ...mergedBackChanges(plan.warnings, snapshot),
      ]),
    };
  }, [changeSet, plan, snapshot, schemaTree, schemaPathSet]);

  const unsafeKeys = useMemo(
    () =>
      plan.issues
        .filter((issue) => issue.code != null && UNSAFE_KEY_CODES.has(issue.code))
        .map((issue) => ({ path: issue.path, key: String(issue.params?.key ?? '') })),
    [plan.issues],
  );

  const summaryLayers = useMemo<t.SummaryLayers>(() => {
    const ownValues = isEditingScope ? snapshot.stored : (dbOverrides ?? {});
    return {
      baselineAt: (path) => getValueAtPath(baseActiveConfigValues, path),
      ownAt: (path) => getValueAtPath(ownValues, path),
      revertAt: (path) => {
        const lower = getValueAtPath(isEditingScope ? configValues : yamlConfig, path);
        if (lower !== undefined) {
          return { value: lower, source: isEditingScope ? 'inherited' : 'yaml' };
        }
        return { value: schemaDefaults[path], source: 'default' };
      },
      editBaselines,
    };
  }, [
    isEditingScope,
    snapshot.stored,
    dbOverrides,
    baseActiveConfigValues,
    configValues,
    yamlConfig,
    schemaDefaults,
    editBaselines,
  ]);

  const changes = useMemo(
    () => summarizeChanges(changeSet, plan, summaryLayers),
    [changeSet, plan, summaryLayers],
  );

  const editTarget = useMemo<t.WriteTarget>(
    () =>
      isEditingScope && editingScope ? { type: 'scope', scope: editingScope } : { type: 'base' },
    [isEditingScope, editingScope],
  );

  /** Ends a save that writes nothing: the edits are dropped, and what is left out is listed. */
  const finishWithoutWrites = useCallback(() => {
    clearEdits();
    if (savePlan.skipped.length > 0) {
      announceWrite(savePlan.skipped, 0, localize('com_config_saved'));
      return;
    }
    notifyInfo(localize('com_config_nothing_to_save'));
  }, [clearEdits, savePlan.skipped, announceWrite, localize]);

  /**
   * Saves the pending edits to the edit target, against `revision` (see
   * `ApplyConfigChangesRequest.expectedRevision`). A target saved elsewhere
   * meanwhile is a `conflict`: nothing was written, and the review offers to
   * reload or to merge.
   */
  const saveAgainst = useCallback(
    async (revision: string | undefined) => {
      if (saving || unsafeKeys.length > 0) return;
      if (clientIssues.length > 0) {
        setSaveError(`${localize('com_config_validation_failed')} — ${issueSummaries.join('; ')}`);
        return;
      }
      if (!hasWrites(plan)) {
        finishWithoutWrites();
        return;
      }
      setSaving(true);
      setSaveError(null);
      setSessionExpired(false);
      setTermsUrl(null);
      setConflict(false);
      try {
        const result = await applyChanges(editTarget, ops, revision);
        if (result.conflict) {
          setSaving(false);
          setConflict(true);
          notifyWarning(
            localize('com_config_conflict_title'),
            localize('com_config_conflict_toast'),
          );
          return;
        }
        const terms = termsUrlOf(result);
        if (terms !== null) {
          const message = localize('com_config_terms_not_accepted');
          setSaving(false);
          setTermsUrl(terms);
          setSaveError(message);
          notifyError(message);
          return;
        }
        if (result.issues.length > 0 || result.failed.length > 0) {
          const message = describeFailure(result, changeSet.collections);
          setServerIssues([...result.issues, ...result.failed]);
          setSaving(false);
          setSaveError(message);
          notifyError(message);
          return;
        }
        clearEdits();
        announceWrite(
          [...changeSet.payload.skipped, ...result.skipped, ...result.reported],
          result.applied,
          localize('com_config_saved'),
        );
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const expired = isSessionError(raw);
        const message = expired ? localize('com_config_session_expired') : raw;
        setSaving(false);
        setSessionExpired(expired);
        setSaveError(message);
        notifyError(message);
      }
    },
    [
      saving,
      unsafeKeys,
      clientIssues,
      issueSummaries,
      plan,
      finishWithoutWrites,
      changeSet,
      ops,
      clearEdits,
      announceWrite,
      applyChanges,
      describeFailure,
      editTarget,
      localize,
      setSaveError,
    ],
  );

  /**
   * Save from the review, against the revision the edits were made against.
   * While the conflict notice is shown only Reload or Merge resolves it: Save
   * would send that revision again and meet the same conflict. Closing the
   * review ends the notice; the review opened again compares the edits with
   * what is stored now, and its Save conflicts again until the admin reloads
   * or merges.
   */
  const handleConfirmSave = useCallback(async () => {
    if (conflict) return;
    await saveAgainst(expectedRevision);
  }, [conflict, saveAgainst, expectedRevision]);

  /** Merges after a conflict: the server plans the edits over the target as stored now. */
  const saveOverLatest = useCallback(() => saveAgainst(undefined), [saveAgainst]);

  const reloadLatest = useCallback(async () => {
    setConflict(false);
    setSaveError(null);
    await invalidateTarget(editTarget);
  }, [invalidateTarget, editTarget, setSaveError]);

  /**
   * Opening the review re-reads the target, so rows saved by someone else
   * meanwhile are flagged as drifted (SV-8); the revision Save sends stays the
   * one the edits were made against. Blocking problems are listed by the
   * review from `issues`.
   */
  const openReview = useCallback(() => {
    void invalidateTarget(editTarget);
    setSaveError(null);
    setSessionExpired(false);
    setTermsUrl(null);
    setConflict(false);
    setConfirmSaveOpen(true);
  }, [invalidateTarget, editTarget, setSaveError]);

  const cancelReview = useCallback(() => {
    setConfirmSaveOpen(false);
    setSaveError(null);
    setSessionExpired(false);
    setTermsUrl(null);
    setConflict(false);
  }, [setSaveError]);

  const closeReview = useCallback(() => setConfirmSaveOpen(false), []);

  return {
    confirmSaveOpen,
    saving,
    sessionExpired,
    termsUrl,
    savePlan,
    unsafeKeys,
    changes,
    warnings: plan.warnings,
    removedSecrets,
    keyMoves,
    issues,
    fieldErrors,
    issueSummaries,
    handleConfirmSave,
    finishWithoutWrites,
    editRevision,
    holdRevision,
    conflict,
    reloadLatest,
    saveOverLatest,
    openReview,
    cancelReview,
    closeReview,
    writeChanges,
    announceWrite,
    describeSkipped,
  };
}

/** The "Reset base config" action: deletes every base admin override (WS1). */
export function useResetBaseConfig({ onReset }: t.ResetBaseConfigOptions): t.ResetBaseConfigState {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [resetBaseOpen, setResetBaseOpen] = useState(false);
  const [resettingBase, setResettingBase] = useState(false);
  const [resetBaseError, setResetBaseError] = useState<string | null>(null);
  const [resetBaseTermsUrl, setResetBaseTermsUrl] = useState<string | null>(null);

  const handleResetBaseConfig = useCallback(async () => {
    if (resettingBase) return;
    setResettingBase(true);
    setResetBaseError(null);
    setResetBaseTermsUrl(null);
    try {
      await resetBaseConfigFn();
      /** resolvedConfig holds each scope's own overrides (not a base merge), so a
       *  base reset doesn't make it stale on its own — but base-derived data
       *  (schemaDefaults, base values used for MCP inheritance) feeds scope mode,
       *  so flush it too, consistent with how scope saves invalidate. */
      await Promise.all(
        [['baseConfig'], ['resolvedConfig'], ...RESOLVED_READ_QUERY_KEYS].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      onReset();
      setResettingBase(false);
      setResetBaseOpen(false);
      notifySuccess(localize('com_config_reset_base_success'));
    } catch (err) {
      const termsUrl = termsRefusalUrl(err);
      setResettingBase(false);
      setResetBaseTermsUrl(termsUrl || null);
      setResetBaseError(
        termsUrl != null
          ? localize('com_config_terms_refused')
          : errorText(err, localize('com_config_reset_base_error'), localize),
      );
    }
  }, [resettingBase, queryClient, localize, onReset]);

  const openResetBase = useCallback(() => {
    setResetBaseError(null);
    setResetBaseTermsUrl(null);
    setResetBaseOpen(true);
  }, []);

  const cancelResetBase = useCallback(() => {
    if (resettingBase) return;
    setResetBaseOpen(false);
    setResetBaseError(null);
    setResetBaseTermsUrl(null);
  }, [resettingBase]);

  return {
    resetBaseOpen,
    resettingBase,
    resetBaseError,
    resetBaseTermsUrl,
    openResetBase,
    cancelResetBase,
    handleResetBaseConfig,
  };
}
