import type * as t from '@/types';

/**
 * What an allowlist entry may name and what an empty list means, per path
 * (FX-16). An empty `allowedDomains` lifts the restriction: LibreChat then
 * allows any public host and still blocks private and internal addresses
 * (`isDomainAllowedCore`). Actions only call http(s); MCP servers also use
 * WebSockets.
 */
const DOMAIN_LIST_POLICIES: Readonly<Record<string, t.DomainListPolicy>> = {
  'actions.allowedDomains': {
    protocols: ['http', 'https'],
    emptyKey: 'com_config_features_domains_empty_actions',
    activeKey: 'com_config_features_domains_active_actions',
    confirmKey: 'com_config_features_domains_confirm_actions',
  },
  'mcpSettings.allowedDomains': {
    protocols: ['http', 'https', 'ws', 'wss'],
    emptyKey: 'com_config_features_domains_empty_mcp',
    activeKey: 'com_config_features_domains_active_mcp',
    confirmKey: 'com_config_features_domains_confirm_mcp',
  },
};

const DEFAULT_DOMAIN_POLICY: t.DomainListPolicy = {
  protocols: ['http', 'https', 'ws', 'wss'],
  emptyKey: 'com_config_features_domains_empty',
  activeKey: 'com_config_features_domains_active',
  confirmKey: 'com_config_features_domains_confirm',
};

/** The allowlist policy of a domain list path. */
export function getDomainListPolicy(path: string): t.DomainListPolicy {
  return DOMAIN_LIST_POLICIES[path] ?? DEFAULT_DOMAIN_POLICY;
}

/** Keys LibreChat's admin API stores as typed until `webSearchStoredKeys` adds them to its secret registry. */
const PLAINTEXT_KEYS: ReadonlySet<string> = new Set(['keenableApiKey']);

function credential(key: string, env: string, required: boolean): t.WebSearchCredential {
  const secret = /ApiKey$/.test(key);
  return {
    key,
    env,
    required,
    secret,
    ...(secret && PLAINTEXT_KEYS.has(key) && { encryptedSince: 'webSearchStoredKeys' as const }),
  };
}

/**
 * Whether LibreChat stores the credential encrypted, with a masked preview:
 * every web search key, and Keenable's only on a server with `webSearchStoredKeys`.
 */
export function isEncryptedCredential(
  { secret, encryptedSince }: t.WebSearchCredential,
  features: Pick<t.ConfigFeatures, 'webSearchStoredKeys'>,
): boolean {
  return secret && (encryptedSince === undefined || features[encryptedSince]);
}

const SERPER_KEY = credential('serperApiKey', 'SERPER_API_KEY', true);
const TAVILY_KEY = credential('tavilyApiKey', 'TAVILY_API_KEY', true);
/** Keenable works without a key; one only lifts its rate limits. */
const KEENABLE_KEY = credential('keenableApiKey', 'KEENABLE_API_KEY', false);

/**
 * The services each web search setting selects, and the settings each one
 * reads (`webSearchAuth` in LibreChat's data-schemas: 1 = required, 0 =
 * optional). Every unset credential falls back to its environment variable.
 */
export const WEB_SEARCH_SERVICES: Readonly<Record<t.WebSearchCategory, t.WebSearchService[]>> = {
  providers: [
    {
      value: 'serper',
      labelKey: 'com_config_features_service_serper',
      credentials: [SERPER_KEY],
      optionKeys: [],
    },
    {
      value: 'searxng',
      labelKey: 'com_config_features_service_searxng',
      credentials: [
        credential('searxngInstanceUrl', 'SEARXNG_INSTANCE_URL', true),
        credential('searxngApiKey', 'SEARXNG_API_KEY', false),
      ],
      optionKeys: ['searxngSearchOptions'],
    },
    {
      value: 'tavily',
      labelKey: 'com_config_features_service_tavily',
      credentials: [TAVILY_KEY, credential('tavilySearchUrl', 'TAVILY_SEARCH_URL', false)],
      optionKeys: ['tavilySearchOptions'],
    },
    {
      value: 'keenable',
      labelKey: 'com_config_features_service_keenable',
      credentials: [KEENABLE_KEY, credential('keenableApiUrl', 'KEENABLE_API_URL', false)],
      optionKeys: ['keenableSearchOptions'],
    },
  ],
  scrapers: [
    {
      value: 'firecrawl',
      labelKey: 'com_config_features_service_firecrawl',
      credentials: [
        credential('firecrawlApiKey', 'FIRECRAWL_API_KEY', true),
        credential('firecrawlApiUrl', 'FIRECRAWL_API_URL', false),
        credential('firecrawlVersion', 'FIRECRAWL_VERSION', false),
      ],
      optionKeys: ['firecrawlOptions'],
    },
    {
      value: 'serper',
      labelKey: 'com_config_features_service_serper',
      credentials: [SERPER_KEY],
      optionKeys: [],
    },
    {
      value: 'tavily',
      labelKey: 'com_config_features_service_tavily',
      credentials: [TAVILY_KEY, credential('tavilyExtractUrl', 'TAVILY_EXTRACT_URL', false)],
      optionKeys: ['tavilyScraperOptions'],
    },
    {
      value: 'keenable',
      labelKey: 'com_config_features_service_keenable',
      credentials: [KEENABLE_KEY],
      optionKeys: ['keenableScraperOptions'],
    },
  ],
  rerankers: [
    {
      value: 'jina',
      labelKey: 'com_config_features_service_jina',
      credentials: [
        credential('jinaApiKey', 'JINA_API_KEY', true),
        credential('jinaApiUrl', 'JINA_API_URL', false),
      ],
      optionKeys: [],
    },
    {
      value: 'cohere',
      labelKey: 'com_config_features_service_cohere',
      credentials: [credential('cohereApiKey', 'COHERE_API_KEY', true)],
      optionKeys: [],
    },
  ],
};

/** The `webSearch` key selecting each category's service. */
export const WEB_SEARCH_SELECTORS: Readonly<Record<t.WebSearchCategory, string>> = {
  providers: 'searchProvider',
  scrapers: 'scraperProvider',
  rerankers: 'rerankerType',
};

/** What each category selects, as the service groups name it. */
export const WEB_SEARCH_ROLE_KEYS: Readonly<Record<t.WebSearchCategory, string>> = {
  providers: 'com_config_features_ws_role_providers',
  scrapers: 'com_config_features_ws_role_scrapers',
  rerankers: 'com_config_features_ws_role_rerankers',
};

/** Web search settings shown with the service selectors, before the services. */
export const WEB_SEARCH_GENERAL_KEYS: readonly string[] = [
  'searchProvider',
  'scraperProvider',
  'rerankerType',
  'safeSearch',
  'scraperTimeout',
  'allowedAddresses',
];

/**
 * Interface settings by purpose (FX-5). Keys not listed (new schema fields)
 * are shown in a last "More settings" group, so they still appear.
 */
export const INTERFACE_GROUPS: readonly t.FeatureGroupDef[] = [
  {
    key: 'chat',
    labelKey: 'com_config_features_group_chat',
    descriptionKey: 'com_config_features_group_chat_desc',
    fields: [
      'modelSelect',
      'parameters',
      'presets',
      'contextUsage',
      'contextCost',
      'currency',
      'feedback',
      'autoSubmitFromUrl',
      'defaultPinnedTools',
      'codeHighlightThrottleMs',
      'buildInfo',
      'agentSelectorLimit',
      'composerRecentFiles',
      'runningChatRename',
      'artifactUndocking',
    ],
  },
  {
    key: 'appearance',
    labelKey: 'com_config_features_group_appearance',
    descriptionKey: 'com_config_features_group_appearance_desc',
    fields: ['theme', 'colorModeFromUrl', 'landingHeading', 'landingFooter', 'mascot'],
  },
  {
    key: 'onboarding',
    labelKey: 'com_config_features_group_onboarding',
    descriptionKey: 'com_config_features_group_onboarding_desc',
    fields: ['customWelcome', 'privacyPolicy', 'termsOfService', 'analyticsConsent'],
    flatten: ['privacyPolicy', 'termsOfService'],
  },
  {
    key: 'retention',
    labelKey: 'com_config_features_group_retention',
    descriptionKey: 'com_config_features_group_retention_desc',
    fields: ['retentionMode', 'temporaryChatRetention', 'generalChatRetention', 'retainAgentFiles'],
  },
  {
    key: 'sharing',
    labelKey: 'com_config_features_group_sharing',
    descriptionKey: 'com_config_features_group_sharing_desc',
    fields: ['sharedLinks', 'skills', 'marketplace'],
    flatten: ['sharedLinks', 'skills', 'marketplace'],
  },
  {
    key: 'scheduling',
    labelKey: 'com_config_features_group_scheduling',
    descriptionKey: 'com_config_features_group_scheduling_desc',
    fields: ['schedules'],
  },
  {
    key: 'notifications',
    labelKey: 'com_config_features_group_notifications',
    descriptionKey: 'com_config_features_group_notifications_desc',
    fields: ['replyNotifications'],
    flatten: ['replyNotifications'],
  },
  {
    key: 'traceViewer',
    labelKey: 'com_config_features_group_trace',
    descriptionKey: 'com_config_features_group_trace_desc',
    fields: ['traceViewer'],
    flatten: ['traceViewer'],
  },
  {
    key: 'mcpUi',
    labelKey: 'com_config_features_group_mcp',
    descriptionKey: 'com_config_features_group_mcp_desc',
    fields: ['mcpServers'],
    flatten: ['mcpServers'],
  },
  {
    key: 'performance',
    labelKey: 'com_config_features_group_performance',
    descriptionKey: 'com_config_features_group_performance_desc',
    fields: [
      'historyCacheTtlMs',
      'historyCacheRecent',
      'historyCacheMaxBytes',
      'steerArmConfirmationTimeoutMs',
      'queuedTurnReconciliationTimeoutMs',
      'queuedSendLockTimeoutMs',
    ],
  },
];

/** The group holding interface settings no group lists. */
export const INTERFACE_OTHER_GROUP: t.FeatureGroupDef = {
  key: 'other',
  labelKey: 'com_config_features_group_other',
  fields: [],
};

/**
 * Limits of each summarization trigger type (data-provider
 * `summarizationTriggerSchema`) and the value suggested when it is chosen.
 */
export const TRIGGER_RULES: Readonly<Record<string, t.TriggerRule>> = {
  token_ratio: { min: 0, max: 1, int: false, step: 0.05, suggested: 0.8 },
  remaining_tokens: { min: 1, int: true, step: 1, suggested: 4000 },
  messages_to_refine: { min: 1, int: true, step: 1, suggested: 20 },
};

/** The keys of each memory agent definition (`memorySchema.agent` union branches). */
export const MEMORY_AGENT_KEYS: Readonly<Record<t.MemoryAgentMode, readonly string[]>> = {
  id: ['id'],
  inline: ['provider', 'model', 'instructions', 'model_parameters'],
};

/** The interface controls model specs decide where no layer sets them (`specInterfaceRederive`). */
export const SPEC_CONTROL_KEYS: readonly t.SpecControlKey[] = [
  'modelSelect',
  'parameters',
  'presets',
];
