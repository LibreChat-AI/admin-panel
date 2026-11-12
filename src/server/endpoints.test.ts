import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();
const userAgentMock = vi.fn();

vi.mock('./utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: (name: string) => userAgentMock(name),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: never[]) => unknown) => fn,
  }),
}));

import {
  getToolsFn,
  getModelsFn,
  toToolOptions,
  getEndpointStatusFn,
  toEndpointModelsMap,
  toEndpointStatusMap,
} from './endpoints';

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toEndpointStatusMap', () => {
  it('keeps the endpoints LibreChat serves, marking custom and user-provided ones', () => {
    const map = toEndpointStatusMap({
      openAI: { userProvide: false, order: 0 },
      Moonshot: { type: 'custom', userProvide: true, modelDisplayLabel: 'Kimi' },
      broken: 'nope',
    });
    expect(map).toEqual({
      openAI: { name: 'openAI', custom: false, userProvide: false },
      Moonshot: { name: 'Moonshot', custom: true, userProvide: true, label: 'Kimi' },
    });
  });

  it('treats a non-object payload as no endpoints', () => {
    expect(toEndpointStatusMap(null)).toEqual({});
    expect(toEndpointStatusMap(['openAI'])).toEqual({});
  });
});

describe('toEndpointModelsMap', () => {
  it('drops blank, duplicate and non-string model names', () => {
    expect(
      toEndpointModelsMap({
        anthropic: ['claude-opus-5-5', '', 'claude-opus-5-5', 3, '  '],
        google: 'not a list',
      }),
    ).toEqual({ anthropic: ['claude-opus-5-5'] });
  });
});

describe('toToolOptions', () => {
  it('values tools by plugin key and labels them by name', () => {
    expect(
      toToolOptions([
        { name: 'Calculator', pluginKey: 'calculator', description: 'Math' },
        { pluginKey: 'wolfram' },
        { name: 'No key' },
        { name: 'Dup', pluginKey: 'calculator' },
      ]),
    ).toEqual([
      { value: 'calculator', label: 'Calculator', description: 'Math' },
      { value: 'wolfram', label: 'wolfram' },
    ]);
  });
});

describe('endpoint server functions', () => {
  it('reads the enabled endpoints from /api/endpoints', async () => {
    apiFetchMock.mockResolvedValue(json({ anthropic: { userProvide: false } }));
    await expect(getEndpointStatusFn()).resolves.toEqual({
      anthropic: { name: 'anthropic', custom: false, userProvide: false },
    });
    expect(apiFetchMock).toHaveBeenCalledWith('/api/endpoints', undefined);
  });

  it('reads the models from /api/models and fails loudly on an error status', async () => {
    apiFetchMock.mockResolvedValueOnce(json({ anthropic: ['a'] }));
    await expect(getModelsFn()).resolves.toEqual({ anthropic: ['a'] });
    apiFetchMock.mockResolvedValueOnce(json({ message: 'nope' }, 500));
    await expect(getModelsFn()).rejects.toThrow('Failed to load models: 500');
  });

  it("forwards the admin's user agent to the agent tools route", async () => {
    userAgentMock.mockReturnValue('Mozilla/5.0');
    apiFetchMock.mockResolvedValue(json([{ name: 'Calculator', pluginKey: 'calculator' }]));
    await expect(getToolsFn()).resolves.toEqual([{ value: 'calculator', label: 'Calculator' }]);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/agents/tools', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
  });
});
