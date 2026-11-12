import { EModelEndpoint } from 'librechat-data-provider';
import type * as t from '@/types';
import { WEB_SEARCH_SERVICES } from './features';

/** Where `GET /env-status` says an env name is used. */
export const ENV_SOURCES: readonly t.EnvSource[] = [
  'yaml',
  'default',
  'endpoint',
  'allowlist',
  'override',
];

/**
 * Sources whose names an override may reference anywhere on a server with
 * `envAllowlist`: names librechat.yaml references, the built-in endpoints
 * read, or the operator adds with `CONFIG_OVERRIDE_ENV_ALLOWLIST`.
 */
export const ENV_ALLOWED_SOURCES: ReadonlySet<t.EnvSource> = new Set([
  'yaml',
  'endpoint',
  'allowlist',
]);

/**
 * Sections LibreChat shows to users or sends to a model as written: nothing
 * expands a `${NAME}` in them (interface copy, model spec labels and prompts).
 * Mirrors LibreChat's `ENV_LITERAL_TEXT_SECTIONS`.
 */
export const ENV_LITERAL_TEXT_SECTIONS: ReadonlySet<string> = new Set(['interface', 'modelSpecs']);

/** Endpoints configured by name under `endpoints`. */
const NAMED_ENDPOINTS: readonly string[] = [
  'all',
  EModelEndpoint.openAI,
  EModelEndpoint.google,
  EModelEndpoint.anthropic,
  EModelEndpoint.azureOpenAI,
  EModelEndpoint.azureAssistants,
  EModelEndpoint.assistants,
  EModelEndpoint.agents,
  EModelEndpoint.bedrock,
];

/** The system prompts an endpoint's title, activity and reasoning labels are written with. */
const ENDPOINT_PROMPT_KEYS: readonly string[] = [
  'titlePrompt',
  'titlePromptTemplate',
  'activityPrompt',
  'activityPhasePrompt',
  'reasoningLabelPrompt',
];

/**
 * Prompt and instruction fields outside those sections that no reader
 * env-expands, by librechat.yaml path; `*` is one custom endpoint. Only these
 * exact places are literal text. Mirrors LibreChat's `ENV_LITERAL_TEXT_PATHS`.
 */
export const ENV_LITERAL_TEXT_PATHS: ReadonlyArray<readonly string[]> = [
  ...ENDPOINT_PROMPT_KEYS.flatMap((key) => [
    ...NAMED_ENDPOINTS.map((endpoint) => ['endpoints', endpoint, key]),
    ['endpoints', 'custom', '*', key],
  ]),
  ['summarization', 'prompt'],
  ['summarization', 'updatePrompt'],
  ['memory', 'agent', 'instructions'],
  ['webSearch', 'firecrawlOptions', 'changeTrackingOptions', 'prompt'],
];

/** Templates the Azure client fills in a group's base URL from its instance and deployment. */
export const AZURE_URL_TEMPLATE_NAMES: ReadonlySet<string> = new Set([
  'INSTANCE_NAME',
  'DEPLOYMENT_NAME',
]);

/** Azure group base URLs, where those templates are not env references; `*` is one group. */
export const AZURE_URL_TEMPLATE_PATHS: ReadonlyArray<readonly string[]> = [
  ['endpoints', 'azureOpenAI', 'groups', '*', 'baseURL'],
  ['endpoints', 'azureOpenAI', 'groupMap', '*', 'baseURL'],
];

/**
 * Where loading librechat.yaml fills in a reference for a value it leaves
 * unset (an env name's `default` source), by env name: each web search
 * credential's variable, and OCR's key. A name only loading uses may be
 * referenced by an override there and nowhere else.
 */
export const ENV_DEFAULT_PATHS: ReadonlyMap<string, string> = new Map([
  ...Object.values(WEB_SEARCH_SERVICES).flatMap((services) =>
    services.flatMap((service) =>
      service.credentials.map(({ key, env }): [string, string] => [env, `webSearch.${key}`]),
    ),
  ),
  ['OCR_API_KEY', 'ocr.apiKey'],
]);
