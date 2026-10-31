import type * as t from '@/types';

/** Labels and help for the interface settings, read in their groups (FX-5). */
const INTERFACE_META: t.FieldMetaRegistry = {
  'interface.customWelcome': { labelKey: 'com_config_label_interface_customWelcome' },
  'interface.privacyPolicy.externalUrl': { labelKey: 'com_config_label_privacy_url' },
  'interface.privacyPolicy.openNewTab': {
    labelKey: 'com_config_label_privacy_new_tab',
    descriptionKey: 'com_config_desc_interface_openNewTab',
  },
  'interface.termsOfService': {
    order: ['externalUrl', 'openNewTab', 'modalTitle', 'modalContent', 'modalAcceptance'],
  },
  'interface.termsOfService.externalUrl': { labelKey: 'com_config_label_terms_url' },
  'interface.termsOfService.openNewTab': {
    labelKey: 'com_config_label_terms_new_tab',
    descriptionKey: 'com_config_desc_interface_openNewTab',
  },
  'interface.termsOfService.modalTitle': {
    labelKey: 'com_config_label_terms_title',
    descriptionKey: 'com_config_desc_interface_termsOfService_modalTitle',
  },
  'interface.termsOfService.modalContent': { labelKey: 'com_config_label_terms_content' },
  'interface.termsOfService.modalAcceptance': { labelKey: 'com_config_label_terms_acceptance' },
  'interface.retentionMode': {
    enumLabels: {
      all: 'com_config_enum_retention_all',
      temporary: 'com_config_enum_retention_temporary',
      ephemeral: 'com_config_enum_retention_ephemeral',
    },
  },
  'interface.generalChatRetention': {
    descriptionKey: 'com_config_desc_interface_generalChatRetention_all',
  },
  'interface.retainAgentFiles': { descriptionKey: 'com_config_desc_interface_retainAgentFiles' },
  'interface.currency': {
    labelKey: 'com_config_label_interface_currency',
    descriptionKey: 'com_config_desc_interface_currency',
  },
  'interface.currency.code': { descriptionKey: 'com_config_desc_interface_currency_code' },
  'interface.currency.rate': { descriptionKey: 'com_config_desc_interface_currency_rate' },
  'interface.buildInfo': { descriptionKey: 'com_config_desc_interface_buildInfo' },
  'interface.sharedLinks.snapshotFiles': {
    labelKey: 'com_config_label_sharedLinks_snapshotFiles',
    descriptionKey: 'com_config_desc_interface_sharedLinks_snapshotFiles',
    runtimeDefault: true,
  },
  'interface.skills.defaultActiveOnShare': {
    labelKey: 'com_config_label_skills_defaultActiveOnShare',
    descriptionKey: 'com_config_desc_interface_skills_defaultActiveOnShare',
    runtimeDefault: false,
  },
  'interface.traceViewer': {
    order: [
      'enabled',
      'showInputOutput',
      'showToolNames',
      'maxRecords',
      'maxContentLength',
      'requestsPerMinute',
      'requestTimeoutMs',
    ],
  },
  'interface.traceViewer.enabled': {
    labelKey: 'com_config_label_traceViewer_enabled',
    descriptionKey: 'com_config_desc_interface_traceViewer_enabled',
  },
  'interface.traceViewer.showInputOutput': {
    descriptionKey: 'com_config_desc_interface_traceViewer_showInputOutput',
  },
  'interface.traceViewer.showToolNames': {
    descriptionKey: 'com_config_desc_interface_traceViewer_showToolNames',
  },
  'interface.traceViewer.maxRecords': {
    runtimeDefault: 1000,
    descriptionKey: 'com_config_desc_interface_traceViewer_maxRecords',
  },
  'interface.traceViewer.maxContentLength': {
    runtimeDefault: 50_000,
    descriptionKey: 'com_config_desc_interface_traceViewer_maxContentLength',
  },
  'interface.traceViewer.requestsPerMinute': {
    runtimeDefault: 30,
    descriptionKey: 'com_config_desc_interface_traceViewer_requestsPerMinute',
  },
  'interface.traceViewer.requestTimeoutMs': { runtimeDefault: 10_000 },
  'interface.mcpServers': {
    order: ['placeholder', 'toolsRefreshInterval', 'statusRefreshInterval', 'trustCheckbox'],
  },
  'interface.mcpServers.toolsRefreshInterval': {
    unit: 'ms',
    runtimeDefault: 300_000,
    descriptionKey: 'com_config_desc_interface_mcpServers_toolsRefreshInterval',
  },
  'interface.mcpServers.statusRefreshInterval': {
    unit: 'ms',
    runtimeDefault: 30_000,
    descriptionKey: 'com_config_desc_interface_mcpServers_statusRefreshInterval',
  },
  'interface.mcpServers.trustCheckbox': {
    labelKey: 'com_config_label_mcp_trustCheckbox',
    descriptionKey: 'com_config_desc_interface_mcpServers_trustCheckbox',
  },
};

/**
 * Memory (FX-3): `disabled` is shown as the positive "Enable memory" switch,
 * so its values are named the way that switch reads them.
 */
const MEMORY_META: t.FieldMetaRegistry = {
  memory: {
    order: [
      'disabled',
      'personalize',
      'validKeys',
      'messageWindowSize',
      'tokenLimit',
      'charLimit',
      'maxInputTokens',
    ],
  },
  'memory.disabled': {
    labelKey: 'com_config_label_memory_enabled',
    descriptionKey: 'com_config_desc_memory_enabled',
    enumLabels: { true: 'com_config_values_memory_off', false: 'com_config_values_memory_on' },
  },
  'memory.charLimit': { descriptionKey: 'com_config_desc_memory_charLimit' },
  'memory.maxInputTokens': { descriptionKey: 'com_config_desc_memory_maxInputTokens' },
  'memory.agent.enabled': {
    labelKey: 'com_config_label_memory_agent_enabled',
    descriptionKey: 'com_config_desc_memory_agent_enabled',
  },
  'memory.agent.id': {
    labelKey: 'com_config_label_memory_agent_id',
    descriptionKey: 'com_config_desc_memory_agent_id',
  },
  'memory.agent.provider': { descriptionKey: 'com_config_desc_memory_agent_provider' },
  'memory.agent.model': { descriptionKey: 'com_config_desc_memory_agent_model' },
  'memory.agent.instructions': {
    multiline: true,
    descriptionKey: 'com_config_desc_memory_agent_instructions',
  },
  'memory.agent.model_parameters': {
    descriptionKey: 'com_config_desc_memory_agent_model_parameters',
  },
};

/** Summarization (FX-4): when it runs first, then which model writes it and how. */
const SUMMARIZATION_META: t.FieldMetaRegistry = {
  summarization: {
    order: [
      'enabled',
      'trigger',
      'provider',
      'model',
      'maxSummaryTokens',
      'reserveRatio',
      'prompt',
      'updatePrompt',
      'parameters',
    ],
  },
  'summarization.updatePrompt': { descriptionKey: 'com_config_desc_summarization_updatePrompt' },
  'summarization.parameters': { descriptionKey: 'com_config_desc_summarization_parameters' },
};

/** Web search (FX-2): unset service choices mean LibreChat picks one with credentials. */
const WEB_SEARCH_META: t.FieldMetaRegistry = {
  'webSearch.searchProvider': { defaultLabelKey: 'com_config_features_ws_automatic' },
  'webSearch.scraperProvider': { defaultLabelKey: 'com_config_features_ws_automatic' },
  'webSearch.rerankerType': { defaultLabelKey: 'com_config_features_ws_automatic' },
  'webSearch.scraperTimeout': {
    unit: 'ms',
    runtimeDefault: 7500,
    descriptionKey: 'com_config_desc_webSearch_scraperTimeout',
  },
  'webSearch.safeSearch': { descriptionKey: 'com_config_desc_webSearch_safeSearch_features' },
  'webSearch.keenableApiKey': { secret: true },
};

/**
 * Allowlists of domains (FX-16): validated chips; an empty list means no
 * restriction. An empty list is never written over a list the layer beneath
 * sets (D3): removing the last entry removes the target's own list.
 */
const ALLOWLIST_META: t.FieldMetaRegistry = {
  'actions.allowedDomains': {
    control: 'domain-list',
    descriptionKey: 'com_config_desc_actions_allowedDomains_list',
  },
  'mcpSettings.allowedDomains': {
    control: 'domain-list',
    descriptionKey: 'com_config_desc_mcpSettings_allowedDomains_list',
  },
};

/** Speech (FX-14): which settings are providers and which are each user's starting values. */
const SPEECH_META: t.FieldMetaRegistry = {
  'speech.tts': { labelKey: 'com_config_label_speech_tts' },
  'speech.stt': { labelKey: 'com_config_label_speech_stt' },
  'speech.speechTab': {
    labelKey: 'com_config_label_speech_speechTab',
    descriptionKey: 'com_config_desc_speech_speechTab',
  },
  'speech.speechTab.speechToText.engineSTT': {
    labelKey: 'com_config_label_speech_engine',
    descriptionKey: 'com_config_desc_speech_engineSTT',
  },
  'speech.speechTab.textToSpeech.engineTTS': {
    labelKey: 'com_config_label_speech_engine',
    descriptionKey: 'com_config_desc_speech_engineTTS',
  },
  'speech.speechTab.speechToText.languageSTT': {
    labelKey: 'com_config_label_speech_language',
    descriptionKey: 'com_config_desc_speech_language',
  },
  'speech.speechTab.textToSpeech.languageTTS': {
    labelKey: 'com_config_label_speech_language',
    descriptionKey: 'com_config_desc_speech_language',
  },
  'speech.speechTab.speechToText.decibelValue': {
    width: 'S',
    labelKey: 'com_config_label_speech_decibelValue',
    descriptionKey: 'com_config_desc_speech_decibelValue',
  },
  'speech.speechTab.speechToText.autoSendText': {
    unit: 's',
    width: 'S',
    labelKey: 'com_config_label_speech_autoSendText',
    descriptionKey: 'com_config_desc_speech_autoSendText',
  },
  'speech.speechTab.textToSpeech.playbackRate': {
    descriptionKey: 'com_config_desc_speech_playbackRate',
  },
  'speech.speechTab.textToSpeech.cacheTTS': {
    labelKey: 'com_config_label_speech_cacheTTS',
    descriptionKey: 'com_config_desc_speech_cacheTTS',
  },
  'speech.speechTab.conversationMode': {
    descriptionKey: 'com_config_desc_speech_conversationMode',
  },
  'speech.speechTab.advancedMode': { descriptionKey: 'com_config_desc_speech_advancedMode' },
  'speech.tts.allowedAddresses': { descriptionKey: 'com_config_desc_speech_allowedAddresses' },
  'speech.stt.allowedAddresses': { descriptionKey: 'com_config_desc_speech_allowedAddresses' },
};

/**
 * Field metadata of the Features tab (WS13): interface grouping labels,
 * memory's positive switch, summarization order, web search defaults,
 * allowlist chips and speech labels.
 */
export const FEATURES_FIELD_META: t.FieldMetaRegistry = {
  ...INTERFACE_META,
  ...MEMORY_META,
  ...SUMMARIZATION_META,
  ...WEB_SEARCH_META,
  ...ALLOWLIST_META,
  ...SPEECH_META,
};
