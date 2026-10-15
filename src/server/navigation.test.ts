import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNavigationUrlsFn, resolveNavigationUrls } from './navigation';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: <T>(fn: T): T => fn }),
}));

afterEach(() => vi.unstubAllEnvs());

describe('cross-application navigation', () => {
  it('uses the Gateway entry route for Chat when configured', () => {
    expect(
      resolveNavigationUrls('https://gateway.example.test/', 'https://chat.example.test/chat'),
    ).toEqual({
      gatewayUrl: 'https://gateway.example.test',
      governanceAdminUrl: 'https://gateway.example.test/admin',
      chatUrl: 'https://gateway.example.test/api/auth/open-chat',
    });
  });

  it('uses the configured Chat base path without a Gateway', () => {
    expect(resolveNavigationUrls(undefined, 'https://chat.example.test/chat/')).toEqual({
      gatewayUrl: undefined,
      governanceAdminUrl: undefined,
      chatUrl: 'https://chat.example.test/chat/c/new',
    });
  });

  it('falls back to the API base URL when the Chat URL is empty', async () => {
    vi.stubEnv('WEB_PUBLIC_URL', undefined);
    vi.stubEnv('LIBRECHAT_PUBLIC_URL', '');
    vi.stubEnv('VITE_API_BASE_URL', 'https://chat.example.test');

    expect(await getNavigationUrlsFn()).toEqual({
      gatewayUrl: undefined,
      governanceAdminUrl: undefined,
      chatUrl: 'https://chat.example.test/c/new',
    });
  });

  it('does not expose unsupported URL schemes', () => {
    expect(resolveNavigationUrls('javascript:alert(1)', 'data:text/html,unsafe')).toEqual({
      gatewayUrl: undefined,
      governanceAdminUrl: undefined,
      chatUrl: undefined,
    });
  });
});
