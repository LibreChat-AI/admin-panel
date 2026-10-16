import { useMemo } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  baseConfigOptions,
  getResolvedConfigFn,
  getLangfuseConnectionFn,
  LANGFUSE_CONNECTION_QUERY_KEY,
} from '@/server';
import { collectFieldPaths, withLangfuseConfiguredPath } from '@/components/configuration/counts';
import { flattenObject, unflattenObject, mapSecretPreviewPaths } from '@/utils';
import { mergeIndexedArrayEdits } from '@/components/configuration/edits';
import { READ_ONLY_CONFIG_SECTIONS } from '@/constants';

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

/**
 * The config layers the page reads (WS4: effective values): the effective base
 * config, the base admin overrides, librechat.yaml alone, and the open
 * profile's own overrides, plus the configured/override path sets for each.
 */
export function useConfigLayers({
  schemaTree,
  selectedScope,
  sectionPermissions,
}: t.ConfigLayersOptions): t.ConfigLayers {
  const { data: baseConfigData } = useQuery(baseConfigOptions);
  const configValues = baseConfigData?.config ?? null;
  const dbOverrides = baseConfigData?.dbOverrides;
  const configuredFromBase = baseConfigData?.configuredFromBase;
  const schemaDefaults = baseConfigData?.schemaDefaults ?? {};
  const flatBaseline = useMemo(() => flattenObject(configValues ?? {}), [configValues]);

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

  const isEditingScope = selectedScope.type === 'SCOPE';

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
  const overridePaths = isEditingScope ? scopeConfiguredPaths : dbOverridePaths;

  return {
    configValues,
    dbOverrides,
    yamlConfig: baseConfigData?.yamlConfig,
    yamlMcpServers: baseConfigData?.yamlMcpServers,
    schemaDefaults,
    flatBaseline,
    fieldPaths,
    schemaPathSet,
    dbOverridePaths,
    baseRecordKeys,
    scopeResolvedValues,
    scopeChangedPaths: scopeChangedPathsMapped,
    baseActiveConfigValues,
    displayConfigValues,
    activeConfiguredPaths,
    overridePaths,
  };
}

/** Overlays pending indexed-array edits onto the displayed config, so lists and the TOC show them (WS4). */
export function usePendingConfigValues(
  displayConfigValues: Record<string, t.ConfigValue> | null,
  editedValues: t.FlatConfigMap,
): Record<string, t.ConfigValue> | null {
  return useMemo(() => {
    if (!displayConfigValues) return displayConfigValues;
    const indexedEdits = Object.entries(editedValues).filter(([k]) => /\.\d+$/.test(k));
    if (indexedEdits.length === 0) return displayConfigValues;
    return mergeIndexedArrayEdits(displayConfigValues, indexedEdits);
  }, [displayConfigValues, editedValues]);
}
