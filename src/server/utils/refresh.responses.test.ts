// @vitest-environment node
import { createServer } from 'node:http';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ url: '' }));
vi.mock('./url', () => ({ getServerApiUrl: () => backend.url }));
vi.mock('./tenant', () => ({ tenantHeaders: () => ({}) }));
vi.mock('../session', () => ({ useAppSession: vi.fn() }));

import { refreshAdminToken } from './refresh';

let backendRoot = '';
let location = '/login';
let loginRequests = 0;
const server = createServer((request, response) => {
  if (request.url?.endsWith('/api/auth/refresh')) {
    response.writeHead(302, { Location: location });
    response.end();
    return;
  }
  loginRequests++;
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>Sign in</title>');
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP test address');
  backendRoot = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  backend.url = backendRoot;
  location = '/login';
  loginRequests = 0;
});

describe('password refresh HTTP redirects', () => {
  it('recognizes the legacy login redirect without following it to HTML', async () => {
    await expect(refreshAdminToken('refresh-token', 'librechat', 'user')).resolves.toBeUndefined();
    expect(loginRequests).toBe(0);
  });

  it('recognizes an absolute login redirect on the same backend', async () => {
    location = `${backend.url}/login`;

    await expect(refreshAdminToken('refresh-token', 'librechat', 'user')).resolves.toBeUndefined();
    expect(loginRequests).toBe(0);
  });

  it.each(['/login', '/librechat/login'])(
    'recognizes the login redirect through a backend subpath: %s',
    async (target) => {
      backend.url = `${backendRoot}/librechat`;
      location = target;

      await expect(
        refreshAdminToken('refresh-token', 'librechat', 'user'),
      ).resolves.toBeUndefined();
      expect(loginRequests).toBe(0);
    },
  );

  it.each(['/maintenance', '/login?unexpected=true', 'https://other.example/login'])(
    'keeps an unexpected redirect retryable: %s',
    async (target) => {
      location = target;

      await expect(refreshAdminToken('refresh-token', 'librechat', 'user')).rejects.toThrow(
        'AUTH_SESSION_CHECK_UNAVAILABLE',
      );
      expect(loginRequests).toBe(0);
    },
  );
});
