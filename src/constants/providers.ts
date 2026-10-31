import { EModelEndpoint } from 'librechat-data-provider';
import type * as t from '@/types';

/** Built-in providers, in the order the AI providers tab lists them. */
export const BUILT_IN_PROVIDERS: readonly string[] = [
  EModelEndpoint.openAI,
  EModelEndpoint.google,
  EModelEndpoint.anthropic,
  EModelEndpoint.azureOpenAI,
  EModelEndpoint.azureAssistants,
  EModelEndpoint.assistants,
  EModelEndpoint.agents,
  EModelEndpoint.bedrock,
];

/**
 * Built-in providers that run models themselves (LibreChat's
 * `providerConfigMap`): what `titleEndpoint`, `allowedProviders` or a memory
 * agent's `provider` can name, besides custom endpoints. Agents and the
 * Assistants endpoints delegate to these and are not providers.
 */
export const MODEL_PROVIDERS: readonly string[] = BUILT_IN_PROVIDERS.filter(
  (provider) =>
    provider !== EModelEndpoint.agents &&
    provider !== EModelEndpoint.assistants &&
    provider !== EModelEndpoint.azureAssistants,
);

/** The key of the block whose settings apply to every endpoint (D11). */
export const GLOBAL_PROVIDER_KEY = 'all';

/**
 * Where each built-in provider's credentials come from (LibreChat's
 * `EndpointService`): a locale key naming the environment variables, shown in
 * the provider's status row and badge tooltip.
 */
export const PROVIDER_CREDENTIALS_KEYS: Readonly<Record<string, string>> = {
  [EModelEndpoint.openAI]: 'com_config_providers_creds_openAI',
  [EModelEndpoint.google]: 'com_config_providers_creds_google',
  [EModelEndpoint.anthropic]: 'com_config_providers_creds_anthropic',
  [EModelEndpoint.azureOpenAI]: 'com_config_providers_creds_azureOpenAI',
  [EModelEndpoint.azureAssistants]: 'com_config_providers_creds_azureAssistants',
  [EModelEndpoint.assistants]: 'com_config_providers_creds_assistants',
  [EModelEndpoint.agents]: 'com_config_providers_creds_agents',
  [EModelEndpoint.bedrock]: 'com_config_providers_creds_bedrock',
};

/**
 * Where Azure OpenAI's credentials come from where the panel edits its groups
 * (`editsAzureGroups`): a group added in the admin panel stores its own key.
 */
export const AZURE_GROUP_CREDENTIALS_KEY = 'com_config_providers_creds_azureOpenAI_groups';

/** The step budget LibreChat gives an agent run when `endpoints.agents.recursionLimit` is unset. */
export const DEFAULT_RECURSION_LIMIT = 50;

/**
 * Sections of the Azure group editor, each with the group settings it places
 * in order. A setting none places (a newer schema's) is listed under
 * "Other settings", so every schema field stays editable.
 */
export const AZURE_GROUP_SECTIONS: readonly t.AzureGroupSectionDef[] = [
  {
    id: 'connection',
    labelKey: 'com_config_providers_azure_section_connection',
    descriptionKey: 'com_config_providers_azure_section_connection_desc',
    fields: ['apiKey', 'serverless', 'instanceName', 'baseURL', 'deploymentName', 'version'],
  },
  {
    id: 'models',
    labelKey: 'com_config_providers_azure_section_models',
    descriptionKey: 'com_config_providers_azure_section_models_desc',
    fields: ['models', 'assistants'],
  },
  {
    id: 'request',
    labelKey: 'com_config_providers_azure_section_request',
    descriptionKey: 'com_config_providers_azure_section_request_desc',
    fields: ['additionalHeaders', 'addParams', 'dropParams'],
  },
];
