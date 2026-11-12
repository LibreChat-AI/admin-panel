import type * as t from '@/types';

/** Token credits per US dollar (LibreChat's `CREDITS_PER_USD`: rates are USD per million tokens). */
export const CREDITS_PER_USD = 1_000_000;

/** Social sign-in providers the LibreChat sign-in page can show (`SocialLoginRender`), with display names. */
export const SOCIAL_LOGIN_PROVIDERS: Readonly<Record<string, string>> = {
  openid: 'com_config_registration_provider_openid',
  google: 'com_config_registration_provider_google',
  github: 'com_config_registration_provider_github',
  discord: 'com_config_registration_provider_discord',
  facebook: 'com_config_registration_provider_facebook',
  apple: 'com_config_registration_provider_apple',
  saml: 'com_config_registration_provider_saml',
};

/**
 * LibreChat's rate limiters with the `.env` fallbacks it uses when
 * librechat.yaml sets none (api/server/middleware/limiters). Agent events,
 * prompt resolution and email change requests are limited per user only.
 */
export const RATE_LIMITERS: readonly t.RateLimiterInfo[] = [
  {
    key: 'fileUploads',
    envPrefix: 'FILE_UPLOAD',
    defaults: { ipMax: 100, ipWindowInMinutes: 15, userMax: 50, userWindowInMinutes: 15 },
  },
  {
    key: 'conversationsImport',
    envPrefix: 'IMPORT',
    defaults: { ipMax: 100, ipWindowInMinutes: 15, userMax: 50, userWindowInMinutes: 15 },
  },
  {
    key: 'tts',
    envPrefix: 'TTS',
    defaults: { ipMax: 100, ipWindowInMinutes: 1, userMax: 50, userWindowInMinutes: 1 },
  },
  {
    key: 'stt',
    envPrefix: 'STT',
    defaults: { ipMax: 100, ipWindowInMinutes: 1, userMax: 50, userWindowInMinutes: 1 },
  },
  {
    key: 'agentEvents',
    envPrefix: 'AGENT_EVENT',
    defaults: { userMax: 40, userWindowInMinutes: 1 },
  },
  {
    key: 'promptResolve',
    envPrefix: 'PROMPT_RESOLVE',
    defaults: { userMax: 60, userWindowInMinutes: 1 },
  },
  {
    key: 'emailChange',
    envPrefix: 'EMAIL_CHANGE',
    defaults: { userMax: 3, userWindowInMinutes: 2 },
  },
  {
    key: 'emailChangeConfirm',
    envPrefix: 'EMAIL_CHANGE_CONFIRM',
    defaults: { ipMax: 20, ipWindowInMinutes: 2, userMax: 2, userWindowInMinutes: 2 },
  },
];

/** Allowed sign-up domains: a lowercase hostname (LibreChat compares the part after `@` exactly). */
export const EMAIL_DOMAIN_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
