import type * as t from '@/types';
import {
  SSO_PROVIDERS,
  SSO_PROVIDER_IDS,
  SSO_CALLBACK_ERRORS,
  EXCHANGE_CODE_PATTERN,
} from '@/constants';

const SSO_PROVIDER_ID_SET: ReadonlySet<string> = new Set(SSO_PROVIDER_IDS);

export function isSsoProviderId(value: string): value is t.SsoProviderId {
  return SSO_PROVIDER_ID_SET.has(value);
}

/** LibreChat's route that starts the provider's admin sign-in. */
export function ssoStartPath(id: t.SsoProviderId): string {
  return `/api/admin/oauth/${id}`;
}

/** The panel's route LibreChat sends the admin back to from the provider. */
export function ssoCallbackPath(id: t.SsoProviderId): string {
  return `/auth/${id}/callback`;
}

/**
 * The providers in button order. With a `socialLogins` list, LibreChat's own
 * sign-in page shows only those, in that order, and so does the panel;
 * without one, the registry's order.
 */
function ssoButtonOrder(config: t.SsoStartupConfig | undefined): readonly t.SsoProviderId[] {
  const socialLogins = config?.socialLogins;
  if (!Array.isArray(socialLogins)) return SSO_PROVIDER_IDS;
  return [...new Set(socialLogins)].filter(isSsoProviderId);
}

/**
 * Whether LibreChat can sign the admin in with the provider. A flag of
 * `GET /api/config` counts only with social login on: LibreChat registers
 * those admin strategies under `ALLOW_SOCIAL_LOGIN` alone.
 */
function isSsoOffered(
  id: t.SsoProviderId,
  config: t.SsoStartupConfig | undefined,
  checked: ReadonlySet<t.SsoProviderId>,
): boolean {
  const { availability } = SSO_PROVIDERS[id];
  if (availability === 'check') return checked.has(id);
  return config?.socialLoginEnabled === true && config[availability] === true;
}

/** The deployer's name for the provider's button, when `GET /api/config` has one. */
function ssoButtonLabel(
  id: t.SsoProviderId,
  config: t.SsoStartupConfig | undefined,
): string | undefined {
  const { configLabel } = SSO_PROVIDERS[id];
  const label = configLabel ? config?.[configLabel] : undefined;
  return typeof label === 'string' && label.trim() ? label.trim() : undefined;
}

/**
 * The providers the sign-in page offers, in the order of their buttons.
 * `config` is LibreChat's `GET /api/config` (`undefined` when it could not be
 * read); `checked` holds the providers whose `/check` route answered.
 */
export function offeredSsoProviders(
  config: t.SsoStartupConfig | undefined,
  checked: ReadonlySet<t.SsoProviderId>,
): t.SsoProviderOption[] {
  return ssoButtonOrder(config).flatMap((id) => {
    if (!isSsoOffered(id, config, checked)) return [];
    const label = ssoButtonLabel(id, config);
    return [label ? { id, label } : { id }];
  });
}

/**
 * The failure an `error` of LibreChat's admin OAuth callback names. Any value
 * the panel does not know is `sso_failed`: the query is never shown as text.
 */
export function ssoCallbackError(error: string): t.AuthErrorCode {
  return SSO_CALLBACK_ERRORS.get(error) ?? 'sso_failed';
}

/**
 * The callback's query as TanStack parsed it: each value is JSON-parsed, so
 * `?code=1234` arrives as a number. A code that is not text is no code; an
 * error that is not text is one the panel does not know (`sso_failed`).
 */
export function parseSsoCallbackSearch(search: Record<string, unknown>): t.SsoCallbackSearch {
  return {
    code: typeof search.code === 'string' ? search.code : undefined,
    error: search.error === undefined ? undefined : String(search.error),
  };
}

/**
 * Completes an SSO callback: the failure LibreChat redirected with, else the
 * exchange of its one-time code, which signs the admin in and names the path
 * sign-in started from. A missing or malformed code, or an exchange that
 * throws, is `sso_exchange_failed`.
 */
export async function resolveSsoCallback(
  { code, error }: t.SsoCallbackSearch,
  exchange: t.SsoExchange,
): Promise<t.SsoExchangeResult> {
  if (error) return { error: true, code: ssoCallbackError(error) };
  if (!code || !EXCHANGE_CODE_PATTERN.test(code)) {
    return { error: true, code: 'sso_exchange_failed' };
  }
  try {
    return await exchange(code);
  } catch {
    return { error: true, code: 'sso_exchange_failed' };
  }
}
