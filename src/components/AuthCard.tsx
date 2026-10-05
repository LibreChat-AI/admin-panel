import { z } from 'zod';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Alert, Title, Panel, Button, Separator, TextField, Container } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { adminLoginFn, adminVerify2FAFn, openIdCheckOptions, openidLoginFn } from '@/server';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from './InputOTP';
import { PasswordInput } from './PasswordInput';
import { useLocalize } from '@/hooks';

export function AuthCard({
  redirectTo = '/',
  autoRedirectSso = false,
  ssoAvailable: ssoAvailableProp,
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
  const [ssoLoading, setSsoLoading] = useState(false);
  const [autoRedirectFailed, setAutoRedirectFailed] = useState(false);
  const autoRedirectAttempted = useRef(false);

  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const { data: openIdData } = useQuery({
    ...openIdCheckOptions,
    enabled: ssoAvailableProp === undefined,
  });
  const ssoAvailable = ssoAvailableProp ?? openIdData?.available ?? false;

  const showAutoRedirect = autoRedirectSso && !autoRedirectFailed;

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

  useEffect(() => {
    if (!autoRedirectSso || autoRedirectAttempted.current) return;
    autoRedirectAttempted.current = true;

    setSsoLoading(true);
    openidLoginFn()
      .then((result) => {
        if (result.error || !result.authUrl) {
          setAutoRedirectFailed(true);
          setGeneralError(result.message || localize('com_auth_sso_redirect_failed'));
          return;
        }
        const authUrl = new URL(result.authUrl);
        if (redirectTo && redirectTo !== '/') {
          authUrl.searchParams.set('redirectTo', redirectTo);
        }
        window.location.href = authUrl.toString();
      })
      .catch(() => {
        setAutoRedirectFailed(true);
        setGeneralError(localize('com_auth_sso_redirect_failed'));
      })
      .finally(() => setSsoLoading(false));
  }, [autoRedirectSso, localize, redirectTo]);

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
        setGeneralError(result.message || localize('com_auth_login_failed'));
        return;
      }

      if (result.requires2FA) {
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
      router.navigate({ to: redirectTo });
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
        if (result.expired) {
          setGeneralError(localize('com_auth_2fa_expired'));
          setStep('login');
          setTempToken('');
          setTotpCode('');
          return;
        }
        setGeneralError(result.message || localize('com_auth_2fa_invalid_code'));
        setTotpCode('');
        return;
      }

      setPassword('');
      setTotpCode('');
      setTempToken('');
      await router.invalidate();
      router.navigate({ to: redirectTo });
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

  const handleSsoLogin = async () => {
    if (ssoLoading) return;
    setSsoLoading(true);
    try {
      const result = await openidLoginFn();
      if (result.error) {
        setGeneralError(result.message || localize('com_auth_login_failed'));
        return;
      }
      if (result.authUrl) {
        window.location.href = result.authUrl;
      }
    } catch {
      setGeneralError(localize('com_auth_unable_connect'));
    } finally {
      setSsoLoading(false);
    }
  };

  if (showAutoRedirect) {
    return (
      <Panel
        className="auth-card w-full max-w-md"
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
      className="auth-card w-full max-w-md"
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
              label={isSubmitting ? localize('com_auth_signing_in') : localize('com_auth_sign_in')}
              type="primary"
              onClick={handleLogin}
              disabled={isSubmitting}
            />

            {ssoAvailable && (
              <>
                <Separator size="sm" />
                <Button
                  htmlType="button"
                  label={
                    ssoLoading
                      ? localize('com_auth_sso_redirecting')
                      : localize('com_auth_sso_sign_in')
                  }
                  type="secondary"
                  onClick={handleSsoLogin}
                  disabled={ssoLoading}
                />
              </>
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
