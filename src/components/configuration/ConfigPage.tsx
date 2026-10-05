import { createPortal } from 'react-dom';
import { Icon } from '@clickhouse/click-ui';
import { PrincipalType } from 'librechat-data-provider';
import { getRouteApi, useBlocker, useNavigate } from '@tanstack/react-router';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, useRef, useCallback, useEffect, startTransition } from 'react';
import type * as t from '@/types';
import {
  removeFieldProfileValueFn,
  tombstoneFieldProfileValueFn,
  bulkSaveProfileValuesFn,
  getBatchFieldProfilesFn,
  validateConfigChangesFn,
  availableScopesOptions,
  resetBaseConfigFieldFn,
  getResolvedConfigFn,
  resetBaseConfigFn,
  baseConfigOptions,
  saveBaseConfigFn,
  getLangfuseConnectionFn,
  LANGFUSE_CONNECTION_QUERY_KEY,
} from '@/server';
import {
  flattenObject,
  getValueAtPath,
  unflattenObject,
  findUnsafeKeys,
  hasConfigCapability,
  getTabsWithPermission,
  mapSecretPreviewPaths,
  stripSecretPreviewValues,
  notifySuccess,
  notifyWarning,
  notifyError,
  notifyInfo,
} from '@/utils';
import {
  hasPathOverlap,
  applyConfigEdit,
  collectImportEntries,
  buildSavePayload,
  mergeIndexedArrayEdits,
  partitionScopeResetPaths,
  withLangfuseConfiguredPath,
} from './utils';
import {
  SystemCapabilities,
  READ_ONLY_CONFIG_SECTIONS,
  BLOCK_UNSAFE_CONFIG_KEYS,
  SKIP_REASON_KEYS,
} from '@/constants';
import {
  CONFIG_TABS,
  OTHER_TAB,
  SECTION_META,
  HIDDEN_SECTIONS,
  splitCamelCase,
} from './configMeta';
import { useLocalize, useHighlightRef, useActiveSection, useCapabilities } from '@/hooks';
import { validateMcpCrossField } from './sections/McpServersRenderer';
import { ScopeSelector, ScopeTriggerButton } from './ScopeSelector';
import { ConfigTableOfContents } from './ConfigTableOfContents';
import { ResetBaseConfigDialog } from './ResetBaseConfigDialog';
import { ConfirmSaveDialog } from './ConfirmSaveDialog';
import { StickyActionBar } from '@/components/shared';
import { ConfigTabContent } from './ConfigTabContent';
import { ImportYamlDialog } from './ImportYamlDialog';
import { ContentToolbar } from './ContentToolbar';
import { ConfigTabBar } from './ConfigTabBar';
import { InfoBanner } from './InfoBanner';

const routeApi = getRouteApi('/_app/configuration/');
const LAST_SCOPE_KEY = 'config:lastScope';

function collectFieldPaths(fields: t.SchemaField[], prefix = ''): string[] {
  const paths: string[] = [];
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    if (field.children && field.children.length > 0) {
      paths.push(...collectFieldPaths(field.children, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

const profileMapOptions = (fieldPaths: string[]) =>
  queryOptions({
    queryKey: ['profileMap', fieldPaths],
    queryFn: () =>
      getBatchFieldProfilesFn({ data: { paths: fieldPaths } }).then(
        (r: { profileMap: Record<string, string[]> }) => r.profileMap,
      ),
    enabled: fieldPaths.length > 0,
    staleTime: 60_000,
  });

function resolvedConfigOptions(scope: t.ScopeSelection) {
  const principalType = scope.type === 'SCOPE' ? scope.scope.principalType : null;
  const principalId = scope.type === 'SCOPE' ? scope.scope.principalId : null;
  return queryOptions({
    queryKey: ['resolvedConfig', principalType, principalId] as const,
    queryFn: () =>
      getResolvedConfigFn({
        data: {
          principalType: principalType!,
          principalId: principalId!,
        },
      }),
    enabled: principalType != null && principalId != null,
    staleTime: 60_000,
  });
}

/** Keys AppService adds to the resolved config that are runtime state, not settings. */
const APP_SERVICE_INTERNAL_KEYS = new Set(['paths', 'config', 'availableTools']);

export function ConfigPage({ initialTab, highlightField, initialScope }: t.ConfigPageProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { hasCapability } = useCapabilities();
  const canManageConfig = hasCapability(SystemCapabilities.MANAGE_CONFIGS);
  const canAssignConfigs = hasCapability(SystemCapabilities.ASSIGN_CONFIGS) || canManageConfig;
  const navigate = useNavigate({ from: '/configuration/' });
  const { tree: schemaTree } = routeApi.useLoaderData();

  /** Per-section permission map: { [sectionKey]: { canView, canEdit } } */
  const sectionPermissions = useMemo(() => {
    const perms: Record<string, { canView: boolean; canEdit: boolean }> = {};
    for (const section of schemaTree) {
      perms[section.key] = {
        canView: hasConfigCapability(hasCapability, section.key, 'read'),
        canEdit: hasConfigCapability(hasCapability, section.key, 'manage'),
      };
    }
    return perms;
  }, [schemaTree, hasCapability]);

  const { data: baseConfigData } = useQuery(baseConfigOptions);
  const configValues = baseConfigData?.config ?? null;
  const dbOverrides = baseConfigData?.dbOverrides;
  const configuredFromBase = baseConfigData?.configuredFromBase;
  const schemaDefaults = baseConfigData?.schemaDefaults ?? {};
  const flatBaseline = useMemo(() => flattenObject(configValues ?? {}), [configValues]);
  const [editedValues, setEditedValues] = useState<t.FlatConfigMap>({});
  const [touchedPaths, setTouchedPaths] = useState<Set<string>>(() => new Set());
  const [editSessionId, setEditSessionId] = useState(0);

  const fieldPaths = useMemo(() => collectFieldPaths(schemaTree), [schemaTree]);
  const schemaPathSet = useMemo(() => new Set(fieldPaths), [fieldPaths]);

  const configuredPaths = useMemo(() => {
    const paths = new Set<string>();
    if (configuredFromBase) {
      for (const p of configuredFromBase) paths.add(p);
    }
    if (dbOverrides) {
      for (const p of Object.keys(flattenObject(dbOverrides))) paths.add(p);
    }
    return mapSecretPreviewPaths(paths, schemaPathSet);
  }, [configuredFromBase, dbOverrides, schemaPathSet]);

  const dbOverridePaths = useMemo(() => {
    if (!dbOverrides) return new Set<string>();
    return mapSecretPreviewPaths(Object.keys(flattenObject(dbOverrides)), schemaPathSet);
  }, [dbOverrides, schemaPathSet]);

  const baseRecordKeys = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    const yamlMcpKeys = baseConfigData?.yamlMcpKeys;
    if (yamlMcpKeys && Array.isArray(yamlMcpKeys)) {
      result.mcpServers = new Set(yamlMcpKeys);
    }
    return result;
  }, [baseConfigData]);

  const hasUnmappedSections = useMemo(
    () =>
      schemaTree.some(
        (s: t.SchemaField) => !HIDDEN_SECTIONS.has(s.key) && !Object.hasOwn(SECTION_META, s.key),
      ),
    [schemaTree],
  );

  const { viewableTabIds, editableTabIds } = useMemo(
    () => ({
      viewableTabIds: getTabsWithPermission(
        schemaTree,
        SECTION_META,
        OTHER_TAB.id,
        sectionPermissions,
        'canView',
        HIDDEN_SECTIONS,
      ),
      editableTabIds: getTabsWithPermission(
        schemaTree,
        SECTION_META,
        OTHER_TAB.id,
        sectionPermissions,
        'canEdit',
        HIDDEN_SECTIONS,
      ),
    }),
    [schemaTree, sectionPermissions],
  );

  const visibleTabs = useMemo(() => {
    const allTabs = hasUnmappedSections ? [...CONFIG_TABS, OTHER_TAB] : CONFIG_TABS;
    return allTabs.filter((tab) => viewableTabIds.has(tab.id));
  }, [hasUnmappedSections, viewableTabIds]);

  const activeTab =
    initialTab && visibleTabs.some((tab) => tab.id === initialTab)
      ? initialTab
      : (visibleTabs[0]?.id ?? CONFIG_TABS[0].id);

  const handleTabChange = useCallback(
    (newTab: string) => {
      navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, tab: newTab }) });
    },
    [navigate],
  );

  const [importOpen, setImportOpen] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(dismissTimer.current), []);

  const [showConfiguredOnly, setShowConfiguredOnly] = useState(false);

  const [scopeSelectorOpen, setScopeSelectorOpen] = useState(false);
  const [selectedScope, setSelectedScope] = useState<t.ScopeSelection>({ type: 'BASE' });

  const handleScopeChange = useCallback(
    (newSelection: t.ScopeSelection) => {
      if (Object.keys(editedValues).length > 0) {
        if (!window.confirm(localize('com_config_unsaved_leave'))) return;
        setEditedValues({});
        setTouchedPaths(new Set());
      }
      setEditSessionId((id) => id + 1);
      setConfirmSaveOpen(false);
      setSelectedScope(newSelection);
      const scopeId =
        newSelection.type === 'SCOPE' && newSelection.scope._id
          ? newSelection.scope._id
          : undefined;
      if (scopeId) {
        localStorage.setItem(LAST_SCOPE_KEY, scopeId);
      } else {
        localStorage.removeItem(LAST_SCOPE_KEY);
      }
      navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, scope: scopeId }) });
    },
    [editedValues, localize, navigate],
  );

  const savedScope = useRef(localStorage.getItem(LAST_SCOPE_KEY) ?? undefined);
  const scopeToRestore = initialScope ?? savedScope.current;
  const { data: allScopes } = useQuery({
    ...availableScopesOptions,
    enabled: !!scopeToRestore,
  });
  const initialScopeApplied = useRef(false);
  useEffect(() => {
    if (scopeToRestore && allScopes && !initialScopeApplied.current) {
      const match =
        allScopes.find((s) => s._id === scopeToRestore) ??
        (() => {
          const [type, ...rest] = scopeToRestore.split(':');
          const id = rest.join(':');
          return allScopes.find(
            (s) => s.principalType === (type as PrincipalType) && s.principalId === id,
          );
        })();
      if (match) {
        initialScopeApplied.current = true;
        setSelectedScope({ type: 'SCOPE', scope: match });
        if (!initialScope) {
          navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, scope: match._id }) });
        }
      }
    }
  }, [scopeToRestore, allScopes, initialScope, navigate]);

  const isEditingScope = selectedScope.type === 'SCOPE';
  const editingScope: t.ConfigScope | undefined =
    selectedScope.type === 'SCOPE' ? selectedScope.scope : undefined;

  const { data: profileMap = {} } = useQuery(profileMapOptions(fieldPaths));

  const handleProfileChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['profileMap'] });
    queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] });
  }, [queryClient]);

  const { data: resolvedData } = useQuery(resolvedConfigOptions(selectedScope));
  const scopeChangedPaths = resolvedData?.changedPaths ?? null;
  const scopeResolvedValues = resolvedData?.resolvedConfig ?? null;

  const scopeConfigValues = useMemo(() => {
    if (!isEditingScope || !scopeResolvedValues) return null;
    return unflattenObject(scopeResolvedValues) as Record<string, t.ConfigValue>;
  }, [isEditingScope, scopeResolvedValues]);

  const baseActiveConfigValues = isEditingScope ? scopeConfigValues : configValues;

  /** Read-only sections can't be overridden per profile, so a profile shows the base values. */
  const displayConfigValues = useMemo(() => {
    if (!isEditingScope || !baseActiveConfigValues || !configValues) return baseActiveConfigValues;
    const withBase = { ...baseActiveConfigValues };
    for (const section of READ_ONLY_CONFIG_SECTIONS.keys()) {
      if (section in configValues) withBase[section] = configValues[section];
    }
    return withBase;
  }, [isEditingScope, baseActiveConfigValues, configValues]);

  const activeConfigValues = useMemo(() => {
    if (!displayConfigValues) return displayConfigValues;
    const indexedEdits = Object.entries(editedValues).filter(([k]) => /\.\d+$/.test(k));
    if (indexedEdits.length === 0) return displayConfigValues;
    return mergeIndexedArrayEdits(displayConfigValues, indexedEdits);
  }, [displayConfigValues, editedValues]);

  const scopeConfiguredPaths = useMemo(() => {
    if (!scopeChangedPaths) return new Set<string>();
    return mapSecretPreviewPaths(scopeChangedPaths, schemaPathSet);
  }, [scopeChangedPaths, schemaPathSet]);

  const scopeChangedPathsMapped = useMemo(() => {
    if (!scopeChangedPaths) return null;
    return Array.from(mapSecretPreviewPaths(scopeChangedPaths, schemaPathSet));
  }, [scopeChangedPaths, schemaPathSet]);

  const { data: langfuseConnection } = useQuery({
    queryKey: LANGFUSE_CONNECTION_QUERY_KEY,
    queryFn: () => getLangfuseConnectionFn(),
    enabled:
      !isEditingScope &&
      schemaTree.some((section) => section.key === 'langfuse') &&
      sectionPermissions.langfuse?.canEdit === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const baseConfiguredPaths = useMemo(
    () => withLangfuseConfiguredPath(configuredPaths, langfuseConnection?.configured === true),
    [configuredPaths, langfuseConnection?.configured],
  );

  const activeConfiguredPaths = isEditingScope ? scopeConfiguredPaths : baseConfiguredPaths;

  const tabConfiguredCounts = useMemo(() => {
    if (activeConfiguredPaths.size === 0) return {};
    const schemaKeyToTabs: Record<string, string[]> = {};
    for (const [metaKey, meta] of Object.entries(SECTION_META)) {
      if (meta.schemaKey) {
        (schemaKeyToTabs[meta.schemaKey] ??= []).push(meta.tab);
      }
      if (!meta.schemaKey) {
        (schemaKeyToTabs[metaKey] ??= []).push(meta.tab);
      }
    }

    const counts: Record<string, number> = {};
    for (const tab of visibleTabs) {
      if (tab.id === 'mcp' && activeConfigValues) {
        const mcpValue = activeConfigValues.mcpServers;
        counts[tab.id] =
          mcpValue && typeof mcpValue === 'object' && !Array.isArray(mcpValue)
            ? Object.keys(mcpValue).length
            : 0;
        continue;
      }

      if (tab.id === 'custom' && activeConfigValues) {
        const endpointsValue = activeConfigValues.endpoints as
          | Record<string, t.ConfigValue>
          | undefined;
        const customArray = endpointsValue?.custom;
        counts[tab.id] = Array.isArray(customArray) ? customArray.length : 0;
        continue;
      }

      const tabSections = schemaTree.filter((section: t.SchemaField) => {
        if (HIDDEN_SECTIONS.has(section.key)) return false;
        if (tab.id === OTHER_TAB.id) return !Object.hasOwn(SECTION_META, section.key);
        return schemaKeyToTabs[section.key]?.includes(tab.id) ?? false;
      });
      let count = 0;
      for (const section of tabSections) {
        const paths = section.children?.length
          ? collectFieldPaths(section.children, section.key)
          : [section.key];
        for (const p of paths) {
          if (tab.id === 'providers' && p.startsWith('endpoints.custom')) continue;
          if (activeConfiguredPaths.has(p)) count++;
        }
      }
      counts[tab.id] = count;
    }
    return counts;
  }, [activeConfiguredPaths, activeConfigValues, visibleTabs, schemaTree]);

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

  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const shouldBlockNavigation = useCallback(
    ({ current, next }: { current: { pathname: string }; next: { pathname: string } }) => {
      if (!isDirty) return false;
      if (current.pathname === next.pathname) return false;
      return !window.confirm(localize('com_config_unsaved_leave'));
    },
    [isDirty, localize],
  );
  const shouldPromptBeforeUnload = useCallback(() => isDirty, [isDirty]);

  useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    enableBeforeUnload: shouldPromptBeforeUnload,
  });

  const handleDiscard = useCallback(() => {
    setEditedValues({});
    setTouchedPaths(new Set());
    setEditSessionId((id) => id + 1);
    setSaveError(null);
  }, []);

  const clearEdits = useCallback(() => {
    setEditedValues({});
    setTouchedPaths(new Set());
    setEditSessionId((id) => id + 1);
    setConfirmSaveOpen(false);
    setSaving(false);
    setSaveError(null);
  }, []);

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
      setEditedValues({});
      setTouchedPaths(new Set());
      setEditSessionId((id) => id + 1);
      setResettingBase(false);
      setResetBaseOpen(false);
      notifySuccess(localize('com_config_reset_base_success'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResettingBase(false);
      setResetBaseError(message);
      notifyError(message);
    }
  }, [resettingBase, queryClient, localize]);

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

  const overridePaths = isEditingScope ? scopeConfiguredPaths : dbOverridePaths;

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
      const source = isEditingScope ? configValues?.mcpServers : baseConfigData?.yamlMcpServers;
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
    baseConfigData,
    localize,
    writeChanges,
    editTarget,
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
    const fallback = isEditingScope ? configValues : baseConfigData?.yamlConfig;
    for (const path of savePlan.resets) {
      const value = getValueAtPath(fallback, path) ?? schemaDefaults[path];
      result[path] = stripSecretPreviewValues(value, path, schemaPathSet);
    }
    return result;
  }, [savePlan, isEditingScope, configValues, baseConfigData, schemaDefaults, schemaPathSet]);

  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);

  const showImportSuccess = useCallback((message?: string) => {
    setImportSuccessMessage(message ?? null);
    setImportSuccess(true);
    clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setImportSuccess(false), 4000);
  }, []);

  /**
   * Imports merge into the chosen target through the same validated write
   * path as Save: only the keys present in the YAML are written (normalized
   * like an edit, so blank values are left out), and nothing else is replaced.
   */
  const handleImport = useCallback(
    async (appConfig: t.ConfigRecord, target: t.WriteTarget) => {
      const { entries, skipped: blank } = collectImportEntries(
        appConfig,
        schemaTree,
        schemaPathSet,
      );
      if (entries.length === 0 && blank.length === 0) {
        throw new Error(localize('com_config_import_nothing'));
      }
      const writeSkipped = entries.length > 0 ? await writeChanges(target, entries, []) : [];
      if (target.type === 'scope') {
        queryClient.invalidateQueries({ queryKey: ['roles'] });
        queryClient.invalidateQueries({ queryKey: ['groups'] });
      }
      const written = Math.max(0, entries.length - writeSkipped.length);
      const message =
        target.type === 'scope'
          ? localize('com_config_import_profile_success', {
              count: written,
              name: target.scope.name,
            })
          : localize('com_config_import_base_success', { count: written });
      if (written > 0) showImportSuccess(message);
      const skipped = [...blank, ...writeSkipped];
      if (skipped.length > 0) announceWrite(skipped, written, message);
    },
    [
      schemaTree,
      schemaPathSet,
      localize,
      writeChanges,
      queryClient,
      showImportSuccess,
      announceWrite,
    ],
  );

  const highlightRef = useHighlightRef(highlightField);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [tocEl, setTocEl] = useState<HTMLElement | null>(null);
  const scrollCallbackRef = useCallback(
    (el: HTMLDivElement | null) => {
      setScrollEl(el);
      highlightRef(el);
    },
    [highlightRef],
  );
  const setActiveSection = useActiveSection(scrollEl, tocEl, activeTab);

  const canEditActiveTab = editableTabIds.has(activeTab);

  /** Route-level gating ensures canView; canEdit reflects per-tab manage capability. */
  const permissions: t.ScopePermissions = useMemo(
    () => ({
      canView: true,
      canEdit: canEditActiveTab,
      canAssign: canAssignConfigs,
    }),
    [canEditActiveTab, canAssignConfigs],
  );

  const sectionsForActiveTab = useMemo((): t.ConfigSectionConfig[] => {
    // Collect virtual section entries (those with schemaKey) that target this tab
    const virtualEntries = Object.entries(SECTION_META).filter(
      ([, m]) => m.schemaKey && m.tab === activeTab,
    );

    const directSections = schemaTree
      .filter((section: t.SchemaField) => {
        if (HIDDEN_SECTIONS.has(section.key)) return false;
        if (activeTab === OTHER_TAB.id) return !Object.hasOwn(SECTION_META, section.key);
        return SECTION_META[section.key]?.tab === activeTab;
      })
      .map((section: t.SchemaField) => {
        const meta = SECTION_META[section.key];
        const children = section.children ?? [];
        const hasStructuredChildren =
          (section.isObject || section.type === 'record') && children.length > 0;
        const readOnlyReason = READ_ONLY_CONFIG_SECTIONS.get(section.key);
        return {
          id: section.key,
          titleKey: meta?.titleKey ?? `com_config_section_${section.key}`,
          title: meta ? undefined : splitCamelCase(section.key).join(' '),
          isRecord: section.type === 'record',
          descriptionKey: meta?.descriptionKey,
          fields: hasStructuredChildren ? children : [],
          ...(!hasStructuredChildren && { sectionField: section }),
          ...(section.key === 'interface' && {
            bannerText: localize('com_config_interface_permissions_info'),
          }),
          ...(readOnlyReason && {
            readOnlyReason,
            bannerText: localize(
              readOnlyReason === 'baseOnly'
                ? 'com_config_base_only_section'
                : 'com_config_yaml_only_section',
            ),
          }),
        };
      });

    // Add virtual sections — these reference another schema section's data
    // but render under a different tab with their own section renderer.
    const virtualSections = virtualEntries.flatMap(([metaKey, meta]) => {
      const schemaSection = schemaTree.find((s: t.SchemaField) => s.key === meta.schemaKey);
      if (!schemaSection) return [];
      const hasStructuredChildren =
        (schemaSection.isObject || schemaSection.type === 'record') &&
        schemaSection.children &&
        schemaSection.children.length > 0;
      return [
        {
          id: metaKey,
          schemaKey: meta.schemaKey,
          titleKey: meta.titleKey,
          descriptionKey: meta.descriptionKey,
          fields: hasStructuredChildren ? (schemaSection.children ?? []) : [],
          ...(!hasStructuredChildren && { sectionField: schemaSection }),
        },
      ];
    });

    const allSections: t.ConfigSectionConfig[] = [...directSections, ...virtualSections].filter(
      (s) => {
        const permKey = 'schemaKey' in s && s.schemaKey ? s.schemaKey : s.id;
        return sectionPermissions[permKey]?.canView === true;
      },
    );

    // Custom Endpoints tab: show configured endpoint names in TOC
    if (activeTab === 'custom' && activeConfigValues) {
      for (const section of allSections) {
        const dataKey = section.schemaKey ?? section.id;
        const sectionValue = activeConfigValues[dataKey] as
          | Record<string, t.ConfigValue>
          | undefined;
        const customArray = sectionValue?.custom;
        section.titleKey = 'com_config_tab_custom_endpoints';
        if (Array.isArray(customArray) && customArray.length > 0) {
          section.tocItems = customArray.map((entry, i) => {
            const obj =
              entry && typeof entry === 'object' && !Array.isArray(entry)
                ? (entry as Record<string, t.ConfigValue>)
                : {};
            const name =
              typeof obj.name === 'string' && obj.name
                ? obj.name
                : localize('com_config_entry_n', { n: String(i + 1) });
            return {
              id: `section-${dataKey}-custom-${i}`,
              label: name,
              dataPath: `${dataKey}.custom`,
            };
          });
        }
      }
    }

    // MCP Servers tab: show configured server names in TOC
    if (activeTab === 'mcp' && activeConfigValues) {
      for (const section of allSections) {
        if (section.id !== 'mcpServers') continue;
        const dataKey = section.schemaKey ?? section.id;
        const mcpValue = activeConfigValues[dataKey];
        if (mcpValue && typeof mcpValue === 'object' && !Array.isArray(mcpValue)) {
          const serverKeys = Object.keys(mcpValue as Record<string, t.ConfigValue>);
          if (serverKeys.length > 0) {
            section.tocItems = serverKeys.map((name) => ({
              id: `section-mcpServers-${encodeURIComponent(name)}`,
              label: name,
              dataPath: `mcpServers.${name}`,
            }));
          }
        }
      }
    }

    // AI Providers tab: show provider names in TOC (excluding 'custom')
    if (activeTab === 'providers') {
      for (const section of allSections) {
        const providerFields = section.fields.filter(
          (f) => f.key !== 'custom' && f.children && f.children.length > 0,
        );
        if (providerFields.length > 0) {
          const dataKey = section.schemaKey ?? section.id;
          section.tocItems = providerFields.map((f) => ({
            id: `section-${dataKey}.${f.key}`,
            label: localize(`com_config_field_${f.key}`),
          }));
        }
      }
    }

    return allSections;
  }, [schemaTree, activeTab, activeConfigValues, localize, sectionPermissions]);

  /** Top-level settings the bundled schema doesn't know (newer LibreChat), listed read-only on System. */
  const topLevelUnknown = useMemo(() => {
    if (activeTab !== 'system' || !activeConfigValues) return undefined;
    const value: Record<string, t.ConfigValue> = {};
    for (const [key, entry] of Object.entries(activeConfigValues)) {
      if (!APP_SERVICE_INTERNAL_KEYS.has(key)) value[key] = entry;
    }
    return { fields: schemaTree, value };
  }, [activeTab, activeConfigValues, schemaTree]);

  const renderBanner = () => {
    if (importSuccess) {
      return (
        <InfoBanner
          text={importSuccessMessage ?? localize('com_config_import_success')}
          dismissible={false}
        />
      );
    }
    return null;
  };

  const banner = renderBanner();

  const resetBaseTitle = (() => {
    if (!canManageConfig) {
      return localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_CONFIGS });
    }
    if (isDirty) return localize('com_config_reset_base_dirty');
    return undefined;
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2">
      <div className="shrink-0 px-4">
        {banner && <div className="pt-4 pb-2">{banner}</div>}
        <HeaderActions
          showImport
          importDisabled={isDirty || !canManageConfig}
          importTitle={
            !canManageConfig
              ? localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_CONFIGS })
              : undefined
          }
          onImportClick={() => setImportOpen(true)}
          showReset={!isEditingScope && dbOverridePaths.size > 0}
          resetDisabled={isDirty || !canManageConfig}
          resetTitle={resetBaseTitle}
          onResetClick={() => {
            setResetBaseError(null);
            setResetBaseOpen(true);
          }}
          showScope={permissions.canView}
          scopeSelection={selectedScope}
          onScopeClick={() => setScopeSelectorOpen(true)}
        />
        <ConfigTabBar
          tabs={visibleTabs}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          tabCounts={tabConfiguredCounts}
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-h-0 flex-1">
          {activeTab !== 'custom' && (
            <div className="pointer-events-none absolute top-2 right-3 z-(--z-floating)">
              <ContentToolbar
                scrollContainer={scrollEl}
                showConfiguredOnly={showConfiguredOnly}
                onShowConfiguredOnlyChange={setShowConfiguredOnly}
                showConfiguredToggle={activeConfiguredPaths.size > 0}
              />
            </div>
          )}
          <div
            className="h-full scrollbar-gutter-stable overflow-auto pl-4"
            ref={scrollCallbackRef}
          >
            <ConfigTabContent
              sections={sectionsForActiveTab}
              configValues={activeConfigValues}
              editedValues={editedValues}
              onFieldChange={handleFieldChange}
              onResetField={handleResetField}
              onDiscardField={handleDiscardField}
              profileMap={profileMap}
              previewMode={false}
              previewScope={editingScope}
              previewChangedPaths={scopeChangedPathsMapped}
              resolvedValues={scopeResolvedValues}
              permissions={permissions}
              onProfileChange={handleProfileChange}
              showChangedOnly={false}
              readOnly={!canEditActiveTab}
              configuredPaths={activeConfiguredPaths}
              dbOverridePaths={isEditingScope ? scopeConfiguredPaths : dbOverridePaths}
              touchedPaths={touchedPaths}
              pendingResets={pendingResets}
              sectionPermissions={sectionPermissions}
              schemaDefaults={schemaDefaults}
              showConfiguredOnly={showConfiguredOnly}
              isEditingScope={isEditingScope}
              baseRecordKeys={baseRecordKeys}
              onValidationError={(message) => notifyError(message)}
              editSessionId={editSessionId}
              unknownSettings={topLevelUnknown}
            />
          </div>
        </div>
        <ConfigTableOfContents
          sections={sectionsForActiveTab}
          scrollContainer={scrollEl}
          tocRef={setTocEl}
          showConfiguredOnly={showConfiguredOnly}
          configuredPaths={activeConfiguredPaths}
          onNavigate={setActiveSection}
        />
      </div>

      {isDirty && canEditActiveTab && (
        <StickyActionBar
          message={localize('com_config_unsaved_changes')}
          discardLabel={localize('com_config_discard')}
          saveLabel={localize('com_config_save')}
          onDiscard={handleDiscard}
          onSave={() => {
            setSaveError(null);
            setConfirmSaveOpen(true);
          }}
        />
      )}

      <ConfirmSaveDialog
        open={confirmSaveOpen}
        title={
          editingScope
            ? localize('com_config_confirm_save_scope_title', { name: editingScope.name })
            : localize('com_config_confirm_save_title')
        }
        editedValues={reviewValues}
        originalValues={originalValuesForDialog}
        revertValues={revertValuesForDialog}
        skipped={savePlan.skipped}
        unsafeKeys={unsafeKeys}
        saving={saving}
        error={saveError}
        onConfirm={handleConfirmSave}
        onCancel={() => {
          setConfirmSaveOpen(false);
          setSaveError(null);
        }}
      />

      <ScopeSelector
        open={scopeSelectorOpen}
        onOpenChange={setScopeSelectorOpen}
        currentSelection={selectedScope}
        onSelect={handleScopeChange}
        permissions={permissions}
        onError={(msg) => notifyError(msg)}
      />

      <ImportYamlDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        currentScope={editingScope}
        onImport={handleImport}
      />

      <ResetBaseConfigDialog
        open={resetBaseOpen}
        resetting={resettingBase}
        error={resetBaseError}
        onConfirm={handleResetBaseConfig}
        onCancel={() => {
          if (resettingBase) return;
          setResetBaseOpen(false);
          setResetBaseError(null);
        }}
      />
    </div>
  );
}

function HeaderActions({
  showImport,
  importDisabled,
  importTitle,
  onImportClick,
  showReset,
  resetDisabled,
  resetTitle,
  onResetClick,
  showScope,
  scopeSelection,
  onScopeClick,
}: {
  showImport: boolean;
  importDisabled: boolean;
  importTitle?: string;
  onImportClick: () => void;
  showReset: boolean;
  resetDisabled: boolean;
  resetTitle?: string;
  onResetClick: () => void;
  showScope: boolean;
  scopeSelection: t.ScopeSelection;
  onScopeClick: () => void;
}) {
  const localize = useLocalize();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.getElementById('header-actions-portal'));
  }, []);

  const content = (
    <>
      {showImport && (
        <button
          type="button"
          onClick={onImportClick}
          disabled={importDisabled}
          aria-disabled={importDisabled || undefined}
          title={importTitle}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover) disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">
            <Icon name="upload" size="xs" />
          </span>
          {localize('com_config_import_yaml')}
        </button>
      )}
      {showReset && (
        <button
          type="button"
          onClick={onResetClick}
          disabled={resetDisabled}
          aria-disabled={resetDisabled || undefined}
          title={resetTitle}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:border-(--cui-color-accent-danger) hover:text-(--cui-color-accent-danger) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-(--cui-color-stroke-default) disabled:hover:text-(--cui-color-text-default)"
        >
          <span aria-hidden="true">
            <Icon name="refresh" size="xs" />
          </span>
          {localize('com_config_reset_base')}
        </button>
      )}
      {showScope && <ScopeTriggerButton currentSelection={scopeSelection} onClick={onScopeClick} />}
    </>
  );

  if (portalTarget) return createPortal(content, portalTarget);
  return null;
}
