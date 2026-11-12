import { PrincipalType } from 'librechat-data-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('../utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: () => ({ handler: (fn: (...args: never[]) => unknown) => fn }),
    handler: (fn: (...args: never[]) => unknown) => fn,
  }),
}));

import { previewPath, toConfigPreview, getConfigPreviewFn } from './preview';

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

/** `GET /api/admin/config/effective?userId=` for a user in the USER role and one group, abridged. */
const EFFECTIVE = {
  userId: 'u1',
  principals: [
    { principalType: 'user', principalId: 'u1' },
    { principalType: 'role', principalId: 'USER' },
    { principalType: 'group', principalId: 'g1' },
    { principalType: 'public' },
  ],
  yaml: { interface: { customWelcome: 'Hi' } },
  layers: [
    {
      principalType: 'role',
      principalId: '__base__',
      priority: 0,
      isActive: true,
      revision: 'r:1',
      overrides: { endpoints: { custom: [{ name: 'Ollama', baseURL: 'http://x' }] } },
      tombstones: [],
      ignored: [
        {
          path: 'endpoints.custom["Ollama"].apiKey',
          segments: ['endpoints', 'custom', 'Ollama', 'apiKey'],
          reason: 'secret_rebinding',
        },
        { path: 'nowhere', segments: [], reason: 'unknown_section' },
      ],
    },
    {
      principalType: 'role',
      principalId: 'USER',
      priority: 10,
      isActive: false,
      overrides: { interface: { bookmarks: false } },
      tombstones: ['interface.customWelcome'],
      ignored: [
        {
          path: 'interface.bookmarks',
          segments: ['interface', 'bookmarks'],
          reason: 'interface_permission',
        },
        {
          path: 'speech.tts',
          segments: ['speech', 'tts'],
          reason: 'some_new_reason',
          code: 'too_big',
          tombstone: true,
        },
      ],
    },
    { principalType: 'nobody', principalId: 'x', overrides: {} },
  ],
  resolved: { interface: { customWelcome: 'Welcome, engineers' } },
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('toConfigPreview', () => {
  it('reads librechat.yaml, the documents in merge order with what each leaves out, and the result', () => {
    const preview = toConfigPreview(EFFECTIVE);
    expect(preview).toEqual({
      source: 'server',
      yaml: { interface: { customWelcome: 'Hi' } },
      resolved: { interface: { customWelcome: 'Welcome, engineers' } },
      principals: [
        { principalType: 'user', principalId: 'u1' },
        { principalType: 'role', principalId: 'USER' },
        { principalType: 'group', principalId: 'g1' },
      ],
      layers: [
        {
          principalType: 'role',
          principalId: '__base__',
          priority: 0,
          isActive: true,
          overrides: { endpoints: { custom: [{ name: 'Ollama', baseURL: 'http://x' }] } },
          tombstones: [],
          ignored: [
            {
              segments: ['endpoints', 'custom', 'Ollama', 'apiKey'],
              reason: 'secret_rebinding',
              tombstone: false,
            },
          ],
        },
        {
          principalType: 'role',
          principalId: 'USER',
          priority: 10,
          isActive: false,
          overrides: { interface: { bookmarks: false } },
          tombstones: ['interface.customWelcome'],
          ignored: [
            {
              segments: ['interface', 'bookmarks'],
              reason: 'interface_permission',
              tombstone: false,
            },
            { segments: ['speech', 'tts'], reason: 'unknown', code: 'too_big', tombstone: true },
          ],
        },
      ],
    });
  });

  it('reads a profile resolution, which names no principals', () => {
    const preview = toConfigPreview({
      principalType: 'group',
      principalId: 'g1',
      yaml: {},
      layers: [],
      resolved: {},
    });
    expect(preview).toEqual({ source: 'server', yaml: {}, layers: [], resolved: {} });
  });

  it('reads a reply without a result as none', () => {
    expect(toConfigPreview({ yaml: {}, layers: [] })).toBeNull();
    expect(toConfigPreview(null)).toBeNull();
  });
});

describe('previewPath', () => {
  it('resolves a user over every profile that applies to them', () => {
    expect(previewPath({ principalType: PrincipalType.USER, principalId: 'u 1' })).toBe(
      '/api/admin/config/effective?userId=u%201',
    );
  });

  it('resolves Base, a role or a group as one profile over Base', () => {
    expect(previewPath({ principalType: PrincipalType.ROLE, principalId: '__base__' })).toBe(
      '/api/admin/config/resolved/role/__base__',
    );
    expect(previewPath({ principalType: PrincipalType.GROUP, principalId: 'a/b' })).toBe(
      '/api/admin/config/resolved/group/a%2Fb',
    );
  });
});

describe('getConfigPreviewFn', () => {
  it('returns the resolution', async () => {
    apiFetchMock.mockResolvedValue(json(EFFECTIVE));
    const result = await getConfigPreviewFn({
      data: { principalType: PrincipalType.USER, principalId: 'u1' },
    });
    expect(apiFetchMock).toHaveBeenCalledWith('/api/admin/config/effective?userId=u1', undefined);
    expect(result.ok && result.preview.layers).toHaveLength(2);
  });

  it("returns a refusal's status and code, so the preview can say why", async () => {
    apiFetchMock.mockResolvedValue(json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404));
    await expect(
      getConfigPreviewFn({ data: { principalType: PrincipalType.USER, principalId: 'gone' } }),
    ).resolves.toEqual({
      ok: false,
      status: 404,
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
    apiFetchMock.mockResolvedValue(new Response('nope', { status: 403 }));
    await expect(
      getConfigPreviewFn({ data: { principalType: PrincipalType.ROLE, principalId: 'USER' } }),
    ).resolves.toEqual({ ok: false, status: 403 });
  });

  it('treats an unreadable reply as a failure', async () => {
    apiFetchMock.mockResolvedValue(json({ layers: [] }));
    await expect(
      getConfigPreviewFn({ data: { principalType: PrincipalType.ROLE, principalId: 'USER' } }),
    ).resolves.toEqual({ ok: false, status: 200 });
  });
});
