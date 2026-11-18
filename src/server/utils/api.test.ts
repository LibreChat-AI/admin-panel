import { describe, it, expect, beforeEach, vi } from 'vitest';

const ensureFreshBearer = vi.fn();
const refreshOn401 = vi.fn();
const clearAdminSession = vi.fn();
const setResponseHeader = vi.fn();
const session = { data: {}, update: vi.fn() };

vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: (...args: string[]) => setResponseHeader(...args),
}));
vi.mock('../session', () => ({ useAppSession: async () => session }));

vi.mock('./refresh', () => ({
  clearAdminSession: (...args: unknown[]) => clearAdminSession(...args),
  ensureFreshBearer: (...args: unknown[]) => ensureFreshBearer(...args),
  refreshOn401: (...args: unknown[]) => refreshOn401(...args),
}));

import { apiFetch } from './api';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  clearAdminSession.mockReset();
  setResponseHeader.mockReset();
  ensureFreshBearer.mockReset();
  refreshOn401.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  it('throws when no bearer is available', async () => {
    ensureFreshBearer.mockResolvedValueOnce(undefined);
    await expect(apiFetch('/api/admin/grants')).rejects.toThrow('OPENID_SESSION_ENDED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends Authorization with the bearer returned by ensureFreshBearer', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-fresh');
    fetchMock.mockResolvedValueOnce(jsonResponse(200));

    await apiFetch('/api/admin/grants');

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-fresh');
    expect(refreshOn401).not.toHaveBeenCalled();
  });

  it('passes through the proactive-refresh skew window of 30s', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-fresh');
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await apiFetch('/api/admin/grants');
    expect(ensureFreshBearer).toHaveBeenCalledWith(30_000);
  });

  it('retries exactly once on 401, using the refreshed bearer', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-stale');
    refreshOn401.mockResolvedValueOnce('jwt-fresh');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const response = await apiFetch('/api/admin/grants');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshOn401).toHaveBeenCalledTimes(1);

    const [, init1] = fetchMock.mock.calls[0];
    const [, init2] = fetchMock.mock.calls[1];
    expect((init1 as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-stale' });
    expect((init2 as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-fresh' });
  });

  it('does not retry when the second response is also 401', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-stale');
    refreshOn401.mockResolvedValueOnce('jwt-fresh');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'still bad' }));

    await expect(apiFetch('/api/admin/grants')).rejects.toThrow('OPENID_SESSION_ENDED');
    expect(clearAdminSession).toHaveBeenCalledWith(session);
    expect(setResponseHeader).toHaveBeenCalledWith('X-Admin-Session-Error', 'OPENID_SESSION_ENDED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshOn401).toHaveBeenCalledTimes(1);
  });

  it('propagates a refused renewal instead of returning the original API 401', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-stale');
    refreshOn401.mockRejectedValueOnce(new Error('OPENID_SESSION_ENDED'));
    const expired = jsonResponse(401, { error: 'expired' });
    fetchMock.mockResolvedValueOnce(expired);

    await expect(apiFetch('/api/admin/grants')).rejects.toThrow('OPENID_SESSION_ENDED');
    expect(setResponseHeader).toHaveBeenCalledWith('X-Admin-Session-Error', 'OPENID_SESSION_ENDED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['OPENID_SESSION_ENDED', 'AUTH_SESSION_CHECK_UNAVAILABLE'])(
    'signals %s even if the caller catches a proactive renewal failure',
    async (code) => {
      ensureFreshBearer.mockRejectedValueOnce(new Error(code));
      await apiFetch('/api/admin/config/meta').catch(() => null);
      expect(setResponseHeader).toHaveBeenCalledWith('X-Admin-Session-Error', code);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('preserves a temporary reactive renewal failure without retrying the action', async () => {
    ensureFreshBearer.mockResolvedValueOnce('expired');
    fetchMock.mockResolvedValueOnce(jsonResponse(401));
    refreshOn401.mockRejectedValueOnce(new Error('AUTH_SESSION_CHECK_UNAVAILABLE'));
    await expect(apiFetch('/api/admin/roles', { method: 'POST' })).rejects.toThrow(
      'AUTH_SESSION_CHECK_UNAVAILABLE',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(clearAdminSession).not.toHaveBeenCalled();
    expect(setResponseHeader).toHaveBeenCalledWith(
      'X-Admin-Session-Error',
      'AUTH_SESSION_CHECK_UNAVAILABLE',
    );
  });

  it('does not call refreshOn401 on non-401 errors', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-fresh');
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'server' }));

    const response = await apiFetch('/api/admin/grants');

    expect(response.status).toBe(500);
    expect(refreshOn401).not.toHaveBeenCalled();
  });

  it('lets caller-supplied headers be overridden by the Authorization header', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-fresh');
    fetchMock.mockResolvedValueOnce(jsonResponse(200));

    await apiFetch('/api/admin/grants', {
      method: 'POST',
      headers: { Authorization: 'Bearer attacker', 'X-Custom': 'keep-me' },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-fresh');
    expect(headers['X-Custom']).toBe('keep-me');
  });
});
