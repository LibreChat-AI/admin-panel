import { useMemo } from 'react';
import type * as t from '@/types';
import {
  OTHER_TAB,
  SECTION_META,
  HIDDEN_SECTIONS,
  splitCamelCase,
} from '@/components/configuration/configMeta';
import { READ_ONLY_CONFIG_SECTIONS } from '@/constants';
import { useLocalize } from '../useLocalize';

/**
 * The sections of the active tab, with the table-of-contents entries for
 * collection tabs (custom endpoints, MCP servers, providers) (WS5: page shell).
 */
export function useTabSections({
  schemaTree,
  activeTab,
  activeConfigValues,
  sectionPermissions,
}: t.TabSectionsOptions): t.ConfigSectionConfig[] {
  const localize = useLocalize();

  return useMemo((): t.ConfigSectionConfig[] => {
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
}
