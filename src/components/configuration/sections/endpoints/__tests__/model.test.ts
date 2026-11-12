import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import {
  modelNames,
  isUnserved,
  endpointHost,
  isUsableBaseURL,
  validateEndpoint,
  hasBlockingIssue,
  addsOpenRouterDefaults,
} from '../model';
import { monogram } from '../List';

const complete: t.ConfigRecord = {
  name: 'OpenRouter',
  apiKey: '${OPENROUTER_KEY}',
  baseURL: 'https://openrouter.ai/api/v1',
  models: { default: ['openai/gpt-4o-mini'] },
};

function codes(input: Partial<t.EndpointValidationInput> & { entry: t.ConfigValue }): string[] {
  return validateEndpoint({
    otherNames: [],
    fromLowerLayer: false,
    storedSecret: false,
    ...input,
  }).map((issue) => issue.code);
}

describe('validateEndpoint', () => {
  it('accepts a complete endpoint', () => {
    expect(codes({ entry: complete })).toEqual([]);
  });

  it('refuses a new or renamed name LibreChat could not remove or hide by key', () => {
    for (const name of ['$proxy', '__proxy', 'constructor', 'x'.repeat(9)]) {
      expect(codes({ entry: { ...complete, name }, maxKeyLength: 8 })).toEqual([
        'nameUnaddressable',
      ]);
    }
    expect(
      codes({ entry: { ...complete, name: '$proxy' }, loadedName: 'Old', maxKeyLength: 8 }),
    ).toEqual(['nameUnaddressable']);
    expect(
      codes({ entry: { ...complete, name: '$proxy' }, loadedName: '$proxy', maxKeyLength: 8 }),
    ).toEqual([]);
    expect(codes({ entry: { ...complete, name: '$proxy' } })).toEqual([]);
  });

  it('flags a name-only endpoint as not served (custom-08)', () => {
    const issues = validateEndpoint({
      entry: { name: 'OnlyName' },
      otherNames: [],
      fromLowerLayer: false,
      storedSecret: false,
    });
    expect(issues.map((issue) => issue.code)).toEqual([
      'apiKeyRequired',
      'baseUrlRequired',
      'modelsRequired',
    ]);
    expect(isUnserved(issues)).toBe(true);
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it('requires a default model even when the list is fetched, but serves it', () => {
    const entry = { ...complete, models: { default: [], fetch: true } };
    const issues = validateEndpoint({
      entry,
      otherNames: [],
      fromLowerLayer: false,
      storedSecret: false,
    });
    expect(issues.map((issue) => issue.code)).toEqual(['modelsRequired']);
    expect(isUnserved(issues)).toBe(false);
  });

  it('rejects reserved, padded, blank and taken names', () => {
    expect(codes({ entry: { ...complete, name: 'openAI' } })).toEqual(['nameReserved']);
    expect(codes({ entry: { ...complete, name: ' GPT' } })).toEqual(['nameWhitespace']);
    expect(codes({ entry: { ...complete, name: '  ' } })).toEqual(['nameRequired']);
    expect(codes({ entry: complete, otherNames: ['OpenRouter'] })).toEqual(['nameTaken']);
  });

  it('only warns about a name that differs in letter case', () => {
    const issues = validateEndpoint({
      entry: complete,
      otherNames: ['openrouter'],
      fromLowerLayer: false,
      storedSecret: false,
    });
    expect(issues).toEqual([
      { field: 'name', code: 'nameSimilar', severity: 'warning', params: { name: 'openrouter' } },
    ]);
  });

  it('rejects a name LibreChat serves under the same key as another (any case of "ollama")', () => {
    const issues = validateEndpoint({
      entry: { ...complete, name: 'ollama' },
      otherNames: ['Ollama'],
      fromLowerLayer: false,
      storedSecret: false,
    });
    expect(issues).toEqual([
      { field: 'name', code: 'nameMerged', severity: 'error', params: { name: 'Ollama' } },
    ]);
  });

  it('flags blank models and warns about repeated ones (custom-09)', () => {
    const entry = {
      ...complete,
      models: { default: ['@cf/gemma', '', '@cf/gemma', { name: 'kimi', description: 'K' }] },
    };
    const issues = validateEndpoint({
      entry,
      otherNames: [],
      fromLowerLayer: false,
      storedSecret: false,
    });
    expect(issues.map((issue) => [issue.code, issue.severity])).toEqual([
      ['modelBlank', 'error'],
      ['modelDuplicate', 'warning'],
    ]);
    expect(issues[1].params).toEqual({ models: '@cf/gemma' });
  });

  it('does not ask for the key or name of an endpoint librechat.yaml defines (CE-9)', () => {
    const yamlEntry = {
      name: 'Ollama',
      baseURL: 'http://ollama:11434/v1',
      models: { default: ['x'] },
    };
    expect(codes({ entry: yamlEntry, fromLowerLayer: true, otherNames: ['Ollama'] })).toEqual([]);
  });

  it('counts a stored key and asks for it again on rename (CE-1)', () => {
    const stored = { ...complete, apiKey: undefined, apiKeyPreview: '...0XYZ' };
    expect(codes({ entry: stored, storedSecret: true, loadedName: 'OpenRouter' })).toEqual([]);
    expect(
      codes({
        entry: { ...stored, name: 'Renamed' },
        storedSecret: true,
        loadedName: 'OpenRouter',
      }),
    ).toEqual(['renameNeedsKey']);
    expect(
      codes({
        entry: { ...stored, name: 'Renamed', apiKey: 'sk-new' },
        storedSecret: true,
        loadedName: 'OpenRouter',
      }),
    ).toEqual([]);
    expect(
      codes({
        entry: { ...stored, name: 'Renamed' },
        storedSecret: true,
        loadedName: 'OpenRouter',
        carriesKey: true,
      }),
    ).toEqual([]);
  });

  it('warns about a base URL that is not a URL, but accepts env references', () => {
    expect(codes({ entry: { ...complete, baseURL: 'api.example.com/v1' } })).toEqual([
      'baseUrlInvalid',
    ]);
    expect(codes({ entry: { ...complete, baseURL: '${OLLAMA_URL}' } })).toEqual([]);
    expect(codes({ entry: { ...complete, baseURL: 'user_provided' } })).toEqual([]);
  });
});

describe('list row helpers', () => {
  it('shows the host and path without the scheme, env references as written', () => {
    expect(endpointHost('https://api.moonshot.ai/v1/')).toBe('api.moonshot.ai/v1');
    expect(endpointHost('https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/x')).toBe(
      'gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/x',
    );
    expect(endpointHost(undefined)).toBeNull();
  });

  it('reads model names from both model forms', () => {
    expect(modelNames({ models: { default: ['a', { name: 'b', description: 'B' }] } })).toEqual([
      'a',
      'b',
    ]);
  });

  it('recognizes usable base URLs', () => {
    expect(isUsableBaseURL('http://host.docker.internal:11434/v1')).toBe(true);
    expect(isUsableBaseURL('ftp://x')).toBe(false);
  });
});

describe('monogram', () => {
  it('takes the initials of words, skipping punctuation', () => {
    expect(monogram('Azure (DeepSeek)')).toBe('AD');
    expect(monogram('open_router')).toBe('OR');
    expect(monogram('Mistral')).toBe('MI');
    expect(monogram('(x)')).toBe('X');
  });
});

describe('addsOpenRouterDefaults', () => {
  it("is an endpoint named for OpenRouter or pointing at it, unless another provider's defaults are chosen", () => {
    expect(addsOpenRouterDefaults({ name: 'OpenRouter' })).toBe(true);
    expect(addsOpenRouterDefaults({ name: 'Gateway', baseURL: 'https://x/openrouter' })).toBe(true);
    expect(
      addsOpenRouterDefaults({
        name: 'OpenRouter 2',
        customParams: { defaultParamsEndpoint: 'anthropic' },
      }),
    ).toBe(false);
    expect(
      addsOpenRouterDefaults({
        name: 'OpenRouter',
        customParams: { defaultParamsEndpoint: 'custom' },
      }),
    ).toBe(true);
    expect(addsOpenRouterDefaults({ name: 'Groq', baseURL: 'https://api.groq.com' })).toBe(false);
  });
});
