import type * as t from '@/types';

/**
 * Starting points for a new custom endpoint (WS10 CE-10): the base URL, the
 * environment variable the key is usually read from, a few models and the
 * settings each provider is known to need (OpenRouter and Perplexity reject
 * `stop`, Mistral rejects the OpenAI penalty and `user` parameters). Model
 * lists change often: they are examples to edit, and providers that list
 * their models over the API fetch them.
 */
export const ENDPOINT_TEMPLATES: readonly t.EndpointTemplate[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    descriptionKey: 'com_config_ce_template_openrouter',
    entry: {
      name: 'OpenRouter',
      apiKey: '${OPENROUTER_KEY}',
      baseURL: 'https://openrouter.ai/api/v1',
      models: { default: ['openai/gpt-4o-mini'], fetch: true },
      titleConvo: true,
      titleModel: 'openai/gpt-4o-mini',
      dropParams: ['stop'],
      modelDisplayLabel: 'OpenRouter',
    },
  },
  {
    id: 'groq',
    name: 'Groq',
    descriptionKey: 'com_config_ce_template_groq',
    entry: {
      name: 'Groq',
      apiKey: '${GROQ_API_KEY}',
      baseURL: 'https://api.groq.com/openai/v1/',
      models: { default: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], fetch: true },
      titleConvo: true,
      titleModel: 'llama-3.1-8b-instant',
      modelDisplayLabel: 'Groq',
    },
  },
  {
    id: 'mistral',
    name: 'Mistral',
    descriptionKey: 'com_config_ce_template_mistral',
    entry: {
      name: 'Mistral',
      apiKey: '${MISTRAL_API_KEY}',
      baseURL: 'https://api.mistral.ai/v1',
      models: { default: ['mistral-large-latest', 'mistral-small-latest'], fetch: true },
      titleConvo: true,
      titleModel: 'mistral-small-latest',
      dropParams: ['stop', 'user', 'frequency_penalty', 'presence_penalty'],
      modelDisplayLabel: 'Mistral',
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    descriptionKey: 'com_config_ce_template_deepseek',
    entry: {
      name: 'DeepSeek',
      apiKey: '${DEEPSEEK_API_KEY}',
      baseURL: 'https://api.deepseek.com/v1',
      models: { default: ['deepseek-chat', 'deepseek-reasoner'], fetch: false },
      titleConvo: true,
      titleModel: 'deepseek-chat',
      modelDisplayLabel: 'DeepSeek',
    },
  },
  {
    id: 'xai',
    name: 'xAI',
    descriptionKey: 'com_config_ce_template_xai',
    entry: {
      name: 'xAI',
      apiKey: '${XAI_API_KEY}',
      baseURL: 'https://api.x.ai/v1',
      models: { default: ['grok-3', 'grok-3-mini'], fetch: true },
      titleConvo: true,
      titleModel: 'grok-3-mini',
      modelDisplayLabel: 'Grok',
    },
  },
  {
    id: 'together',
    name: 'Together AI',
    descriptionKey: 'com_config_ce_template_together',
    entry: {
      name: 'Together AI',
      apiKey: '${TOGETHERAI_API_KEY}',
      baseURL: 'https://api.together.xyz/v1',
      models: { default: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'], fetch: true },
      titleConvo: true,
      titleModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      modelDisplayLabel: 'Together AI',
    },
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    descriptionKey: 'com_config_ce_template_perplexity',
    entry: {
      name: 'Perplexity',
      apiKey: '${PERPLEXITY_API_KEY}',
      baseURL: 'https://api.perplexity.ai/',
      models: { default: ['sonar', 'sonar-pro'], fetch: false },
      titleConvo: true,
      titleModel: 'sonar',
      dropParams: ['stop', 'frequency_penalty'],
      modelDisplayLabel: 'Perplexity',
    },
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    descriptionKey: 'com_config_ce_template_fireworks',
    entry: {
      name: 'Fireworks',
      apiKey: '${FIREWORKS_API_KEY}',
      baseURL: 'https://api.fireworks.ai/inference/v1',
      models: { default: ['accounts/fireworks/models/llama-v3p3-70b-instruct'], fetch: true },
      titleConvo: true,
      titleModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      dropParams: ['user'],
      modelDisplayLabel: 'Fireworks',
    },
  },
  {
    id: 'ollama',
    name: 'Ollama',
    descriptionKey: 'com_config_ce_template_ollama',
    entry: {
      name: 'Ollama',
      apiKey: 'ollama',
      baseURL: 'http://host.docker.internal:11434/v1/',
      models: { default: ['llama3.2'], fetch: true },
      titleConvo: true,
      titleModel: 'current_model',
      modelDisplayLabel: 'Ollama',
    },
  },
];

/** A blank OpenAI-compatible endpoint. */
export const BLANK_ENDPOINT_TEMPLATE: t.EndpointTemplate = {
  id: 'blank',
  name: '',
  descriptionKey: 'com_config_ce_template_blank',
  entry: {},
};

/**
 * Records of a custom endpoint whose inherited keys a target can remove one
 * by one (`keyedTombstones`): its request headers and added body parameters
 * (owner decision on removing inherited values: keys of record maps only).
 */
export const INHERITED_KEY_RECORDS: ReadonlySet<string> = new Set(['headers', 'addParams']);
