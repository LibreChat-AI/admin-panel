import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_DELETE_UNAVAILABLE } from '@/constants';

const apiFetchMock = vi.fn();

vi.mock('./utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
  extractApiError: async (response: Response, fallback: string) => {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${fallback}: ${response.status}`);
  },
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: never[]) => unknown) => fn,
    validator: () => ({ handler: (fn: (...args: never[]) => unknown) => fn }),
  }),
}));

import { deleteUserFn } from './users';

function reply(status: number, body: object): Response {
  return new Response(JSON.stringify(body), { status });
}

const remove = () => deleteUserFn({ data: { id: 'u 1' } });

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('deleteUserFn', () => {
  it('deletes the user through the admin users API', async () => {
    apiFetchMock.mockResolvedValue(reply(200, { message: 'User deleted' }));
    await expect(remove()).resolves.toBeUndefined();
    expect(apiFetchMock).toHaveBeenCalledWith('/api/admin/users/u%201', { method: 'DELETE' });
  });

  it("treats LibreChat's own user-not-found reply as already deleted", async () => {
    apiFetchMock.mockResolvedValue(reply(404, { error: 'User not found' }));
    await expect(remove()).resolves.toBeUndefined();
  });

  it('fails when the server has no delete route, instead of reporting a deletion', async () => {
    apiFetchMock.mockResolvedValue(reply(404, { message: 'Endpoint not found' }));
    await expect(remove()).rejects.toThrow(USER_DELETE_UNAVAILABLE);
  });

  it("fails with the admin API's message on any other refusal", async () => {
    apiFetchMock.mockResolvedValue(reply(403, { error: 'Forbidden' }));
    await expect(remove()).rejects.toThrow('Forbidden');
  });
});
