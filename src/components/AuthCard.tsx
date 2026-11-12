import { z } from 'zod';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { useRouter } from '@tanstack/react-router';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Alert, Title, Panel, Button, Separator, TextField, Container } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { AUTH_ERROR_KEYS, SSO_PROVIDERS, TWO_FACTOR_RESTART_CODES } from '@/constants';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from './InputOTP';
import { adminLoginFn, adminVerify2FAFn, ssoStartFn } from '@/server';
import { PasswordInput } from './PasswordInput';
import { toSafeRedirect } from '@/utils';
import { useLocalize } from '@/hooks';

const NO_SSO_PROVIDERS: readonly t.SsoProviderOption[] = [];

/**
 * The card's width comes from Panel's `fillWidth`, not `w-full`: click-ui's
 * `.panel` width rule sits in its `clickui` layer, after Tailwind's
 * `utilities`, so it outranks `w-full`.
 */
const AUTH_CARD_CLASS = 'auth-card max-w-md';

export function AuthCard({
  redirectTo = '/',
  providers = NO_SSO_PROVIDERS,
  ssoOnly = false,
}: t.AuthCardProps) {
  const router = useRouter();
  const localize = useLocalize();
  const [step, setStep] = useState<t.AuthStep>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [errors, setErrors] = useState<t.FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const autoRedirectProvider = ssoOnly && providers.length === 1 ? providers[0].id : undefined;
  const [ssoStarting, setSsoStarting] = useState<t.SsoProviderId | null>(
    autoRedirectProvider ?? null,
  );
  const [ssoFailed, setSsoFailed] = useState(false);
  const autoRedirectAttempted = useRef(false);

  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const showAutoRedirect =
    autoRedirectProvider !== undefined && ssoStarting === autoRedirectProvider && !ssoFailed;
  const showPasswordForm = !ssoOnly || providers.length === 0 || ssoFailed;

  useEffect(() => {
    const messages = [generalError, errors.email, errors.password].filter(Boolean);
    if (messages.length === 0) {
      setAnnouncement('');
      return;
    }
    setAnnouncement(messages.join('. '));
    const timeout = setTimeout(() => setAnnouncement(''), 4000);
    return () => clearTimeout(timeout);
  }, [generalError, errors.email, errors.password]);

  /** A sign-in that cannot reach its provider: the password form comes back, even SSO-only. */
  const failSso = useCallback((message: string) => {
    setSsoStarting(null);
    setSsoFailed(true);
    setGeneralError(message);
  }, []);

  /**
   * Sends the browser to the provider, with the page to return to kept in the
   * admin session. The button stays busy until the provider's page replaces
   * this one; only a start that fails gives it back.
   */
  const startSso = useCallback(
    async (provider: t.SsoProviderId) => {
      setSsoStarting(provider);
      try {
        const result = await ssoStartFn({ data: { provider, redirectTo } });
        if (result.error) {
          failSso(localize(AUTH_ERROR_KEYS[result.code]));
          return;
        }
        if (!result.authUrl) {
          failSso(localize('com_auth_sso_redirect_failed'));
          return;
        }
        window.location.href = result.authUrl;
      } catch {
        failSso(localize('com_auth_sso_redirect_failed'));
      }
    },
    [failSso, localize, redirectTo],
  );

  /** Back from the provider, the browser can restore this page as it left it, still starting SSO. */
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSsoStarting(null);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  useEffect(() => {
    if (!autoRedirectProvider || autoRedirectAttempted.current) return;
    autoRedirectAttempted.current = true;
    startSso(autoRedirectProvider);
  }, [autoRedirectProvider, startSso]);

  const emailSchema = useMemo(
    () => z.string().email(localize('com_auth_email_invalid')),
    [localize],
  );

  const handleLogin = async () => {
    if (isSubmitting) return;

    const newErrors: t.FieldErrors = {};

    if (!email.trim()) {
      newErrors.email = localize('com_auth_email_required');
    } else {
      const emailResult = emailSchema.safeParse(email);
      if (!emailResult.success) {
        newErrors.email = emailResult.error.issues[0].message;
      }
    }

    if (!password) {
      newErrors.password = localize('com_auth_password_required');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setGeneralError('');
      return;
    }

    setErrors({});
    setGeneralError('');
    setIsSubmitting(true);

    try {
      const result = await adminLoginFn({ data: { email, password } });

      if (result.error) {
        setGeneralError(localize(AUTH_ERROR_KEYS[result.code]));
        return;
      }

      if ('requires2FA' in result) {
        if (!result.tempToken) {
          setGeneralError(localize('com_auth_login_failed'));
          return;
        }
        setTempToken(result.tempToken);
        setTotpCode('');
        setGeneralError('');
        setStep('2fa');
        return;
      }

      setPassword('');
      await router.invalidate();
      router.navigate({ href: toSafeRedirect(redirectTo) });
    } catch (error) {
      console.error('Login error:', error);
      setGeneralError(localize('com_auth_unable_connect'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify2FA = async (codeOverride?: string) => {
    if (isSubmitting) return;

    const code = codeOverride ?? totpCode;
    if (!/^\d{6}$/.test(code)) {
      setGeneralError(localize('com_auth_2fa_invalid_code'));
      return;
    }

    setGeneralError('');
    setIsSubmitting(true);

    try {
      const result = await adminVerify2FAFn({ data: { tempToken, totpCode: code } });

      if (result.error) {
        setGeneralError(localize(AUTH_ERROR_KEYS[result.code]));
        setTotpCode('');
        if (TWO_FACTOR_RESTART_CODES.has(result.code)) {
          setStep('login');
          setTempToken('');
        }
        return;
      }

      setPassword('');
      setTotpCode('');
      setTempToken('');
      await router.invalidate();
      router.navigate({ href: toSafeRedirect(redirectTo) });
    } catch (error) {
      console.error('2FA verification error:', error);
      setGeneralError(localize('com_auth_unable_connect'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    setStep('login');
    setTempToken('');
    setTotpCode('');
    setGeneralError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  if (showAutoRedirect) {
    return (
      <Panel
        className={AUTH_CARD_CLASS}
        fillWidth
        padding="xl"
        radii="lg"
        hasBorder
        hasShadow
        color="default"
      >
        <Container orientation="vertical" gap="lg" alignItems="center">
          <Title type="h1">{localize('com_auth_title')}</Title>
          <p className="text-center text-sm text-(--cui-color-text-muted)">
            {localize('com_auth_sso_redirecting_auto')}
          </p>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-(--cui-color-stroke-default) border-t-(--cui-color-accent-info)" />
        </Container>
      </Panel>
    );
  }

  return (
    <Panel
      className={AUTH_CARD_CLASS}
      fillWidth
      padding="xl"
      radii="lg"
      hasBorder
      hasShadow
      color="default"
    >
      <Container orientation="vertical" gap="lg" alignItems="center">
        <Title type="h1">
          {step === '2fa' ? localize('com_auth_2fa_title') : localize('com_auth_title')}
        </Title>

        {generalError && <Alert type="banner" state="danger" text={generalError} />}

        {step === '2fa' ? (
          <>
            <p className="text-center text-sm text-(--cui-color-text-muted)">
              {localize('com_auth_2fa_prompt')}
            </p>
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={totpCode}
                onChange={(value) => setTotpCode(value)}
                onComplete={handleVerify2FA}
                pattern={REGEXP_ONLY_DIGITS}
                disabled={isSubmitting}
                aria-label={localize('com_auth_2fa_code_label')}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            {isSubmitting && (
              <p className="text-center text-sm text-(--cui-color-text-muted)">
                {localize('com_auth_2fa_verifying')}
              </p>
            )}
            <button
              type="button"
              onClick={handleBack}
              disabled={isSubmitting}
              className="text-sm text-(--cui-color-accent-info) transition-colors hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              {localize('com_auth_2fa_back')}
            </button>
          </>
        ) : (
          <>
            {showPasswordForm && (
              <>
                <TextField
                  label={localize('com_auth_email_label')}
                  placeholder={localize('com_auth_email_placeholder')}
                  value={email}
                  onChange={(value) => {
                    setEmail(value);
                    if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  onKeyDown={handleKeyDown}
                  error={errors.email}
                />

                <PasswordInput
                  label={localize('com_auth_password_label')}
                  placeholder={localize('com_auth_password_placeholder')}
                  value={password}
                  onChange={(value) => {
                    setPassword(value);
                    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  onKeyDown={handleKeyDown}
                  error={errors.password}
                />

                <Button
                  htmlType="button"
                  label={
                    isSubmitting ? localize('com_auth_signing_in') : localize('com_auth_sign_in')
                  }
                  type="primary"
                  onClick={handleLogin}
                  disabled={isSubmitting}
                />

                {providers.length > 0 && <Separator size="sm" />}
              </>
            )}

            {providers.length > 0 && (
              <Container orientation="vertical" gap="sm" fillWidth>
                {providers.map(({ id, label }) => (
                  <Button
                    key={id}
                    htmlType="button"
                    label={
                      ssoStarting === id
                        ? localize('com_auth_sso_redirecting')
                        : (label ?? localize(SSO_PROVIDERS[id].labelKey))
                    }
                    type="secondary"
                    onClick={() => startSso(id)}
                    loading={ssoStarting === id}
                    disabled={ssoStarting !== null}
                    fillWidth
                  />
                ))}
              </Container>
            )}
          </>
        )}
      </Container>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </Panel>
  );
}
