import { EModelEndpoint, paramSettings, getSettingsKeys } from 'librechat-data-provider';
import type { SettingDefinition } from 'librechat-data-provider';
import type * as t from '@/types';
import { isConfigRecord, getValueAtPath, hasConfigValue } from '@/utils';
import { ASSISTANT_ENDPOINTS, specEndpoint } from './validation';

/**
 * Preset keys that are conversation state or internal plumbing, never
 * something a spec should set (or that clash with a spec-level field of the
 * same name: the spec's own `iconURL` and `artifacts` are the ones used).
 */
export const PRESET_DENYLIST: ReadonlySet<string> = new Set([
  'archivedAt',
  'pinned',
  'isShared',
  'isTemporary',
  'tools',
  'subagentThread',
  'codeWorkspaces',
  'endpointType',
  'stream',
  'iconURL',
  'artifacts',
  'userLabel',
]);

/** Preset keys the editor shows in its own groups (Model, Prompt), not among the parameters. */
export const MODEL_KEYS: readonly string[] = [
  'endpoint',
  'model',
  'modelLabel',
  'agent_id',
  'assistant_id',
];
export const PROMPT_KEYS: readonly string[] = [
  'promptPrefix',
  'system',
  'instructions',
  'additional_instructions',
  'greeting',
];
const GROUPED_KEYS: ReadonlySet<string> = new Set([...MODEL_KEYS, ...PROMPT_KEYS]);
const GREETING_KEY = 'greeting';
/** Prompt fields only the assistants endpoints use (shown elsewhere only when set). */
const ASSISTANT_PROMPT_KEYS: ReadonlySet<string> = new Set([
  'instructions',
  'additional_instructions',
]);

const BUILT_IN: ReadonlySet<string> = new Set(Object.values(EModelEndpoint));

/** Every key some endpoint's parameter panel uses (`top_p` for OpenAI, `topP` for Anthropic, …). */
const PARAM_KEYS: ReadonlySet<string> = new Set(
  Object.values(paramSettings).flatMap((settings) =>
    (settings ?? []).map((setting) => setting.key),
  ),
);

/** Preset keys that only mean something on some endpoints: the assistant or agent a spec runs. */
const ENDPOINT_ONLY_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  assistant_id: ASSISTANT_ENDPOINTS,
  agent_id: new Set([EModelEndpoint.agents]),
};

/** Provider fields no parameter panel lists: Bedrock's extra request fields, Google's legacy context and examples. */
const PROVIDER_ONLY_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  additionalModelRequestFields: new Set([EModelEndpoint.bedrock]),
  context: new Set([EModelEndpoint.google]),
  examples: new Set([EModelEndpoint.google]),
};

/** An assistant or agent id on a spec whose endpoint runs neither. */
export function isMisplacedId(key: string, endpoint: string): boolean {
  const only = ENDPOINT_ONLY_KEYS[key];
  return only != null && !only.has(endpoint);
}

/**
 * Whether the preset picker leaves a key out for a spec on `endpoint`:
 * another endpoint's parameter (OpenAI's `top_p` next to Anthropic's
 * `topP`) or provider field (Google's `examples`), and the assistant or agent
 * id, which the Model group edits where it applies. `own` holds the keys the
 * endpoint's own parameters use.
 */
export function isForeignPresetKey(
  key: string,
  endpoint: string,
  own: ReadonlySet<string>,
): boolean {
  if (key in ENDPOINT_ONLY_KEYS) return true;
  const provider = PROVIDER_ONLY_KEYS[key];
  if (provider) return !provider.has(endpoint);
  return PARAM_KEYS.has(key) && !own.has(key) && !GROUPED_KEYS.has(key);
}

function paramKind(setting: SettingDefinition): t.PresetParamKind | null {
  if (setting.type === 'boolean') return 'boolean';
  if (setting.type === 'number') return 'number';
  if (setting.type === 'array') return 'list';
  if (setting.type === 'enum') return 'enum';
  if (setting.type === 'string') return setting.component === 'textarea' ? 'textarea' : 'text';
  return null;
}

function toParam(setting: SettingDefinition): t.PresetParam | null {
  const kind = paramKind(setting);
  if (!kind) return null;
  const param: t.PresetParam = { key: setting.key, kind };
  if (setting.range) {
    param.min = setting.range.min;
    param.max = setting.range.max;
    if (setting.range.step !== undefined) param.step = setting.range.step;
  }
  if (kind === 'enum' && setting.options) {
    param.options = setting.options.filter((option) => option !== '');
  }
  const fallback = setting.default;
  const isEmptyDefault = fallback === '' || (Array.isArray(fallback) && fallback.length === 0);
  if (fallback !== undefined && !isEmptyDefault) param.defaultValue = fallback;
  return param;
}

/**
 * The endpoint type LibreChat resolves parameters by: a built-in provider is
 * its own type; any other name is a custom endpoint, whose parameters follow
 * its `customParams.defaultParamsEndpoint` when set.
 */
function settingsEndpoint(endpoint: string, custom: t.ConfigRecord | undefined): string {
  if (BUILT_IN.has(endpoint)) return endpoint;
  const customParams = isConfigRecord(custom?.customParams) ? custom.customParams : undefined;
  const defaultParams = customParams?.defaultParamsEndpoint;
  return typeof defaultParams === 'string' && defaultParams !== ''
    ? defaultParams
    : EModelEndpoint.custom;
}

/**
 * The model parameters a spec's preset can set for its endpoint and model,
 * from LibreChat's own parameter panel settings (`paramSettings`): the model
 * family key first (`bedrock-anthropic`), else the endpoint's. The Model and
 * Prompt fields are left out (the editor shows them in their own groups), and
 * so are parameters the preset schema can't store.
 */
export function presetParams(
  endpoint: string,
  model: string,
  custom: t.ConfigRecord | undefined,
  presetKeys: ReadonlySet<string>,
): t.PresetParamSet {
  if (!endpoint) return { settingsKey: null, params: [] };
  const type = settingsEndpoint(endpoint, custom);
  const [combinedKey, endpointKey] = getSettingsKeys(type, model);
  const settingsKey = paramSettings[combinedKey] ? combinedKey : endpointKey;
  const settings = paramSettings[settingsKey];
  if (!settings) return { settingsKey: null, params: [] };
  const params = settings.flatMap((setting) => {
    if (GROUPED_KEYS.has(setting.key) || !presetKeys.has(setting.key)) return [];
    const param = toParam(setting);
    return param ? [param] : [];
  });
  return { settingsKey, params };
}

/** The prompt field an endpoint's parameter panel uses (`system` for Bedrock's Anthropic models). */
export function promptKeyFor(endpoint: string, model: string, custom?: t.ConfigRecord): string {
  if (!endpoint) return 'promptPrefix';
  const type = settingsEndpoint(endpoint, custom);
  const [combinedKey, endpointKey] = getSettingsKeys(type, model);
  const settings = paramSettings[combinedKey] ?? paramSettings[endpointKey] ?? [];
  return settings.some((setting) => setting.key === 'system') ? 'system' : 'promptPrefix';
}

/**
 * The Model group's fields for a spec's endpoint, in order: the endpoint, the
 * agent (an agents spec) or else the model, the assistant on an assistants
 * endpoint, and the model label. A field the endpoint doesn't use is listed
 * only while the preset still sets it, so a stale value stays removable.
 */
export function specModelKeys(preset: t.ConfigRecord, endpoint: string): string[] {
  const isAgent = endpoint === EModelEndpoint.agents;
  const [primary, secondary] = isAgent ? ['agent_id', 'model'] : ['model', 'agent_id'];
  const usesAssistant = ASSISTANT_ENDPOINTS.has(endpoint) || hasConfigValue(preset.assistant_id);
  return [
    'endpoint',
    primary,
    ...(hasConfigValue(preset[secondary]) ? [secondary] : []),
    ...(usesAssistant ? ['assistant_id'] : []),
    'modelLabel',
  ];
}

/** The preset keys the Parameters group lists: the endpoint's parameters, then any other key set. */
export function paramGroupKeys(params: t.PresetParam[], preset: t.ConfigRecord): string[] {
  const keys = new Set(params.map((param) => param.key));
  for (const key of Object.keys(preset)) {
    if (!GROUPED_KEYS.has(key) && preset[key] !== undefined) keys.add(key);
  }
  return [...keys];
}

/**
 * The prompt fields a spec's editor shows, in order: the prompt field of its
 * endpoint's parameter panel (`promptKeyFor`), the other one while the preset
 * sets it (so it can be seen and removed), the greeting, and the assistants'
 * instructions on an assistants endpoint or while set.
 */
export function specPromptKeys(
  preset: t.ConfigRecord,
  endpoint: string,
  custom?: t.ConfigRecord,
): string[] {
  const model = typeof preset.model === 'string' ? preset.model : '';
  const promptKey = promptKeyFor(endpoint, model, custom);
  const otherPromptKey = promptKey === 'system' ? 'promptPrefix' : 'system';
  const isAssistant = ASSISTANT_ENDPOINTS.has(endpoint);
  return [promptKey, otherPromptKey, GREETING_KEY, ...ASSISTANT_PROMPT_KEYS].filter(
    (key) =>
      key === promptKey ||
      key === GREETING_KEY ||
      (isAssistant && ASSISTANT_PROMPT_KEYS.has(key)) ||
      hasConfigValue(preset[key]),
  );
}

/** A schema field with a parameter's range and choices, so the shared control enforces them. */
export function paramField(field: t.SchemaField, param: t.PresetParam): t.SchemaField {
  if (param.kind === 'enum' && param.options?.length) {
    return { ...field, type: `enum(${param.options.join(' | ')})` };
  }
  if (param.kind !== 'number' || (param.min === undefined && param.max === undefined)) {
    return field;
  }
  return {
    ...field,
    constraints: {
      ...field.constraints,
      ...(param.min !== undefined && { min: param.min }),
      ...(param.max !== undefined && { max: param.max }),
      ...(param.step !== undefined && { step: param.step }),
    },
  };
}

/** A custom endpoint's settings by name, from the whole configuration. */
function customEndpointOf(root: t.ConfigValue, name: string): t.ConfigRecord | undefined {
  const custom = getValueAtPath(root, 'endpoints.custom');
  const entry = Array.isArray(custom)
    ? custom.find((item) => isConfigRecord(item) && item.name === name)
    : undefined;
  return isConfigRecord(entry) ? entry : undefined;
}

/**
 * A spec's fields as its editor shows them, for search: the preset narrowed
 * to the Model fields of its endpoint (`specModelKeys`), the Prompt fields
 * the editor shows for it (`specPromptKeys`), its endpoint's parameters, and
 * whatever else the preset sets (so neither "Thinking budget", "System
 * prompt" nor "Agent ID" is found on an OpenAI spec).
 */
export function specSearchFields(
  fields: t.SchemaField[],
  spec: t.ConfigValue,
  root: t.ConfigValue,
): t.SchemaField[] {
  const preset = isConfigRecord(spec) && isConfigRecord(spec.preset) ? spec.preset : {};
  return fields.map((field) => {
    if (field.key !== 'preset' || !field.children) return field;
    const presetKeys = new Set(field.children.map((child) => child.key));
    const endpoint = specEndpoint(spec);
    const model = typeof preset.model === 'string' ? preset.model : '';
    const custom = customEndpointOf(root, endpoint);
    const shown = new Set([
      ...specModelKeys(preset, endpoint),
      ...specPromptKeys(preset, endpoint, custom),
      ...presetParams(endpoint, model, custom, presetKeys).params.map((param) => param.key),
      ...Object.keys(preset),
    ]);
    return { ...field, children: field.children.filter((child) => shown.has(child.key)) };
  });
}
