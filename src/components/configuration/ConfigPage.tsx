import { createPortal } from 'react-dom';
import { Icon } from '@clickhouse/click-ui';
import { PrincipalType } from 'librechat-data-provider';
import { getRouteApi, useBlocker, useNavigate } from '@tanstack/react-router';
import { useState, useMemo, useRef, useCallback, useEffect, startTransition } from 'react';
import { queryOptions, useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  removeFieldProfileValueFn,
  tombstoneFieldProfileValueFn,
  bulkSaveProfileValuesFn,
  getBatchFieldProfilesFn,
  availableScopesOptions,
  resetBaseConfigFieldFn,
  getResolvedConfigFn,
  importBaseConfigFn,
  resetBaseConfigFn,
  baseConfigOptions,
  saveBaseConfigFn,
} from '@/server';
import {
  flattenObject,
  unflattenObject,
  serializeKVPairs,
  deepSerializeKVPairs,
  normalizeImportConfig,
  hasConfigCapability,
  getTabsWithPermission,
  notifySuccess,
  notifyError,
} from '@/utils';
import { useLocalize, useHighlightRef, useActiveSection, useCapabilities } from '@/hooks';
import { CONFIG_TABS, OTHER_TAB, SECTION_META, HIDDEN_SECTIONS } from './configMeta';
import { mergeIndexedArrayEdits, partitionScopeResetPaths } from './utils';
import { validateMcpCrossField } from './sections/McpServersRenderer';
import { ScopeSelector, ScopeTriggerButton } from './ScopeSelector';
import { StickyActionBar } from '@/components/shared';
import { ConfigTableOfContents } from './ConfigTableOfContents';
import { ResetBaseConfigDialog } from './ResetBaseConfigDialog';
import { ConfirmSaveDialog } from './ConfirmSaveDialog';
import { ConfigTabContent } from './ConfigTabContent';
import { ImportYamlDialog } from './ImportYamlDialog';
import { ContentToolbar } from './ContentToolbar';
import { SystemCapabilities } from '@/constants';
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

  const configuredPaths = useMemo(() => {
    const paths = new Set<string>();
    if (configuredFromBase) {
      for (const p of configuredFromBase) paths.add(p);
    }
    if (dbOverrides) {
      for (const p of Object.keys(flattenObject(dbOverrides))) paths.add(p);
    }
    return paths;
  }, [configuredFromBase, dbOverrides]);

  const dbOverridePaths = useMemo(() => {
    if (!dbOverrides) return new Set<string>();
    return new Set(Object.keys(flattenObject(dbOverrides)));
  }, [dbOverrides]);

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

  const fieldPaths = useMemo(() => collectFieldPaths(schemaTree), [schemaTree]);
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

  const activeConfigValues = useMemo(() => {
    if (!baseActiveConfigValues) return baseActiveConfigValues;
    const indexedEdits = Object.entries(editedValues).filter(([k]) => /\.\d+$/.test(k));
    if (indexedEdits.length === 0) return baseActiveConfigValues;
    return mergeIndexedArrayEdits(baseActiveConfigValues, indexedEdits);
  }, [baseActiveConfigValues, editedValues]);

  const scopeConfiguredPaths = useMemo(() => {
    if (!scopeChangedPaths) return new Set<string>();
    return new Set(scopeChangedPaths);
  }, [scopeChangedPaths]);

  const activeConfiguredPaths = isEditingScope ? scopeConfiguredPaths : configuredPaths;

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

  const handleFieldChange = useCallback(
    (path: string, value: t.ConfigValue) => {
      setTouchedPaths((prev) => {
        if (prev.has(path)) return prev;
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      setEditedValues((prev) => {
        const baseline = scopeBaseline[path];
        const match =
          value === baseline ||
          (typeof value === 'object' &&
            typeof baseline === 'object' &&
            JSON.stringify(value) === JSON.stringify(baseline));
        /** A container-path undefined write must survive; baseline only stores leaves, so it would otherwise match `undefined === undefined` and get pruned. baselineContainerPaths catches the orphaned empty-object case where leaf-derived intermediates miss the entry. */
        const isContainerDelete =
          value === undefined &&
          (baselineIntermediates.has(path) || baselineContainerPaths.has(path));
        /** When the user deleted a container entry and is now writing descendants under it (delete-then-recreate of an MCP server), the new leaf must persist even if it matches baseline so the post-DELETE recreate is not missing required fields, and the ancestor-undefined must outlive the descendant write so handleConfirmSave can DELETE the entry before PATCHing the new leaves. Walk ancestors directly instead of scanning every pending edit; rename/remove emit one onChange per leaf and the prior O(n)-per-call scan compounded to O(n*m) work per event. */
        const hasPendingAncestorDelete = (() => {
          let lastDot = path.lastIndexOf('.');
          while (lastDot > 0) {
            const ancestor = path.slice(0, lastDot);
            if (ancestor in prev && prev[ancestor] === undefined) return true;
            lastDot = ancestor.lastIndexOf('.');
          }
          return false;
        })();
        if (match && !isContainerDelete && !hasPendingAncestorDelete) {
          const next = { ...prev };
          delete next[path];
          return next;
        }
        const next = { ...prev, [path]: value };
        if (Array.isArray(value)) {
          const prefix = `${path}.`;
          for (const k of Object.keys(next)) {
            if (k.startsWith(prefix) && /\.\d+$/.test(k)) delete next[k];
          }
        }
        const indexMatch = /^(.+)\.\d+$/.exec(path);
        if (indexMatch) delete next[indexMatch[1]];
        /** Two-way dedup: drop ancestors that the new leaf supersedes AND descendants that the new parent supersedes. An ancestor whose value is `undefined` expresses "delete this whole subtree" and must outlive subsequent descendant writes so DELETE-then-PATCH ordering at save time can fully replace the entry instead of leaking stale fields. */
        for (const existing of Object.keys(next)) {
          if (existing === path) continue;
          const newIsDescendant = path.startsWith(`${existing}.`);
          const newIsAncestor = existing.startsWith(`${path}.`);
          if (newIsDescendant && next[existing] === undefined) continue;
          if (newIsDescendant || newIsAncestor) {
            delete next[existing];
          }
        }
        return next;
      });
    },
    [scopeBaseline, baselineIntermediates, baselineContainerPaths],
  );

  const isDirty = Object.keys(editedValues).length > 0;

  const pendingResets = useMemo(() => {
    const resets = new Set<string>();
    for (const [k, v] of Object.entries(editedValues)) {
      if (v === undefined) resets.add(k);
    }
    return resets;
  }, [editedValues]);

  useBlocker({
    shouldBlockFn: ({ current, next }) => {
      if (!isDirty) return false;
      if (current.pathname === next.pathname) return false;
      return !window.confirm(localize('com_config_unsaved_leave'));
    },
  });

  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleDiscard = useCallback(() => {
    setEditedValues({});
    setTouchedPaths(new Set());
  }, []);

  const clearEdits = useCallback(() => {
    setEditedValues({});
    setTouchedPaths(new Set());
    setConfirmSaveOpen(false);
    setSaving(false);
    setSaveError(null);
    notifySuccess(localize('com_config_saved'));
  }, [localize]);

  const invalidateAndResetBase = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['baseConfig'] });
    clearEdits();
  }, [queryClient, clearEdits]);

  const invalidateAndResetScope = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] });
    queryClient.invalidateQueries({ queryKey: ['profileMap'] });
    queryClient.invalidateQueries({ queryKey: ['availableScopes'] });
    clearEdits();
  }, [queryClient, clearEdits]);

  const importMutation = useMutation({
    mutationFn: (config: Record<string, t.ConfigValue>) => importBaseConfigFn({ data: { config } }),
    onError: (err: Error) => notifyError(err.message),
    onSuccess: invalidateAndResetBase,
  });

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

  const handleConfirmSave = useCallback(async () => {
    if (saving) return;
    const touched = [...touchedPaths].filter((p) => p in editedValues);
    if (touched.length === 0) return;

    /** Per-leaf saves can land an MCP entry in a transport state whose required siblings are missing (e.g. type=stdio with no command/args). Server-side per-field validation only sees one path at a time, so do the cross-field check here against the merged effective entry before any PATCH fires. Use baseActiveConfigValues so scope-mode edits validate against the scope-resolved baseline (where prior scope overrides supply some required fields) instead of the base config alone. */
    const mcpBaseline = (() => {
      const v = baseActiveConfigValues?.mcpServers;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, t.ConfigValue>;
      }
      return {};
    })();
    const mcpEdits: Array<[string, t.ConfigValue]> = touched
      .filter((p) => p.startsWith('mcpServers.'))
      .map((p) => [p, editedValues[p]] as [string, t.ConfigValue]);
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

    const saves = touched
      .filter((p) => editedValues[p] !== undefined)
      .map((p) => ({
        fieldPath: p,
        value: /\.\d+$/.test(p)
          ? deepSerializeKVPairs(editedValues[p])
          : serializeKVPairs(editedValues[p]),
      }));
    const resets = touched.filter((p) => editedValues[p] === undefined);
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
      /** Resets must land before saves so a delete-then-recreate at the same path (e.g. MCP entry replaced with different fields) wipes stale fields first and the new leaf PATCHes don't race against the DELETE. */
      if (resets.length > 0) {
        const resetPromises = isEditingScope
          ? (() => {
              const { resetPaths, tombstonePaths } = partitionScopeResetPaths(
                resets,
                inheritedMcpKeys,
              );
              return [
                ...resetPaths.map((fieldPath) =>
                  removeFieldProfileValueFn({
                    data: {
                      fieldPath,
                      principalType: editingScope!.principalType,
                      principalId: editingScope!.principalId,
                    },
                  }),
                ),
                ...tombstonePaths.map((fieldPath) =>
                  tombstoneFieldProfileValueFn({
                    data: {
                      fieldPath,
                      principalType: editingScope!.principalType,
                      principalId: editingScope!.principalId,
                    },
                  }),
                ),
              ];
            })()
          : resets.map((fieldPath) => resetBaseConfigFieldFn({ data: { fieldPath } }));
        if (resetPromises.length > 0) {
          await Promise.all(resetPromises);
        }
      }

      if (saves.length > 0) {
        if (isEditingScope) {
          await bulkSaveProfileValuesFn({
            data: {
              principalType: editingScope!.principalType,
              principalId: editingScope!.principalId,
              entries: saves,
            },
          });
        } else {
          await saveBaseConfigFn({ data: { entries: saves } });
        }
      }

      if (isEditingScope) {
        invalidateAndResetScope();
      } else {
        invalidateAndResetBase();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaving(false);
      setSaveError(message);
      notifyError(message);
    }
  }, [
    touchedPaths,
    editedValues,
    saving,
    isEditingScope,
    baseActiveConfigValues,
    configValues,
    baseConfigData,
    localize,
    editingScope,
    invalidateAndResetScope,
    invalidateAndResetBase,
  ]);

  const serializedEditedValues = useMemo(() => {
    const result: t.FlatConfigMap = {};
    for (const [k, v] of Object.entries(editedValues)) {
      result[k] = /\.\d+$/.test(k) ? deepSerializeKVPairs(v) : serializeKVPairs(v);
    }
    return result;
  }, [editedValues]);

  const originalValuesForDialog = useMemo(() => {
    const baseline = isEditingScope ? scopeBaseline : flatBaseline;
    const result: t.FlatConfigMap = { ...baseline };
    for (const path of Object.keys(editedValues)) {
      if (path in result) continue;
      const segments = path.split('.');
      let current: t.ConfigValue = configValues;
      for (const seg of segments) {
        if (current == null || typeof current !== 'object') {
          current = undefined;
          break;
        }
        current = Array.isArray(current)
          ? (current as t.ConfigValue[])[Number(seg)]
          : (current as Record<string, t.ConfigValue>)[seg];
      }
      if (current !== undefined) result[path] = current;
    }
    return result;
  }, [editedValues, flatBaseline, isEditingScope, scopeBaseline, configValues]);

  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);

  const showImportSuccess = useCallback((message?: string) => {
    setImportSuccessMessage(message ?? null);
    setImportSuccess(true);
    clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setImportSuccess(false), 4000);
  }, []);

  const handleImportAsProfile = useCallback(
    async (appConfig: Record<string, t.ConfigValue>, scope: t.ConfigScope) => {
      const normalized = normalizeImportConfig(appConfig);
      const flat = flattenObject(normalized);
      const entries = Object.entries(flat)
        .filter(([, value]) => value != null)
        .map(([fieldPath, value]) => ({ fieldPath, value }));
      await bulkSaveProfileValuesFn({
        data: {
          principalType: scope.principalType,
          principalId: scope.principalId,
          entries,
        },
      });
      queryClient.invalidateQueries({ queryKey: ['profileMap'] });
      queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] });
      queryClient.invalidateQueries({ queryKey: ['availableScopes'] });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      showImportSuccess(
        localize('com_config_import_profile_success', {
          count: entries.length,
          name: scope.name,
        }),
      );
    },
    [queryClient, localize, showImportSuccess],
  );

  const handleImport = useCallback(
    (appConfig: Record<string, t.ConfigValue>) => {
      const normalized = normalizeImportConfig(appConfig);
      if (isEditingScope && editingScope) {
        handleImportAsProfile(normalized, editingScope).catch((err: Error) => {
          notifyError(err.message);
        });
      } else {
        importMutation.mutate(normalized, { onSuccess: () => showImportSuccess() });
      }
    },
    [isEditingScope, editingScope, importMutation, showImportSuccess, handleImportAsProfile],
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
        return {
          id: section.key,
          titleKey: meta?.titleKey ?? `com_config_section_${section.key}`,
          descriptionKey: meta?.descriptionKey,
          fields: hasStructuredChildren ? children : [],
          ...(!hasStructuredChildren && { sectionField: section }),
          ...(section.key === 'interface' && {
            bannerText: localize('com_config_interface_permissions_info'),
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
    <div className="admin-content-page flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0">
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
          <div className="h-full scrollbar-gutter-stable overflow-auto" ref={scrollCallbackRef}>
            <ConfigTabContent
              sections={sectionsForActiveTab}
              configValues={activeConfigValues}
              editedValues={editedValues}
              onFieldChange={handleFieldChange}
              onResetField={handleResetField}
              profileMap={profileMap}
              previewMode={false}
              previewScope={editingScope}
              previewChangedPaths={scopeChangedPaths}
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
          onSave={() => setConfirmSaveOpen(true)}
        />
      )}

      <ConfirmSaveDialog
        open={confirmSaveOpen}
        editedValues={serializedEditedValues}
        originalValues={originalValuesForDialog}
        saving={saving}
        error={saveError}
        onConfirm={handleConfirmSave}
        onCancel={() => setConfirmSaveOpen(false)}
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
        onImport={handleImport}
        onImportAsProfile={handleImportAsProfile}
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
