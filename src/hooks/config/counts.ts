import { useMemo } from 'react';
import type * as t from '@/types';
import { OTHER_TAB, SECTION_META, HIDDEN_SECTIONS } from '@/components/configuration/configMeta';
import { collectFieldPaths } from '@/components/configuration/counts';

/** Configured-setting count per visible tab, for the tab bar badges (WS4). */
export function useTabCounts({
  schemaTree,
  visibleTabs,
  activeConfiguredPaths,
  activeConfigValues,
}: t.TabCountsOptions): Record<string, number> {
  return useMemo(() => {
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
}
