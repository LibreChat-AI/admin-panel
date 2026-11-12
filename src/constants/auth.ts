import type * as t from '@/types';

/**
 * LibreChat's code for a pre-auth request that strict tenant isolation refused
 * because it carried no tenant: the 403 body's `code` on sign-in and 2FA, and
 * the `error` its admin OAuth callbacks redirect to the panel with.
 */
export const TENANT_CONTEXT_REQUIRED_CODE = 'TENANT_CONTEXT_REQUIRED';

/**
 * LibreChat's 403 `code` on sign-in and 2FA for an account its identity
 * provider owns while 2FA is enforced: a password can never sign it in.
 */
export const TWO_FACTOR_FEDERATED_LOGIN_BLOCKED_CODE = 'TWO_FACTOR_FEDERATED_LOGIN_BLOCKED';

/** The phrase of each sign-in failure. */
export const AUTH_ERROR_KEYS: Readonly<Record<t.AuthErrorCode, string>> = {
  tenant_required: 'com_auth_error_tenant_required',
  not_admin: 'com_auth_error_not_admin',
  federated_login: 'com_auth_error_federated_login',
  invalid_credentials: 'com_auth_error_invalid_credentials',
  email_not_verified: 'com_auth_error_email_not_verified',
  rate_limited: 'com_auth_error_rate_limited',
  login_failed: 'com_auth_login_failed',
  unreachable: 'com_auth_unable_connect',
  totp_invalid: 'com_auth_2fa_invalid_code',
  totp_expired: 'com_auth_2fa_expired',
  session_invalid: 'com_auth_error_session_invalid',
  verification_failed: 'com_auth_error_verification_failed',
  sso_start_failed: 'com_auth_sso_redirect_failed',
  sso_auth_failed: 'com_auth_error_sso_auth_failed',
  sso_pkce_failed: 'com_auth_error_sso_pkce_failed',
  sso_failed: 'com_auth_error_sso_failed',
  sso_verifier_lost: 'com_auth_error_sso_verifier_lost',
  sso_code_invalid: 'com_auth_error_sso_code_invalid',
  sso_code_expired: 'com_auth_error_sso_code_expired',
  sso_exchange_failed: 'com_auth_sso_exchange_failed',
};

/**
 * The failure of each `error` LibreChat's admin OAuth routes redirect to the
 * panel's callback with (`api/server/routes/admin/auth.js`); any other value
 * reads as `sso_failed`.
 */
export const SSO_CALLBACK_ERRORS: ReadonlyMap<string, t.AuthErrorCode> = new Map([
  [TENANT_CONTEXT_REQUIRED_CODE, 'tenant_required'],
  ['auth_failed', 'sso_auth_failed'],
  ['pkce_store_failed', 'sso_pkce_failed'],
  ['pkce_retrieval_failed', 'sso_pkce_failed'],
]);

/** Failures of the 2FA step that send the admin back to the password step, where SSO is offered. */
export const TWO_FACTOR_RESTART_CODES: ReadonlySet<t.AuthErrorCode> = new Set([
  'totp_expired',
  'federated_login',
]);

/** The shape of the one-time code LibreChat's admin OAuth callback hands the panel. */
export const EXCHANGE_CODE_PATTERN = /^[a-f0-9]{64}$/;

/** The providers the panel offers, in the order of their buttons. */
export const SSO_PROVIDER_IDS = [
  'openid',
  'google',
  'saml',
] as const satisfies readonly t.SsoProviderId[];

/**
 * How each provider is offered, started and renewed. LibreChat starts every
 * one at `/api/admin/oauth/<id>` (`ssoStartPath`) and sends the admin back to
 * the panel's `/auth/<id>/callback`. GitHub, Discord, Facebook and Apple have
 * admin routes in LibreChat too, each one entry away.
 */
export const SSO_PROVIDERS: Readonly<Record<t.SsoProviderId, t.SsoProvider>> = {
  openid: {
    labelKey: 'com_auth_sso_sign_in',
    configLabel: 'openidLabel',
    availability: 'check',
    refreshable: true,
  },
  google: {
    labelKey: 'com_auth_sso_google',
    availability: 'googleLoginEnabled',
    refreshable: true,
  },
  saml: {
    labelKey: 'com_auth_sso_saml',
    configLabel: 'samlLabel',
    availability: 'samlLoginEnabled',
    refreshable: false,
  },
};
