import type { TStartupConfig } from 'librechat-data-provider';
import type { SerializableUser } from './server';
import type { ApiErrorBody } from './changes';

export type FieldErrors = {
  email?: string;
  password?: string;
};

export type AuthStep = 'login' | '2fa';

export interface AuthCardProps {
  redirectTo?: string;
  /** The providers LibreChat offers, in the order of their buttons. */
  providers?: readonly SsoProviderOption[];
  /** `ADMIN_SSO_ONLY`: no password form, and straight to the provider when there is one. */
  ssoOnly?: boolean;
}

/** A provider of LibreChat's admin OAuth routes the panel signs admins in through. */
export type SsoProviderId = 'openid' | 'google' | 'saml';

/** The `GET /api/config` flags that report a provider configured. */
export type SsoConfigFlag = 'googleLoginEnabled' | 'samlLoginEnabled';

/** The `GET /api/config` fields with a deployer's own name for a provider's button. */
export type SsoConfigLabel = 'openidLabel' | 'samlLabel';

/**
 * How the panel learns LibreChat offers a provider: `check` asks the
 * provider's `/api/admin/oauth/<id>/check` route, which answers only once its
 * client initialised; a flag reads `GET /api/config`.
 */
export type SsoAvailability = 'check' | SsoConfigFlag;

/** A provider of the registry (`SSO_PROVIDERS`). */
export interface SsoProvider {
  /** The phrase of its button when LibreChat names none. */
  labelKey: string;
  /** Where `GET /api/config` names its button. */
  configLabel?: SsoConfigLabel;
  availability: SsoAvailability;
  /** Whether `POST /api/admin/oauth/refresh` renews its sessions. */
  refreshable: boolean;
}

/** The fields of LibreChat's `GET /api/config` that decide which providers the sign-in page offers. */
export type SsoStartupConfig = Partial<
  Pick<TStartupConfig, 'socialLoginEnabled' | 'socialLogins' | SsoConfigFlag | SsoConfigLabel>
>;

/** A provider the sign-in page offers, with the deployer's name for its button when LibreChat sent one. */
export interface SsoProviderOption {
  id: SsoProviderId;
  label?: string;
}

/** What `ssoProvidersFn` returns. */
export interface SsoProviders {
  providers: SsoProviderOption[];
  /** `ADMIN_SSO_ONLY`, while at least one provider is offered. */
  ssoOnly: boolean;
}

/**
 * Why a sign-in step failed. Server functions return it and the page words it
 * (`AUTH_ERROR_KEYS`), so no server-side English reaches the sign-in screens.
 */
export type AuthErrorCode =
  | 'tenant_required'
  | 'not_admin'
  | 'federated_login'
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'rate_limited'
  | 'login_failed'
  | 'unreachable'
  | 'totp_invalid'
  | 'totp_expired'
  | 'session_invalid'
  | 'verification_failed'
  | 'sso_start_failed'
  | 'sso_auth_failed'
  | 'sso_pkce_failed'
  | 'sso_failed'
  | 'sso_verifier_lost'
  | 'sso_code_invalid'
  | 'sso_code_expired'
  | 'sso_exchange_failed';

/** A failed sign-in step, as a server function returns it. */
export interface AuthFailure {
  error: true;
  code: AuthErrorCode;
}

/** An error reply of LibreChat's auth routes: `code` (pre-auth guards, capabilities) or `error_code` (admin OAuth). */
export interface AuthErrorBody extends ApiErrorBody {
  error_code?: string;
}

/** What LibreChat's admin OAuth routes put on the panel's callback URL: an exchange code, or an error. */
export interface SsoCallbackSearch {
  code?: string;
  error?: string;
}

/** A completed sign-in step: the admin the session now holds. */
export interface AuthSuccess {
  error: false;
  user: SerializableUser;
}

/** A password sign-in that needs the second factor, with the token `adminVerify2FAFn` takes. */
export interface AuthTwoFactorPending {
  error: false;
  requires2FA: true;
  tempToken?: string;
}

/** SSO started: where the browser goes next (LibreChat's admin OAuth route of the provider). */
export interface SsoStart {
  error: false;
  authUrl: string;
}

/** What `ssoStartFn` returns. */
export type SsoStartResult = AuthFailure | SsoStart;

/** An SSO sign-in the exchange completed, and the in-app path it started from. */
export interface SsoSignedIn extends AuthSuccess {
  redirectTo: string;
}

/** What `oauthExchangeFn` returns. */
export type SsoExchangeResult = AuthFailure | SsoSignedIn;

/** What `adminVerify2FAFn` returns. */
export type AuthResult = AuthFailure | AuthSuccess;

/** What `adminLoginFn` returns. */
export type AdminLoginResult = AuthResult | AuthTwoFactorPending;

/** Trades the callback's one-time code for the admin's session (`oauthExchangeFn`). */
export type SsoExchange = (code: string) => Promise<SsoExchangeResult>;

export interface SsoErrorProps {
  code: AuthErrorCode;
}
