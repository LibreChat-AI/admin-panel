import { describe, expect, it, vi } from 'vitest';
import type * as t from '@/types';
import {
  isSsoProviderId,
  ssoCallbackError,
  resolveSsoCallback,
  offeredSsoProviders,
  parseSsoCallbackSearch,
} from './auth';
import { AUTH_ERROR_KEYS, SSO_PROVIDERS, SSO_PROVIDER_IDS } from '@/constants';
import translation from '@/locales/en/translation.json';

const CODE = 'a'.repeat(64);

describe('ssoCallbackError', () => {
  it.each([
    ['TENANT_CONTEXT_REQUIRED', 'tenant_required'],
    ['auth_failed', 'sso_auth_failed'],
    ['pkce_store_failed', 'sso_pkce_failed'],
    ['pkce_retrieval_failed', 'sso_pkce_failed'],
  ])('reads LibreChat callback error %s as %s', (error, code) => {
    expect(ssoCallbackError(error)).toBe(code);
  });

  it.each(['access_denied', '<img src=x onerror=alert(1)>', 'tenant_context_required'])(
    'reads an unknown error (%s) as the generic failure, never as its text',
    (error) => {
      expect(ssoCallbackError(error)).toBe('sso_failed');
    },
  );
});

describe('parseSsoCallbackSearch', () => {
  it('keeps the code and error LibreChat sent as text', () => {
    expect(
      parseSsoCallbackSearch({ code: CODE, error: 'auth_failed', error_description: 'Failed' }),
    ).toEqual({ code: CODE, error: 'auth_failed' });
  });

  it('reads a value TanStack parsed as JSON as no code, or an unknown error', async () => {
    const search = parseSsoCallbackSearch({ code: 1234, error: { html: '<b>x</b>' } });

    expect(search.code).toBeUndefined();
    expect(await resolveSsoCallback(search, vi.fn<t.SsoExchange>())).toEqual({
      error: true,
      code: 'sso_failed',
    });
    expect(
      await resolveSsoCallback(parseSsoCallbackSearch({ code: 1234 }), vi.fn<t.SsoExchange>()),
    ).toEqual({ error: true, code: 'sso_exchange_failed' });
  });
});

describe('resolveSsoCallback', () => {
  it('reports the error LibreChat redirected with without spending a code', async () => {
    const exchange = vi.fn<t.SsoExchange>();

    const result = await resolveSsoCallback(
      { code: CODE, error: 'TENANT_CONTEXT_REQUIRED' },
      exchange,
    );

    expect(result).toEqual({ error: true, code: 'tenant_required' });
    expect(exchange).not.toHaveBeenCalled();
  });

  it.each([{}, { code: 'not-hex' }, { code: '' }])(
    'fails a callback without a well-formed code (%j) without exchanging it',
    async (search) => {
      const exchange = vi.fn<t.SsoExchange>();

      expect(await resolveSsoCallback(search, exchange)).toEqual({
        error: true,
        code: 'sso_exchange_failed',
      });
      expect(exchange).not.toHaveBeenCalled();
    },
  );

  it('completes once the exchange signs the admin in, with the path sign-in started from', async () => {
    const signedIn: t.SsoSignedIn = {
      error: false,
      user: { id: 'user-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
      redirectTo: '/grants',
    };
    const exchange = vi.fn<t.SsoExchange>().mockResolvedValue(signedIn);

    expect(await resolveSsoCallback({ code: CODE }, exchange)).toEqual(signedIn);
    expect(exchange).toHaveBeenCalledWith(CODE);
  });

  it("keeps the exchange's own failure", async () => {
    const exchange = vi.fn<t.SsoExchange>().mockResolvedValue({
      error: true,
      code: 'sso_code_expired',
    });

    expect(await resolveSsoCallback({ code: CODE }, exchange)).toEqual({
      error: true,
      code: 'sso_code_expired',
    });
  });

  it('fails an exchange that throws', async () => {
    const exchange = vi.fn<t.SsoExchange>().mockRejectedValue(new Error('network'));

    expect(await resolveSsoCallback({ code: CODE }, exchange)).toEqual({
      error: true,
      code: 'sso_exchange_failed',
    });
  });
});

describe('offeredSsoProviders', () => {
  const NONE_CHECKED: ReadonlySet<t.SsoProviderId> = new Set();
  const OPENID_CHECKED: ReadonlySet<t.SsoProviderId> = new Set(['openid']);
  const SOCIAL: t.SsoStartupConfig = { socialLoginEnabled: true };

  it('offers OpenID on its check alone, without the startup config', () => {
    expect(offeredSsoProviders(undefined, OPENID_CHECKED)).toEqual([{ id: 'openid' }]);
    expect(offeredSsoProviders(undefined, NONE_CHECKED)).toEqual([]);
  });

  it('offers no OpenID whose check failed, whatever the startup config says', () => {
    expect(offeredSsoProviders({ ...SOCIAL, openidLabel: 'Okta' }, NONE_CHECKED)).toEqual([]);
  });

  it('offers Google and SAML on their flags while social login is on, in registry order', () => {
    const config: t.SsoStartupConfig = {
      ...SOCIAL,
      googleLoginEnabled: true,
      samlLoginEnabled: true,
    };

    expect(offeredSsoProviders(config, OPENID_CHECKED).map(({ id }) => id)).toEqual([
      'openid',
      'google',
      'saml',
    ]);
  });

  it('offers no Google or SAML with social login off: LibreChat registers neither strategy then', () => {
    const config: t.SsoStartupConfig = {
      socialLoginEnabled: false,
      googleLoginEnabled: true,
      samlLoginEnabled: true,
    };

    expect(offeredSsoProviders(config, NONE_CHECKED)).toEqual([]);
    expect(offeredSsoProviders({ ...config, socialLoginEnabled: undefined }, NONE_CHECKED)).toEqual(
      [],
    );
  });

  it('offers no provider whose flag is off', () => {
    expect(
      offeredSsoProviders(
        { ...SOCIAL, googleLoginEnabled: false, samlLoginEnabled: false },
        NONE_CHECKED,
      ),
    ).toEqual([]);
  });

  it('honours the socialLogins list LibreChat names its sign-in buttons by', () => {
    const config: t.SsoStartupConfig = {
      ...SOCIAL,
      socialLogins: ['google'],
      googleLoginEnabled: true,
      samlLoginEnabled: true,
    };

    expect(offeredSsoProviders(config, OPENID_CHECKED)).toEqual([{ id: 'google' }]);
    expect(offeredSsoProviders({ ...config, socialLogins: [] }, OPENID_CHECKED)).toEqual([]);
  });

  it('orders the buttons as socialLogins does, skipping names the panel has no provider for', () => {
    const config: t.SsoStartupConfig = {
      ...SOCIAL,
      socialLogins: ['github', 'saml', 'google', 'saml', 'openid'],
      googleLoginEnabled: true,
      samlLoginEnabled: true,
    };

    expect(offeredSsoProviders(config, OPENID_CHECKED)).toEqual([
      { id: 'saml' },
      { id: 'google' },
      { id: 'openid' },
    ]);
  });

  it("names OpenID's and SAML's buttons as the deployer did, and Google's by its phrase", () => {
    const config: t.SsoStartupConfig = {
      ...SOCIAL,
      googleLoginEnabled: true,
      samlLoginEnabled: true,
      openidLabel: '  Sign in with Okta ',
      samlLabel: '',
    };

    expect(offeredSsoProviders(config, OPENID_CHECKED)).toEqual([
      { id: 'openid', label: 'Sign in with Okta' },
      { id: 'google' },
      { id: 'saml' },
    ]);
  });
});

describe('isSsoProviderId', () => {
  it.each(SSO_PROVIDER_IDS)('knows %s', (id) => {
    expect(isSsoProviderId(id)).toBe(true);
  });

  it.each(['github', 'OpenID', 'constructor', '__proto__', ''])('knows no provider %j', (value) => {
    expect(isSsoProviderId(value)).toBe(false);
  });
});

describe('SSO_PROVIDERS', () => {
  it('words the button of every provider with an English phrase', () => {
    const phrases: Record<string, string> = translation;
    const missing = SSO_PROVIDER_IDS.filter((id) => !phrases[SSO_PROVIDERS[id].labelKey]);
    expect(missing).toEqual([]);
  });
});

describe('AUTH_ERROR_KEYS', () => {
  it('words every sign-in failure with an English phrase', () => {
    const phrases: Record<string, string> = translation;
    const missing = Object.values(AUTH_ERROR_KEYS).filter((key) => !phrases[key]);
    expect(missing).toEqual([]);
  });
});
