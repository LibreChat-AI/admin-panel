import { describe, it, expect } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  envName,
  toTrigger,
  agentMode,
  triggerIssue,
  credentialState,
  planAgentSwitch,
  defaultPlaceholder,
} from '../state';
import { createBaseLayers, deriveFieldState, mergeScopeLayer, withScopeLayer } from '@/utils';
import { getSchemaPathSet } from '@/server/config';
import { WEB_SEARCH_SERVICES } from '@/constants';

const AGENT = 'memory.agent';
const AGENT_KEYS = ['enabled', 'id', 'provider', 'model', 'instructions', 'model_parameters'];
const AGENT_PATHS = AGENT_KEYS.map((key) => `${AGENT}.${key}`);
const SCHEMA_PATHS = getSchemaPathSet();

function baseData(yaml: t.ConfigRecord, overrides: t.ConfigRecord = {}, tombstones: string[] = []) {
  const yamlPaths = Object.entries((yaml.memory as t.ConfigRecord | undefined)?.agent ?? {}).map(
    ([key]) => `${AGENT}.${key}`,
  );
  return {
    config: mergeScopeLayer(yaml, overrides),
    yamlConfig: yaml,
    yamlPaths,
    dbOverrides: overrides,
    dbTombstones: tombstones,
    schemaDefaults: {},
  } satisfies t.BaseConfigData;
}

function statesFor(data: t.ConfigValuesData): Record<string, t.FieldState> {
  return Object.fromEntries(AGENT_PATHS.map((path) => [path, deriveFieldState(path, data)]));
}

function valuesData(layers: t.ValueLayers, editedValues: t.FlatConfigMap = {}): t.ConfigValuesData {
  return {
    configValues: layers.effective,
    editedValues,
    schemaDefaults: layers.schemaDefaults,
    isEditingScope: layers.scope != null,
    layers,
  };
}

const YAML_ID = { memory: { agent: { id: 'agent_yaml' } } };

describe('planAgentSwitch', () => {
  it('hides the librechat.yaml agent ID when switching to an inline model', () => {
    const layers = createBaseLayers(baseData(YAML_ID), SCHEMA_PATHS);
    const plan = planAgentSwitch('inline', AGENT, statesFor(valuesData(layers)), {}, {});
    expect(plan).toEqual({ hide: [`${AGENT}.id`], reset: [], unhide: [], discard: [], show: [] });
  });

  it('removes an ID only the edit target stores instead of hiding it', () => {
    const layers = createBaseLayers(
      baseData({}, { memory: { agent: { id: 'agent_admin' } } }),
      SCHEMA_PATHS,
    );
    const plan = planAgentSwitch('inline', AGENT, statesFor(valuesData(layers)), {}, {});
    expect(plan).toEqual({ hide: [], reset: [`${AGENT}.id`], unhide: [], discard: [], show: [] });
  });

  it('switching back drops the removal of the stored ID the switch away queued', () => {
    const layers = createBaseLayers(
      baseData({}, { memory: { agent: { id: 'agent_admin' } } }),
      SCHEMA_PATHS,
    );
    const edited = { [`${AGENT}.id`]: undefined, [`${AGENT}.provider`]: 'openAI' };
    const plan = planAgentSwitch('id', AGENT, statesFor(valuesData(layers, edited)), {}, edited);
    expect(plan.discard).toEqual([`${AGENT}.id`, `${AGENT}.provider`]);
    expect(plan.reset).toEqual([]);
  });

  it('switching back shows the hidden ID again and drops the inline values typed meanwhile', () => {
    const layers = createBaseLayers(baseData(YAML_ID), SCHEMA_PATHS);
    const edited = { [`${AGENT}.provider`]: 'openAI', [`${AGENT}.model`]: 'gpt-4o-mini' };
    const visibility: Record<string, t.VisibilityEdit> = { [`${AGENT}.id`]: 'hide' };
    const plan = planAgentSwitch(
      'id',
      AGENT,
      statesFor(valuesData(layers, edited)),
      visibility,
      edited,
    );
    expect(plan.unhide).toEqual([`${AGENT}.id`]);
    expect(plan.discard).toEqual([`${AGENT}.provider`, `${AGENT}.model`]);
    expect(plan.hide).toEqual([]);
  });

  it('in a profile, hides the agent ID the profile inherits from Base', () => {
    const base = createBaseLayers(baseData(YAML_ID), SCHEMA_PATHS);
    const layers = withScopeLayer(
      base,
      { principalType: PrincipalType.ROLE, name: 'USER' },
      { resolvedConfig: {}, changedPaths: [], overrides: {}, tombstones: [] },
      SCHEMA_PATHS,
    );
    const plan = planAgentSwitch('inline', AGENT, statesFor(valuesData(layers)), {}, {});
    expect(plan.hide).toEqual([`${AGENT}.id`]);
  });

  it('switching back after the switch away was saved unhides the stored ID and removes the inline override', () => {
    const layers = createBaseLayers(
      baseData(YAML_ID, { memory: { agent: { provider: 'openAI', model: 'gpt-4o-mini' } } }, [
        `${AGENT}.id`,
      ]),
      SCHEMA_PATHS,
    );
    const plan = planAgentSwitch('id', AGENT, statesFor(valuesData(layers)), {}, {});
    expect(plan).toEqual({
      hide: [],
      reset: [`${AGENT}.provider`, `${AGENT}.model`],
      unhide: [],
      discard: [],
      show: [`${AGENT}.id`],
    });
    const unhiding = planAgentSwitch(
      'id',
      AGENT,
      statesFor(valuesData(layers)),
      { [`${AGENT}.id`]: 'unhide' },
      {},
    );
    expect(unhiding.show).toEqual([]);
  });

  it('leaves keys that are already hidden alone', () => {
    const layers = createBaseLayers(baseData(YAML_ID, {}, [`${AGENT}.id`]), SCHEMA_PATHS);
    const plan = planAgentSwitch('inline', AGENT, statesFor(valuesData(layers)), {}, {});
    expect(plan).toEqual({ hide: [], reset: [], unhide: [], discard: [], show: [] });
  });
});

describe('agentMode', () => {
  it('reads how the agent is defined', () => {
    expect(agentMode({ id: 'agent_1', enabled: true })).toBe('id');
    expect(agentMode({ provider: 'openAI' })).toBe('inline');
    expect(agentMode({ enabled: true })).toBeUndefined();
    expect(agentMode({ id: '' })).toBeUndefined();
  });
});

describe('credentialState', () => {
  const serper = WEB_SEARCH_SERVICES.providers[0].credentials[0];
  const unset: t.FieldDefault = {
    hasOwnValue: false,
    value: '${SERPER_API_KEY}',
    source: 'default',
  };

  it('names the environment variable LibreChat reads when nothing is set', () => {
    expect(credentialState({ value: undefined, fieldDefault: unset, credential: serper })).toEqual({
      status: 'default',
      env: 'SERPER_API_KEY',
    });
  });

  it('reports an environment reference librechat.yaml or an override sets', () => {
    const yaml: t.FieldDefault = { ...unset, source: 'yaml', value: '${MY_KEY}' };
    expect(credentialState({ value: '${MY_KEY}', fieldDefault: yaml, credential: serper })).toEqual(
      {
        status: 'env',
        env: 'MY_KEY',
      },
    );
  });

  it('reports a stored secret by its preview, and a typed key as pending', () => {
    expect(
      credentialState({
        value: '',
        fieldDefault: unset,
        secretPreview: '...7890',
        credential: serper,
      }),
    ).toEqual({ status: 'stored', preview: '...7890' });
    expect(
      credentialState({
        value: 'sk-typed',
        fieldDefault: { ...unset, hasOwnValue: true },
        secretPreview: '...7890',
        hasPendingEdit: true,
        credential: serper,
      }),
    ).toEqual({ status: 'pending' });
  });

  it('reports an empty value as missing', () => {
    expect(
      credentialState({
        value: '',
        fieldDefault: { hasOwnValue: false, value: '', source: 'yaml' },
        credential: serper,
      }),
    ).toEqual({ status: 'missing', env: 'SERPER_API_KEY' });
  });
});

describe('summarization trigger helpers', () => {
  it('checks each trigger type against its range', () => {
    expect(triggerIssue('token_ratio', 0.8)).toBeNull();
    expect(triggerIssue('token_ratio', 1.5)).toBe('com_config_features_trigger_range_token_ratio');
    expect(triggerIssue('remaining_tokens', 0)).toBe(
      'com_config_features_trigger_range_remaining_tokens',
    );
    expect(triggerIssue('messages_to_refine', 2.5)).toBe('com_config_features_trigger_int');
    expect(triggerIssue('messages_to_refine', undefined)).toBe(
      'com_config_features_trigger_required',
    );
  });

  it('reads a trigger only from an object value', () => {
    expect(toTrigger({ type: 'token_ratio', value: 0.5 })).toEqual({
      type: 'token_ratio',
      value: 0.5,
    });
    expect(toTrigger('token_ratio')).toBeUndefined();
    expect(toTrigger({})).toBeUndefined();
  });
});

describe('envName / defaultPlaceholder', () => {
  const localize = (key: string, values?: Record<string, string | number>) =>
    `${key}:${values?.value ?? ''}`;

  it('extracts the variable of an environment reference', () => {
    expect(envName('${TAVILY_API_KEY}')).toBe('TAVILY_API_KEY');
    expect(envName('tvly-123')).toBeUndefined();
  });

  it('shows the value beneath as the placeholder, never the own value', () => {
    expect(
      defaultPlaceholder({ hasOwnValue: false, value: 'openAI', source: 'yaml' }, localize),
    ).toBe('com_config_ctl_placeholder_default:openAI');
    expect(
      defaultPlaceholder({ hasOwnValue: false, value: 'openAI', source: 'inherited' }, localize),
    ).toBe('com_config_ctl_placeholder_inherited:openAI');
    expect(
      defaultPlaceholder({ hasOwnValue: true, value: 'openAI', source: 'yaml' }, localize),
    ).toBeUndefined();
  });
});
