import { describe, it, expect } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  PRESET_DENYLIST,
  paramField,
  presetParams,
  promptKeyFor,
  specPromptKeys,
  specSearchFields,
  isForeignPresetKey,
  isMisplacedId,
} from '../params';
import { extractSchemaTree } from '@/server/config';

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const presetField = tree
  .find((field) => field.key === 'modelSpecs')
  ?.children?.find((field) => field.key === 'list')
  ?.children?.find((field) => field.key === 'preset');
const presetKeys = new Set((presetField?.children ?? []).map((field) => field.key));

function keysOf(set: t.PresetParamSet): string[] {
  return set.params.map((param) => param.key);
}

describe('presetParams', () => {
  it('offers an Anthropic spec only Anthropic parameters', () => {
    const anthropic = presetParams('anthropic', 'claude-sonnet-4-5', undefined, presetKeys);
    expect(anthropic.settingsKey).toBe('anthropic');
    const keys = keysOf(anthropic);
    expect(keys).toEqual(expect.arrayContaining(['maxOutputTokens', 'topP', 'topK', 'thinking']));
    expect(keys).not.toEqual(expect.arrayContaining(['top_p']));
    expect(
      keys.filter((key) =>
        ['max_tokens', 'top_p', 'frequency_penalty', 'reasoning_effort'].includes(key),
      ),
    ).toEqual([]);
  });

  it('leaves the Model and Prompt fields to their own groups', () => {
    const keys = keysOf(presetParams('openAI', 'gpt-4o', undefined, presetKeys));
    expect(keys).toEqual(expect.arrayContaining(['temperature', 'top_p', 'max_tokens', 'stop']));
    for (const key of ['modelLabel', 'promptPrefix', 'model', 'endpoint']) {
      expect(keys).not.toContain(key);
    }
  });

  it('resolves the model family (Bedrock) and a custom endpoint’s parameter set', () => {
    expect(presetParams('bedrock', 'anthropic.claude-3', undefined, presetKeys).settingsKey).toBe(
      'bedrock-anthropic',
    );
    expect(presetParams('Azure Foundry', 'gpt-5', undefined, presetKeys).settingsKey).toBe(
      'custom',
    );
    const viaAnthropic = presetParams(
      'Claude Proxy',
      'claude',
      { name: 'Claude Proxy', customParams: { defaultParamsEndpoint: 'anthropic' } },
      presetKeys,
    );
    expect(viaAnthropic.settingsKey).toBe('anthropic');
  });

  it('has no parameters for agents or without an endpoint', () => {
    expect(presetParams('agents', '', undefined, presetKeys).params).toEqual([]);
    expect(presetParams('', '', undefined, presetKeys)).toEqual({ settingsKey: null, params: [] });
  });

  it('keeps ranges, defaults and real choices (the empty “auto” choice is the default)', () => {
    const params = presetParams('openAI', 'gpt-4o', undefined, presetKeys).params;
    const temperature = params.find((param) => param.key === 'temperature');
    expect(temperature).toMatchObject({ kind: 'number', min: 0, max: 2, defaultValue: 1 });
    const effort = params.find((param) => param.key === 'reasoning_effort');
    expect(effort?.kind).toBe('enum');
    expect(effort?.options).not.toContain('');
    expect(effort?.defaultValue).toBeUndefined();
    expect(params.find((param) => param.key === 'stop')).toMatchObject({ kind: 'list' });
  });

  it('never offers internal conversation fields', () => {
    for (const endpoint of ['openAI', 'anthropic', 'google', 'bedrock', 'Azure Foundry']) {
      const keys = keysOf(presetParams(endpoint, 'm', undefined, presetKeys));
      expect(keys.filter((key) => PRESET_DENYLIST.has(key))).toEqual([]);
    }
  });
});

describe('specPromptKeys', () => {
  it('lists the endpoint prompt field, the greeting, assistant instructions and set prompt fields', () => {
    expect(specPromptKeys({ model: 'gpt-4o' }, 'openAI')).toEqual(['promptPrefix', 'greeting']);
    expect(specPromptKeys({ model: 'gpt-4o' }, 'assistants')).toEqual([
      'promptPrefix',
      'greeting',
      'instructions',
      'additional_instructions',
    ]);
    expect(specPromptKeys({ model: 'gpt-4o', system: 'old' }, 'openAI')).toEqual([
      'promptPrefix',
      'system',
      'greeting',
    ]);
  });
});

describe('promptKeyFor', () => {
  it('uses the system prompt where the parameter panel does (Bedrock Anthropic models)', () => {
    expect(promptKeyFor('bedrock', 'anthropic.claude-3')).toBe('system');
    expect(promptKeyFor('openAI', 'gpt-4o')).toBe('promptPrefix');
    expect(promptKeyFor('', '')).toBe('promptPrefix');
  });
});

describe('paramField', () => {
  const field: t.SchemaField = {
    path: 'p',
    key: 'temperature',
    type: 'number',
    isOptional: true,
    depth: 0,
  };

  it('adds the range to a number and the choices to an enum', () => {
    expect(
      paramField(field, { key: 'temperature', kind: 'number', min: 0, max: 2, step: 0.01 })
        .constraints,
    ).toEqual({
      min: 0,
      max: 2,
      step: 0.01,
    });
    expect(
      paramField(
        { ...field, type: 'string' },
        { key: 'effort', kind: 'enum', options: ['low', 'high'] },
      ).type,
    ).toBe('enum(low | high)');
    expect(paramField(field, { key: 'x', kind: 'text' })).toBe(field);
  });
});

describe('specSearchFields', () => {
  const specFields =
    tree.find((field) => field.key === 'modelSpecs')?.children?.find((f) => f.key === 'list')
      ?.children ?? [];

  function presetKeysFor(spec: t.ConfigValue, root: t.ConfigValue = null): string[] {
    const preset = specSearchFields(specFields, spec, root).find((field) => field.key === 'preset');
    return (preset?.children ?? []).map((field) => field.key);
  }

  it('indexes only the parameters the spec’s endpoint offers, plus what it sets', () => {
    const openAI = presetKeysFor({ preset: { endpoint: 'openAI', model: 'gpt-4o', topK: 3 } });
    expect(openAI).toEqual(expect.arrayContaining(['endpoint', 'model', 'temperature', 'topK']));
    expect(openAI).not.toContain('thinkingBudget');
    expect(openAI).not.toContain('archivedAt');
  });

  it('indexes only the prompt fields the editor shows for the endpoint, plus set ones', () => {
    const openAI = presetKeysFor({ preset: { endpoint: 'openAI', model: 'gpt-4o' } });
    expect(openAI).toEqual(expect.arrayContaining(['promptPrefix', 'greeting']));
    expect(openAI).not.toContain('system');
    expect(openAI).not.toContain('instructions');
    const bedrock = presetKeysFor({ preset: { endpoint: 'bedrock', model: 'anthropic.claude-3' } });
    expect(bedrock).toContain('system');
    expect(bedrock).not.toContain('promptPrefix');
    expect(presetKeysFor({ preset: { endpoint: 'assistants', model: 'gpt-4o' } })).toEqual(
      expect.arrayContaining(['instructions', 'additional_instructions']),
    );
    expect(
      presetKeysFor({ preset: { endpoint: 'openAI', model: 'gpt-4o', system: 'stale' } }),
    ).toContain('system');
  });

  it('indexes only the model fields the editor shows for the endpoint, plus set ones', () => {
    const openAI = presetKeysFor({ preset: { endpoint: 'openAI', model: 'gpt-4o' } });
    expect(openAI).toEqual(expect.arrayContaining(['endpoint', 'model', 'modelLabel']));
    expect(openAI).not.toContain('agent_id');
    expect(openAI).not.toContain('assistant_id');
    const agents = presetKeysFor({ preset: { endpoint: 'agents', agent_id: 'agent_1' } });
    expect(agents).toContain('agent_id');
    expect(agents).not.toContain('model');
    expect(presetKeysFor({ preset: { agent_id: 'agent_1' } })).not.toContain('model');
    expect(presetKeysFor({ preset: { endpoint: 'azureAssistants', model: 'm' } })).toContain(
      'assistant_id',
    );
    expect(
      presetKeysFor({ preset: { endpoint: 'openAI', model: 'm', agent_id: 'stale' } }),
    ).toContain('agent_id');
  });

  it('follows a custom endpoint’s parameter set', () => {
    const root = {
      endpoints: {
        custom: [{ name: 'Proxy', customParams: { defaultParamsEndpoint: 'anthropic' } }],
      },
    };
    expect(presetKeysFor({ preset: { endpoint: 'Proxy', model: 'x' } }, root)).toContain(
      'thinkingBudget',
    );
  });
});

describe('preset keys that do not apply to an endpoint', () => {
  const anthropic = new Set(['topP', 'topK', 'maxOutputTokens', 'thinking']);
  it("treats another endpoint's parameter as foreign, never the endpoint's own", () => {
    expect(isForeignPresetKey('top_p', 'anthropic', anthropic)).toBe(true);
    expect(isForeignPresetKey('max_tokens', 'anthropic', anthropic)).toBe(true);
    expect(isForeignPresetKey('topP', 'anthropic', anthropic)).toBe(false);
    expect(isForeignPresetKey('thinkingBudget', 'openAI', new Set(['top_p']))).toBe(true);
    expect(isForeignPresetKey('examples', 'anthropic', anthropic)).toBe(true);
    expect(isForeignPresetKey('examples', 'google', new Set())).toBe(false);
    expect(isForeignPresetKey('additionalModelRequestFields', 'openAI', new Set())).toBe(true);
    expect(isForeignPresetKey('additionalModelRequestFields', 'bedrock', new Set())).toBe(false);
    expect(isForeignPresetKey('assistant_id', 'assistants', new Set())).toBe(true);
    expect(isForeignPresetKey('zzNewSetting', 'openAI', new Set())).toBe(false);
  });

  it('keeps assistant and agent ids to the endpoints that run them', () => {
    expect(isMisplacedId('assistant_id', 'anthropic')).toBe(true);
    expect(isMisplacedId('assistant_id', 'assistants')).toBe(false);
    expect(isMisplacedId('agent_id', 'Azure Foundry')).toBe(true);
    expect(isMisplacedId('agent_id', 'agents')).toBe(false);
    expect(isMisplacedId('temperature', 'anthropic')).toBe(false);
  });
});
