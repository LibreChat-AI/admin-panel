/**
 * Manual mapping of config sections to tabs and human-readable descriptions.
 *
 * The config *fields* are loaded dynamically from the schema at runtime — adding
 * a new field or nested object in configSchema surfaces it in the UI automatically.
 * However, the schema alone doesn't carry enough information to know:
 *
 *   1. Which tab a top-level section belongs to (endpoints, mcp, ai, files, etc.)
 *   2. What the localized title/description for each section should be
 *
 * So we maintain this map by hand. Any section key not listed here falls into the
 * catch-all "Other" tab, where the UI falls back to a generated i18n key like
 * `com_config_section_${section.key}` for its label and description.
 *
 * Long-term this could be eliminated by enriching @librechat/data-schemas:
 *   - Add a `tab` (or `category`) field to each root-level config group in the
 *     schema itself, mirroring the tab structure defined in CONFIG_TABS.
 *   - Add `titleKey` and `descriptionKey` fields (or a `meta` object) to each
 *     group so localization keys ship alongside the schema rather than being
 *     duplicated here. The admin panel would then just iterate the schema groups
 *     and read their metadata directly.
 *
 * That refactor is out of scope for now since it requires changes to the shared
 * data-schemas package, but it would remove the need for any manual mapping on
 * the admin panel side entirely.
 */

import type * as t from '@/types';

export const CONFIG_TABS: t.ConfigTab[] = [
  { id: 'providers', labelKey: 'com_config_tab_ai_providers' },
  { id: 'custom', labelKey: 'com_config_tab_custom_endpoints' },
  { id: 'specs', labelKey: 'com_config_tab_model_specs' },
  { id: 'mcp', labelKey: 'com_config_tab_mcp' },
  { id: 'features', labelKey: 'com_config_tab_features' },
  { id: 'files', labelKey: 'com_config_tab_files' },
  { id: 'system', labelKey: 'com_config_tab_system' },
];

export const OTHER_TAB: t.ConfigTab = { id: 'other', labelKey: 'com_config_tab_other' };

export const SECTION_META: Record<
  string,
  { titleKey: string; descriptionKey: string; tab: string; schemaKey?: string }
> = {
  interface: {
    titleKey: 'com_config_section_interface',
    descriptionKey: 'com_config_section_interface_desc',
    tab: 'features',
  },
  modelSpecs: {
    titleKey: 'com_config_section_model_specs',
    descriptionKey: 'com_config_section_model_specs_desc',
    tab: 'specs',
  },
  speech: {
    titleKey: 'com_config_section_speech',
    descriptionKey: 'com_config_section_speech_desc',
    tab: 'features',
  },
  actions: {
    titleKey: 'com_config_section_actions',
    descriptionKey: 'com_config_section_actions_desc',
    tab: 'features',
  },
  memory: {
    titleKey: 'com_config_section_memory',
    descriptionKey: 'com_config_section_memory_desc',
    tab: 'features',
  },
  webSearch: {
    titleKey: 'com_config_section_web_search',
    descriptionKey: 'com_config_section_web_search_desc',
    tab: 'features',
  },
  ocr: {
    titleKey: 'com_config_section_ocr',
    descriptionKey: 'com_config_section_ocr_desc',
    tab: 'features',
  },
  filteredTools: {
    titleKey: 'com_config_section_filteredTools',
    descriptionKey: 'com_config_section_filteredTools_desc',
    tab: 'features',
  },
  includedTools: {
    titleKey: 'com_config_section_includedTools',
    descriptionKey: 'com_config_section_includedTools_desc',
    tab: 'features',
  },
  summarization: {
    titleKey: 'com_config_section_summarization',
    descriptionKey: 'com_config_section_summarization_desc',
    tab: 'features',
  },
  messageFilter: {
    titleKey: 'com_config_section_messageFilter',
    descriptionKey: 'com_config_section_messageFilter_desc',
    tab: 'features',
  },
  filters: {
    titleKey: 'com_config_section_filters',
    descriptionKey: 'com_config_section_filters_desc',
    tab: 'features',
  },
  langfuse: {
    titleKey: 'com_config_section_langfuse',
    descriptionKey: 'com_config_section_langfuse_desc',
    tab: 'features',
  },

  fileConfig: {
    titleKey: 'com_config_section_file_config',
    descriptionKey: 'com_config_section_file_config_desc',
    tab: 'files',
  },
  fileStrategy: {
    titleKey: 'com_config_section_file_strategy',
    descriptionKey: 'com_config_section_file_strategy_desc',
    tab: 'files',
  },
  fileStrategies: {
    titleKey: 'com_config_section_fileStrategies',
    descriptionKey: 'com_config_section_fileStrategies_desc',
    tab: 'files',
  },
  cloudfront: {
    titleKey: 'com_config_section_cloudfront',
    descriptionKey: 'com_config_section_cloudfront_desc',
    tab: 'files',
  },
  imageOutputType: {
    titleKey: 'com_config_section_imageOutputType',
    descriptionKey: 'com_config_section_imageOutputType_desc',
    tab: 'files',
  },

  endpoints: {
    titleKey: 'com_config_section_endpoints',
    descriptionKey: 'com_config_section_endpoints_desc',
    tab: 'custom',
  },
  endpointsProviders: {
    titleKey: 'com_config_section_ai_providers',
    descriptionKey: 'com_config_section_ai_providers_desc',
    tab: 'providers',
    schemaKey: 'endpoints',
  },
  mcpServers: {
    titleKey: 'com_config_section_mcp_servers',
    descriptionKey: 'com_config_section_mcp_servers_desc',
    tab: 'mcp',
  },
  mcpSettings: {
    titleKey: 'com_config_section_mcp_settings',
    descriptionKey: 'com_config_section_mcp_settings_desc',
    tab: 'mcp',
  },

  rateLimits: {
    titleKey: 'com_config_section_rate_limits',
    descriptionKey: 'com_config_section_rate_limits_desc',
    tab: 'system',
  },
  balance: {
    titleKey: 'com_config_section_balance',
    descriptionKey: 'com_config_section_balance_desc',
    tab: 'system',
  },

  secureImageLinks: {
    titleKey: 'com_config_section_secureImageLinks',
    descriptionKey: 'com_config_section_secureImageLinks_desc',
    tab: 'system',
  },

  registration: {
    titleKey: 'com_config_section_registration',
    descriptionKey: 'com_config_section_registration_desc',
    tab: 'system',
  },
  turnstile: {
    titleKey: 'com_config_section_turnstile',
    descriptionKey: 'com_config_section_turnstile_desc',
    tab: 'system',
  },
  transactions: {
    titleKey: 'com_config_section_transactions',
    descriptionKey: 'com_config_section_transactions_desc',
    tab: 'system',
  },
  skillSync: {
    titleKey: 'com_config_section_skillSync',
    descriptionKey: 'com_config_section_skillSync_desc',
    tab: 'system',
  },
  permissions: {
    titleKey: 'com_config_section_permissions',
    descriptionKey: 'com_config_section_permissions_desc',
    tab: 'system',
  },
  openapi: {
    titleKey: 'com_config_section_openapi',
    descriptionKey: 'com_config_section_openapi_desc',
    tab: 'system',
  },
};

/** Sections omitted from the UI entirely (legacy fields pending removal from the schema). */
export const HIDDEN_SECTIONS = new Set(['version', 'cache']);

export function splitCamelCase(str: string): string[] {
  return str.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/);
}
