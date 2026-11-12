import { EModelEndpoint, defaultAssistantsVersion } from 'librechat-data-provider';
import type * as t from '@/types';
import { MODEL_PROVIDERS, GLOBAL_PROVIDER_KEY, DEFAULT_RECURSION_LIMIT } from '@/constants';
import { GENERIC_FIELD_META } from './generic';

/** Settings shared by every endpoint, in the order admins think about them. */
const TITLE_FIELDS = [
  'titleConvo',
  'titleModel',
  'titleMethod',
  'titleEndpoint',
  'titlePrompt',
  'titlePromptTemplate',
  'titleTiming',
];

const ACTIVITY_FIELDS = [
  'activityLabel',
  'activityModel',
  'activityEndpoint',
  'activityPrompt',
  'activityMaxPerRun',
  'activityCharLimit',
  'activityPhaseLabel',
  'activityPhaseModel',
  'activityPhaseEndpoint',
  'activityPhasePrompt',
  'activityPhaseMaxPerRun',
];

const REASONING_FIELDS = [
  'reasoningLabel',
  'reasoningLabelModel',
  'reasoningLabelEndpoint',
  'reasoningLabelPrompt',
  'reasoningLabelMinChars',
  'reasoningLabelUpdateChars',
  'reasoningLabelUpdateIntervalMs',
  'reasoningLabelMaxPerRun',
];

const TITLES: t.ProviderGroupDef = {
  key: 'titles',
  labelKey: 'com_config_providers_group_titles',
  descriptionKey: 'com_config_providers_group_titles_desc',
  fields: TITLE_FIELDS,
};

const ACTIVITY: t.ProviderGroupDef = {
  key: 'activity',
  labelKey: 'com_config_providers_group_activity',
  descriptionKey: 'com_config_providers_group_activity_desc',
  fields: ACTIVITY_FIELDS,
};

const REASONING: t.ProviderGroupDef = {
  key: 'reasoning',
  labelKey: 'com_config_providers_group_reasoning',
  descriptionKey: 'com_config_providers_group_reasoning_desc',
  fields: REASONING_FIELDS,
};

const STREAMING: t.ProviderGroupDef = {
  key: 'streaming',
  labelKey: 'com_config_providers_group_streaming',
  descriptionKey: 'com_config_providers_group_streaming_desc',
  fields: ['streamRate', 'maxToolResultChars'],
};

const ADVANCED: t.ProviderGroupDef = {
  key: 'advanced',
  labelKey: 'com_config_providers_group_advanced',
  descriptionKey: 'com_config_providers_group_advanced_desc',
  fields: ['headers'],
};

/** Built-in providers take their base URL (and Assistants its key and models) from the environment. */
function unused(fields: string[]): t.ProviderGroupDef {
  return {
    key: 'unused',
    labelKey: 'com_config_providers_group_unused',
    descriptionKey: 'com_config_providers_group_unused_desc',
    fields,
    unused: true,
  };
}

/** The models a built-in provider lists, before (or instead of) the ones it fetches. */
const MODELS: t.ProviderGroupDef = {
  key: 'models',
  labelKey: 'com_config_providers_group_models',
  fields: ['models'],
  expanded: true,
};

const LABEL_GROUPS = [TITLES, ACTIVITY, REASONING];
const STANDARD_TAIL = [...LABEL_GROUPS, STREAMING, ADVANCED];

const ASSISTANTS_LAYOUT: t.ProviderGroupDef[] = [
  {
    key: 'assistants',
    labelKey: 'com_config_providers_group_assistants',
    descriptionKey: 'com_config_providers_group_assistants_desc',
    fields: [
      'capabilities',
      'disableBuilder',
      'privateAssistants',
      'retrievalModels',
      'supportedIds',
      'excludedIds',
      'version',
    ],
    expanded: true,
    pairs: [
      ['disableBuilder', 'privateAssistants'],
      ['supportedIds', 'excludedIds'],
    ],
  },
  ...LABEL_GROUPS,
  { ...STREAMING, fields: ['streamRate', 'pollIntervalMs', 'timeoutMs', 'maxToolResultChars'] },
  ADVANCED,
  unused(['apiKey', 'baseURL', 'models']),
];

/**
 * Purpose groups of each provider card (AP-4), most important first. Child
 * keys a layout leaves out (a newer schema) fall into Advanced, so the tab
 * stays schema-driven; `layouts.test.ts` lists them so they get a home.
 */
export const PROVIDER_LAYOUTS: Readonly<Record<string, t.ProviderGroupDef[]>> = {
  [GLOBAL_PROVIDER_KEY]: STANDARD_TAIL,
  openAI: [MODELS, ...STANDARD_TAIL, unused(['baseURL'])],
  google: [MODELS, ...STANDARD_TAIL, unused(['baseURL'])],
  anthropic: [
    {
      key: 'models',
      labelKey: 'com_config_providers_group_models',
      fields: ['models', 'vertex'],
      expanded: true,
    },
    ...STANDARD_TAIL,
    unused(['baseURL']),
  ],
  azureOpenAI: [
    {
      key: 'groups',
      labelKey: 'com_config_providers_group_azure',
      descriptionKey: 'com_config_providers_group_azure_desc',
      fields: ['groups', 'assistants'],
      expanded: true,
    },
    ...LABEL_GROUPS,
    STREAMING,
    ADVANCED,
  ],
  azureAssistants: ASSISTANTS_LAYOUT,
  assistants: ASSISTANTS_LAYOUT,
  agents: [
    {
      key: 'features',
      labelKey: 'com_config_providers_group_features',
      descriptionKey: 'com_config_providers_group_features_desc',
      fields: [
        'capabilities',
        'disableBuilder',
        'allowedProviders',
        'recursionLimit',
        'maxRecursionLimit',
      ],
      expanded: true,
      pairs: [
        ['disableBuilder', 'allowedProviders'],
        ['recursionLimit', 'maxRecursionLimit'],
      ],
    },
    ...LABEL_GROUPS,
    {
      key: 'citations',
      labelKey: 'com_config_providers_group_citations',
      descriptionKey: 'com_config_providers_group_citations_desc',
      fields: ['maxCitations', 'maxCitationsPerFile', 'minRelevanceScore'],
    },
    {
      key: 'code',
      labelKey: 'com_config_providers_group_code',
      descriptionKey: 'com_config_providers_group_code_desc',
      fields: [
        'codeApiUploadConcurrency',
        'codeApiMaxRetryWaitMs',
        'repositoryInstructions',
        'fileSharing',
        'statefulCodeSessions',
        'workspaceAttachments',
        'hostFileEdits',
        'pullRequests',
      ],
    },
    {
      key: 'background',
      labelKey: 'com_config_providers_group_background',
      descriptionKey: 'com_config_providers_group_background_desc',
      fields: ['backgroundTasks', 'eventDriven', 'subagentActivity'],
    },
    {
      key: 'approval',
      labelKey: 'com_config_providers_group_approval',
      descriptionKey: 'com_config_providers_group_approval_desc',
      fields: ['toolApproval', 'askUserQuestion'],
    },
    {
      key: 'apis',
      labelKey: 'com_config_providers_group_apis',
      descriptionKey: 'com_config_providers_group_apis_desc',
      fields: ['managementApi', 'remoteApi'],
    },
    {
      key: 'limits',
      labelKey: 'com_config_providers_group_limits',
      descriptionKey: 'com_config_providers_group_limits_desc',
      fields: [
        'maxSubagents',
        'streamRate',
        'streamKeepaliveIntervalMs',
        'maxToolResultChars',
        'maxProviderErrorChars',
        'modelResponseHeadersTimeoutMs',
        'modelResponseBodyTimeoutMs',
        'maxToolCallArgBytes',
        'maxToolCallArgBytesByTool',
        'maxDeltaEventsPerTurn',
        'maxRetainedToolCountChars',
        'skills',
        'linkedInstructions',
        'avatarRefresh',
      ],
    },
    {
      key: 'checkpointer',
      labelKey: 'com_config_providers_group_checkpointer',
      descriptionKey: 'com_config_providers_group_checkpointer_desc',
      fields: ['checkpointer'],
    },
    ADVANCED,
  ],
  bedrock: [
    {
      key: 'models',
      labelKey: 'com_config_providers_group_models',
      descriptionKey: 'com_config_providers_group_models_bedrock_desc',
      fields: ['models', 'availableRegions', 'inferenceProfiles'],
      expanded: true,
    },
    {
      key: 'guardrails',
      labelKey: 'com_config_providers_group_guardrails',
      descriptionKey: 'com_config_providers_group_guardrails_desc',
      fields: ['guardrailConfig'],
    },
    ...STANDARD_TAIL,
    unused(['baseURL']),
  ],
};

/** The layout of a provider the panel does not know yet: the shared endpoint groups. */
export const DEFAULT_PROVIDER_LAYOUT: readonly t.ProviderGroupDef[] = STANDARD_TAIL;

/** Agent capabilities with plain-language labels and one-line descriptions (AP-6). */
const AGENT_CAPABILITIES = [
  'execute_code',
  'file_search',
  'web_search',
  'artifacts',
  'actions',
  'tools',
  'context',
  'ocr',
  'memory',
  'skills',
  'subagents',
  'ask_user_question',
  'deferred_tools',
  'run_in_background',
  'tool_intents',
  'stateful_code_sessions',
  'programmatic_tools',
  'end_after_tools',
  'hide_sequential_outputs',
  'chain',
];

const ASSISTANT_CAPABILITIES = [
  'code_interpreter',
  'image_vision',
  'retrieval',
  'actions',
  'tools',
];

/** Labels `com_config_providers_<kind>_<value>` and descriptions `…_desc` for a capability list. */
function capabilityMeta(kind: 'cap' | 'acap', values: string[]): t.FieldMeta {
  const key = (value: string) => `com_config_providers_${kind}_${value}`;
  return {
    control: 'multi-enum',
    order: values,
    enumLabels: Object.fromEntries(values.map((value) => [value, key(value)])),
    enumDescriptions: Object.fromEntries(values.map((value) => [value, `${key(value)}_desc`])),
  };
}

/** `*Model` fields of a provider suggest that provider's models (AP-9). */
const MODEL_REFERENCE_FIELDS = [
  'titleModel',
  'activityModel',
  'activityPhaseModel',
  'reasoningLabelModel',
];

function modelReferenceMeta(): t.FieldMetaRegistry {
  /** Global's model fields suggest the models of the endpoint set beside them, if any. */
  const entries: t.FieldMetaRegistry = Object.fromEntries(
    MODEL_REFERENCE_FIELDS.map((key) => [
      `endpoints.${GLOBAL_PROVIDER_KEY}.${key}`,
      { optionSource: 'models:' },
    ]),
  );
  for (const provider of MODEL_PROVIDERS) {
    for (const key of MODEL_REFERENCE_FIELDS) {
      entries[`endpoints.${provider}.${key}`] = { optionSource: `models:${provider}` };
    }
  }
  return entries;
}

/** Descriptions the shared endpoint registry leaves out, keyed by path. */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'endpoints.{}.activityPhaseModel': 'com_config_providers_desc_activityPhaseModel',
  'endpoints.{}.activityPhaseEndpoint': 'com_config_providers_desc_activityPhaseEndpoint',
  'endpoints.{}.activityPhasePrompt': 'com_config_providers_desc_activityPhasePrompt',
  'endpoints.{}.reasoningLabelEndpoint': 'com_config_providers_desc_reasoningLabelEndpoint',
  'endpoints.{}.reasoningLabelPrompt': 'com_config_providers_desc_reasoningLabelPrompt',
  'endpoints.{}.reasoningLabelMinChars': 'com_config_providers_desc_reasoningLabelMinChars',
  'endpoints.{}.reasoningLabelUpdateChars': 'com_config_providers_desc_reasoningLabelUpdateChars',
  'endpoints.{}.reasoningLabelUpdateIntervalMs':
    'com_config_providers_desc_reasoningLabelUpdateIntervalMs',
  'endpoints.{}.baseURL': 'com_config_providers_desc_unused_baseURL',
  'endpoints.assistants.apiKey': 'com_config_providers_desc_unused_apiKey',
  'endpoints.azureAssistants.apiKey': 'com_config_providers_desc_unused_apiKey',
  'endpoints.assistants.models': 'com_config_providers_desc_unused_models',
  'endpoints.azureAssistants.models': 'com_config_providers_desc_unused_models',
  'endpoints.anthropic.models': 'com_config_providers_desc_models',
  'endpoints.anthropic.vertex': 'com_config_providers_desc_vertex',
  'endpoints.bedrock.models': 'com_config_providers_desc_models',
  'endpoints.bedrock.availableRegions': 'com_config_providers_desc_availableRegions',
  'endpoints.bedrock.guardrailConfig.guardrailIdentifier':
    'com_config_providers_desc_guardrailIdentifier',
  'endpoints.bedrock.guardrailConfig.guardrailVersion':
    'com_config_providers_desc_guardrailVersion',
  'endpoints.bedrock.guardrailConfig.trace': 'com_config_providers_desc_guardrailTrace',
  'endpoints.bedrock.guardrailConfig.streamProcessingMode':
    'com_config_providers_desc_guardrailStreamMode',
  'endpoints.azureOpenAI.assistants': 'com_config_providers_desc_azureAssistants',
  'endpoints.azureAssistants.capabilities': 'com_config_desc_endpoints_assistants_capabilities',
  'endpoints.azureAssistants.excludedIds': 'com_config_desc_endpoints_assistants_excludedIds',
  'endpoints.azureAssistants.pollIntervalMs': 'com_config_desc_endpoints_assistants_pollIntervalMs',
  'endpoints.azureAssistants.privateAssistants':
    'com_config_desc_endpoints_assistants_privateAssistants',
  'endpoints.azureAssistants.retrievalModels':
    'com_config_desc_endpoints_assistants_retrievalModels',
  'endpoints.azureAssistants.supportedIds': 'com_config_desc_endpoints_assistants_supportedIds',
  'endpoints.azureAssistants.timeoutMs': 'com_config_desc_endpoints_assistants_timeoutMs',
  'endpoints.assistants.disableBuilder': 'com_config_providers_desc_assistants_disableBuilder',
  'endpoints.azureAssistants.disableBuilder': 'com_config_providers_desc_assistants_disableBuilder',
  'endpoints.agents.maxToolCallArgBytes': 'com_config_providers_desc_agents_maxToolCallArgBytes',
  'endpoints.agents.maxToolCallArgBytesByTool':
    'com_config_providers_desc_agents_maxToolCallArgBytesByTool',
  'endpoints.agents.maxDeltaEventsPerTurn':
    'com_config_providers_desc_agents_maxDeltaEventsPerTurn',
  'endpoints.agents.maxRetainedToolCountChars':
    'com_config_providers_desc_agents_maxRetainedToolCountChars',
  'endpoints.agents.codeApiUploadConcurrency':
    'com_config_providers_desc_agents_codeApiUploadConcurrency',
  'endpoints.agents.codeApiMaxRetryWaitMs':
    'com_config_providers_desc_agents_codeApiMaxRetryWaitMs',
  'endpoints.agents.repositoryInstructions.timeoutMs':
    'com_config_providers_desc_agents_repositoryInstructions_timeoutMs',
  'endpoints.agents.fileSharing.enabled': 'com_config_providers_desc_agents_fileSharing_enabled',
  'endpoints.agents.fileSharing.allowSiblingSharing':
    'com_config_providers_desc_agents_fileSharing_allowSiblingSharing',
  'endpoints.agents.fileSharing.maxFiles': 'com_config_providers_desc_agents_fileSharing_maxFiles',
  'endpoints.agents.fileSharing.maxPrivateBytes':
    'com_config_providers_desc_agents_fileSharing_maxPrivateBytes',
  'endpoints.agents.fileSharing.ttlMs': 'com_config_providers_desc_agents_fileSharing_ttlMs',
  'endpoints.agents.eventDriven.selfUrl': 'com_config_providers_desc_agents_eventDriven_selfUrl',
  'endpoints.agents.backgroundTasks.completionWakeups':
    'com_config_providers_desc_agents_backgroundTasks_completionWakeups',
  'endpoints.agents.backgroundTasks.completionResultMaxChars':
    'com_config_providers_desc_agents_backgroundTasks_completionResultMaxChars',
  'endpoints.agents.backgroundTasks.completionResultBatchSize':
    'com_config_providers_desc_agents_backgroundTasks_completionResultBatchSize',
  'endpoints.agents.backgroundTasks.ordinaryToolCancellation':
    'com_config_providers_desc_agents_backgroundTasks_ordinaryToolCancellation',
  'endpoints.agents.skills.maxCatalogSkills':
    'com_config_providers_desc_agents_skills_maxCatalogSkills',
  'endpoints.agents.askUserQuestion.retainedAnswers.enabled':
    'com_config_providers_desc_agents_retainedAnswers_enabled',
  'endpoints.agents.askUserQuestion.retainedAnswers.maxTokens':
    'com_config_providers_desc_agents_retainedAnswers_maxTokens',
  'endpoints.agents.checkpointer.type': 'com_config_providers_desc_agents_checkpointer_type',
  'endpoints.agents.checkpointer.ttl': 'com_config_providers_desc_agents_checkpointer_ttl',
  'endpoints.agents.checkpointer.checkpointCollectionName':
    'com_config_providers_desc_agents_checkpointer_collection',
  'endpoints.agents.checkpointer.checkpointWritesCollectionName':
    'com_config_providers_desc_agents_checkpointer_collection',
};

function descriptionMeta(): t.FieldMetaRegistry {
  return Object.fromEntries(
    Object.entries(DESCRIPTIONS).map(([path, descriptionKey]) => [path, { descriptionKey }]),
  );
}

const PROVIDER_FIELD = /^endpoints\.([^.{}[\]]+)\.(.+)$/;

/**
 * The registry resolves a path to its most literal entry without merging
 * wildcard entries in, so a provider-specific entry
 * (`endpoints.openAI.titleModel`) starts from what `endpoints.{}.titleModel`
 * sets (shared descriptions and runtime defaults).
 */
function withShared(
  registry: t.FieldMetaRegistry,
  shared: t.FieldMetaRegistry,
): t.FieldMetaRegistry {
  const result: t.FieldMetaRegistry = {};
  for (const [path, meta] of Object.entries(registry)) {
    const match = PROVIDER_FIELD.exec(path);
    const wildcard = match ? `endpoints.{}.${match[2]}` : undefined;
    result[path] = wildcard ? { ...shared[wildcard], ...meta } : meta;
  }
  return result;
}

/** Pins each provider's purpose groups into the registry, so field order follows them. */
function layoutMeta(): t.FieldMetaRegistry {
  return Object.fromEntries(
    Object.entries(PROVIDER_LAYOUTS).map(([provider, groups]) => [
      `endpoints.${provider}`,
      { groups: groups.map(({ key, fields }) => ({ key, fields })) },
    ]),
  );
}

const STATIC_META: t.FieldMetaRegistry = {
  [`endpoints.${GLOBAL_PROVIDER_KEY}`]: { labelKey: 'com_config_providers_global_title' },
  'endpoints.anthropic.models': { control: 'model-list', optionSource: 'models:anthropic' },
  'endpoints.bedrock.models': { control: 'model-list', optionSource: 'models:bedrock' },
  'endpoints.agents.capabilities': capabilityMeta('cap', AGENT_CAPABILITIES),
  'endpoints.assistants.capabilities': capabilityMeta('acap', ASSISTANT_CAPABILITIES),
  'endpoints.azureAssistants.capabilities': capabilityMeta('acap', ASSISTANT_CAPABILITIES),
  'endpoints.allowedAddresses': {
    labelKey: 'com_config_providers_network_addresses',
    descriptionKey: 'com_config_providers_network_addresses_desc',
  },
  'endpoints.agents.recursionLimit': { runtimeDefault: DEFAULT_RECURSION_LIMIT },
  /** LibreChat runs Azure Assistants on API v1 unless set (`defaultAssistantsVersion`), not the schema's 2. */
  'endpoints.azureAssistants.version': {
    runtimeDefault: defaultAssistantsVersion[EModelEndpoint.azureAssistants],
  },
  'endpoints.agents.checkpointer.ttl': { unit: 's' },
  'endpoints.agents.fileSharing.maxPrivateBytes': { width: 'M' },
};

/**
 * AI providers metadata (WS9): purpose groups per provider, model list and
 * capability controls, model suggestions, labels and descriptions. Merged
 * after the generic registry (`META_SOURCES`), so these entries win.
 */
export const PROVIDER_FIELD_META: t.FieldMetaRegistry = (() => {
  const merged: t.FieldMetaRegistry = {};
  for (const registry of [layoutMeta(), modelReferenceMeta(), descriptionMeta(), STATIC_META]) {
    for (const [path, meta] of Object.entries(registry)) {
      merged[path] = { ...merged[path], ...meta };
    }
  }
  const shared: t.FieldMetaRegistry = {};
  for (const [path, meta] of Object.entries(merged)) {
    if (path.startsWith('endpoints.{}.')) shared[path] = { ...GENERIC_FIELD_META[path], ...meta };
  }
  return withShared(merged, { ...GENERIC_FIELD_META, ...shared });
})();
