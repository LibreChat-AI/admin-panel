import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import { getValueAtPath } from './format';
import {
  findHiddenEndpointUses,
  selectsHiddenEndpoint,
  describeHiddenNameUses,
  withoutUnservedEndpointUses,
} from './dependents';

const config: t.ConfigRecord = {
  modelSpecs: {
    list: [
      { name: 'gpt', label: 'GPT 5', preset: { endpoint: 'Azure Foundry', model: 'gpt-5' } },
      { name: 'local', preset: { endpoint: 'ollama', model: 'llama' } },
      { name: 'claude', label: 'Claude', preset: { endpoint: 'Claude', model: 'c' } },
    ],
    addedEndpoints: ['agents', 'Azure Foundry'],
  },
  endpoints: { agents: { allowedProviders: ['Azure Foundry'] } },
};

describe('findHiddenEndpointUses', () => {
  it('names the specs that select a hidden endpoint, as LibreChat folds names', () => {
    const uses = findHiddenEndpointUses(config, new Set(['Azure Foundry', 'ollama']));
    expect(uses.specs).toEqual(['GPT 5', 'local']);
  });

  it('says a list that names the endpoint loses it, or allows none when it names nothing else', () => {
    const uses = findHiddenEndpointUses(config, new Set(['Azure Foundry']));
    expect(uses.addedEndpoints).toBe('dropped');
    expect(uses.allowedProviders).toBe('only');
  });

  it('judges a list by every endpoint the profile hides, and only names this one', () => {
    const both: t.ConfigRecord = {
      ...config,
      endpoints: { agents: { allowedProviders: ['Azure Foundry', 'Ollama'] } },
    };
    const alone = findHiddenEndpointUses(both, new Set(['Azure Foundry']));
    expect(alone.allowedProviders).toBe('dropped');
    const all = new Set(['Azure Foundry', 'ollama']);
    const together = findHiddenEndpointUses(both, new Set(['Azure Foundry']), all);
    expect(together.allowedProviders).toBe('only');
    expect(findHiddenEndpointUses(both, new Set(['Claude']), all).allowedProviders).toBe('none');
  });

  it('finds nothing for no hidden endpoint', () => {
    expect(findHiddenEndpointUses(config, new Set())).toEqual({
      specs: [],
      addedEndpoints: 'none',
      allowedProviders: 'none',
    });
  });

  it('words each list a hide changes', () => {
    const localize = (key: string) => key;
    expect(
      describeHiddenNameUses(
        { specs: [], addedEndpoints: 'dropped', allowedProviders: 'only' },
        localize,
      ),
    ).toEqual([
      'com_config_ce_hidden_added_endpoints',
      'com_config_ce_hidden_allowed_providers_only',
    ]);
    expect(
      describeHiddenNameUses(
        { specs: [], addedEndpoints: 'none', allowedProviders: 'none' },
        localize,
      ),
    ).toEqual([]);
  });

  it('reads one spec', () => {
    expect(selectsHiddenEndpoint({ preset: { endpoint: 'OLLAMA' } }, new Set(['ollama']))).toBe(
      true,
    );
    expect(selectsHiddenEndpoint({ preset: {} }, new Set(['ollama']))).toBe(false);
  });
});

describe('withoutUnservedEndpointUses', () => {
  const foundry = { name: 'Azure Foundry', baseURL: 'https://foundry' };
  const claude = { name: 'Claude', baseURL: 'https://claude' };
  const served: t.ConfigRecord = {
    ...config,
    endpoints: { agents: { allowedProviders: ['Azure Foundry'] }, custom: [claude] },
  };

  it('leaves out the specs and names of an endpoint a layer defines that the merge removed', () => {
    const scoped = withoutUnservedEndpointUses(served, [[foundry, claude]]);
    expect(scoped.modelSpecs).toEqual({
      list: [
        { name: 'local', preset: { endpoint: 'ollama', model: 'llama' } },
        { name: 'claude', label: 'Claude', preset: { endpoint: 'Claude', model: 'c' } },
      ],
      addedEndpoints: ['agents'],
    });
    expect(getValueAtPath(scoped, 'endpoints.agents.allowedProviders')).toEqual(['Azure Foundry']);
    expect(getValueAtPath(scoped, 'endpoints.custom')).toEqual([claude]);
  });

  it('drops the spec settings once no spec and no added endpoint is left', () => {
    const only: t.ConfigRecord = {
      modelSpecs: { list: [{ name: 'gpt', preset: { endpoint: 'Azure Foundry' } }] },
      endpoints: { custom: [] },
      interface: { modelSelect: true },
    };
    expect(withoutUnservedEndpointUses(only, [[foundry]])).toEqual({
      endpoints: { custom: [] },
      interface: { modelSelect: true },
    });
  });

  it('is the same config when every endpoint a layer defines is served', () => {
    const all: t.ConfigRecord = { ...config, endpoints: { custom: [foundry, claude] } };
    expect(withoutUnservedEndpointUses(all, [[foundry], undefined])).toBe(all);
  });
});
