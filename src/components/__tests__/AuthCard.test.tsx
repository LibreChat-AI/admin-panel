import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as t from '@/types';
import { adminLoginFn, adminVerify2FAFn, ssoStartFn } from '@/server';
import { localizeEn } from '@/test/coverage';
import { AuthCard } from '../AuthCard';

/** jsdom has no layout: the 2FA code input measures itself and probes what lies under it. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;
document.elementFromPoint ??= () => null;

const navigate = vi.fn();
const invalidate = vi.fn(async () => undefined);

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate, invalidate }),
}));

vi.mock('@/server', () => ({
  adminLoginFn: vi.fn(),
  adminVerify2FAFn: vi.fn(),
  ssoStartFn: vi.fn(),
}));

const loginFn = vi.mocked(adminLoginFn);
const verify2FAFn = vi.mocked(adminVerify2FAFn);
const startFn = vi.mocked(ssoStartFn);

const OPENID: t.SsoProviderOption[] = [{ id: 'openid' }];
const OPENID_AND_GOOGLE: t.SsoProviderOption[] = [
  { id: 'openid', label: 'Sign in with Okta' },
  { id: 'google' },
];

function renderCard(props: t.AuthCardProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthCard {...props} />
    </QueryClientProvider>,
  );
}

function signIn() {
  fireEvent.change(screen.getByPlaceholderText(localizeEn('com_auth_email_placeholder')), {
    target: { value: 'admin@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText(localizeEn('com_auth_password_placeholder')), {
    target: { value: 'Password123!' },
  });
  fireEvent.click(screen.getByRole('button', { name: localizeEn('com_auth_sign_in') }));
}

beforeEach(() => {
  loginFn.mockReset();
  verify2FAFn.mockReset();
  startFn.mockReset();
  navigate.mockReset();
  window.location.hash = '';
});

/** Turns of the event loop React's scheduler (on `setImmediate`) may still need for work queued before the test ends. */
const SCHEDULER_TURNS = 3;

/**
 * Lets real time pass as it does once a file ends, with jsdom's window gone: a timer left behind
 * throws as it fires. Work React already scheduled runs first, with the window still there, so a
 * slow runner doesn't fail the test on React's own bookkeeping.
 */
async function idleWithoutWindow(ms: number): Promise<void> {
  for (let turn = 0; turn < SCHEDULER_TURNS; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  vi.stubGlobal('window', undefined);
  try {
    await new Promise((resolve) => setTimeout(resolve, ms));
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('AuthCard sign-in failures', () => {
  it('tells an admin refused for a missing tenant to use their organization address', async () => {
    loginFn.mockResolvedValue({ error: true, code: 'tenant_required' });

    renderCard();
    signIn();

    expect(await screen.findByText(localizeEn('com_auth_error_tenant_required'))).toBeVisible();
    expect(screen.queryByText(localizeEn('com_auth_error_not_admin'))).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('words a missing admin capability apart from the tenant refusal', async () => {
    loginFn.mockResolvedValue({ error: true, code: 'not_admin' });

    renderCard();
    signIn();

    expect(await screen.findByText(localizeEn('com_auth_error_not_admin'))).toBeVisible();
  });

  it('tells an account its identity provider owns that a password cannot sign it in', async () => {
    loginFn.mockResolvedValue({ error: true, code: 'federated_login' });

    renderCard({ providers: OPENID });
    signIn();

    expect(await screen.findByText(localizeEn('com_auth_error_federated_login'))).toBeVisible();
    expect(screen.queryByText(localizeEn('com_auth_error_not_admin'))).toBeNull();
  });

  it('returns to the password step when the 2FA temp token expired', async () => {
    loginFn.mockResolvedValue({ error: false, requires2FA: true, tempToken: 'temp-token' });
    verify2FAFn.mockResolvedValue({ error: true, code: 'totp_expired' });

    renderCard();
    signIn();
    const otp = await screen.findByLabelText(localizeEn('com_auth_2fa_code_label'));
    fireEvent.change(otp, { target: { value: '123456' } });

    expect(await screen.findByText(localizeEn('com_auth_2fa_expired'))).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: localizeEn('com_auth_sign_in') })).toBeVisible(),
    );
    expect(verify2FAFn).toHaveBeenCalledWith({
      data: { tempToken: 'temp-token', totpCode: '123456' },
    });
  });

  it('sends an account its identity provider owns back to the password step, where SSO is', async () => {
    loginFn.mockResolvedValue({ error: false, requires2FA: true, tempToken: 'temp-token' });
    verify2FAFn.mockResolvedValue({ error: true, code: 'federated_login' });

    renderCard({ providers: OPENID });
    signIn();
    const otp = await screen.findByLabelText(localizeEn('com_auth_2fa_code_label'));
    fireEvent.change(otp, { target: { value: '123456' } });

    expect(await screen.findByText(localizeEn('com_auth_error_federated_login'))).toBeVisible();
    expect(screen.queryByLabelText(localizeEn('com_auth_2fa_code_label'))).toBeNull();
    expect(screen.getByRole('button', { name: localizeEn('com_auth_sso_sign_in') })).toBeVisible();
  });

  it('words a tenant refusal on the 2FA step and stays on it', async () => {
    loginFn.mockResolvedValue({ error: false, requires2FA: true, tempToken: 'temp-token' });
    verify2FAFn.mockResolvedValue({ error: true, code: 'tenant_required' });

    renderCard();
    signIn();
    const otp = await screen.findByLabelText(localizeEn('com_auth_2fa_code_label'));
    fireEvent.change(otp, { target: { value: '123456' } });

    expect(await screen.findByText(localizeEn('com_auth_error_tenant_required'))).toBeVisible();
    expect(screen.getByLabelText(localizeEn('com_auth_2fa_code_label'))).toBeVisible();
  });

  /** input-otp re-syncs the selection 0, 10 and 50 ms after each change of the code and clears those timers on unmount. */
  it('leaves no timer of the 2FA step to fire once jsdom is torn down', async () => {
    loginFn.mockResolvedValue({ error: false, requires2FA: true, tempToken: 'temp-token' });
    verify2FAFn.mockResolvedValue({ error: true, code: 'totp_invalid' });

    renderCard();
    signIn();
    const otp = await screen.findByLabelText(localizeEn('com_auth_2fa_code_label'));
    fireEvent.change(otp, { target: { value: '123456' } });
    expect(await screen.findByText(localizeEn('com_auth_2fa_invalid_code'))).toBeVisible();
    cleanup();

    await idleWithoutWindow(100);
  });

  it('words a failed SSO start', async () => {
    startFn.mockResolvedValue({ error: true, code: 'sso_start_failed' });

    renderCard({ providers: OPENID });
    fireEvent.click(screen.getByRole('button', { name: localizeEn('com_auth_sso_sign_in') }));

    expect(await screen.findByText(localizeEn('com_auth_sso_redirect_failed'))).toBeVisible();
  });
});

/** The password form's email field, if the card shows the form. */
function emailField() {
  return screen.queryByPlaceholderText(localizeEn('com_auth_email_placeholder'));
}

describe('AuthCard SSO providers', () => {
  it('offers one button per provider, in order, named as the deployer named them', () => {
    renderCard({ providers: OPENID_AND_GOOGLE });

    const names = screen.getAllByRole('button').map((button) => button.textContent);
    expect(names).toEqual([
      localizeEn('com_auth_sign_in'),
      'Sign in with Okta',
      localizeEn('com_auth_sso_google'),
    ]);
  });

  it('starts the provider clicked, carrying the page sign-in started from', async () => {
    startFn.mockResolvedValue({ error: false, authUrl: '#google-consent' });

    renderCard({ providers: OPENID_AND_GOOGLE, redirectTo: '/grants?tab=audit' });
    fireEvent.click(screen.getByRole('button', { name: localizeEn('com_auth_sso_google') }));

    await waitFor(() => expect(window.location.hash).toBe('#google-consent'));
    expect(startFn).toHaveBeenCalledWith({
      data: { provider: 'google', redirectTo: '/grants?tab=audit' },
    });
  });

  it('sends an SSO-only page with one provider straight to it, with the page to return to', async () => {
    startFn.mockResolvedValue({ error: false, authUrl: '#saml-idp' });

    renderCard({ providers: [{ id: 'saml' }], ssoOnly: true, redirectTo: '/access' });

    expect(screen.getByText(localizeEn('com_auth_sso_redirecting_auto'))).toBeVisible();
    await waitFor(() => expect(window.location.hash).toBe('#saml-idp'));
    expect(startFn).toHaveBeenCalledTimes(1);
    expect(startFn).toHaveBeenCalledWith({ data: { provider: 'saml', redirectTo: '/access' } });
  });

  it('lets an SSO-only page with several providers choose, with no password form', () => {
    renderCard({ providers: OPENID_AND_GOOGLE, ssoOnly: true });

    expect(startFn).not.toHaveBeenCalled();
    expect(emailField()).toBeNull();
    expect(screen.queryByRole('button', { name: localizeEn('com_auth_sign_in') })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in with Okta' })).toBeVisible();
    expect(screen.getByRole('button', { name: localizeEn('com_auth_sso_google') })).toBeVisible();
  });

  it('keeps the password form of an SSO-only page no provider resolved for', () => {
    renderCard({ providers: [], ssoOnly: true });

    expect(startFn).not.toHaveBeenCalled();
    expect(emailField()).toBeVisible();
  });

  it('brings the password form back when the automatic redirect fails', async () => {
    startFn.mockResolvedValue({ error: true, code: 'sso_start_failed' });

    renderCard({ providers: OPENID, ssoOnly: true });

    expect(await screen.findByText(localizeEn('com_auth_sso_redirect_failed'))).toBeVisible();
    expect(emailField()).toBeVisible();
  });

  it('brings the password form of an SSO-only page back when a provider cannot start', async () => {
    startFn.mockRejectedValue(new Error('network'));

    renderCard({ providers: OPENID_AND_GOOGLE, ssoOnly: true });
    fireEvent.click(screen.getByRole('button', { name: localizeEn('com_auth_sso_google') }));

    expect(await screen.findByText(localizeEn('com_auth_sso_redirect_failed'))).toBeVisible();
    expect(emailField()).toBeVisible();
  });
});

/** A start the server has not answered yet. */
function pendingStart() {
  startFn.mockReturnValue(new Promise(() => {}));
}

function providerButton(name: string) {
  return screen.getByRole('button', { name });
}

/** Back from the provider: the browser shows this page again, restored from its back-forward cache when `persisted`. */
function showPageAgain(persisted: boolean) {
  fireEvent(window, new PageTransitionEvent('pageshow', { persisted }));
}

function expectBusy(button: HTMLElement) {
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button).toBeDisabled();
}

function expectIdle(button: HTMLElement) {
  expect(button).not.toHaveAttribute('aria-busy');
  expect(button).toBeEnabled();
}

describe('AuthCard SSO busy state', () => {
  const REDIRECTING = localizeEn('com_auth_sso_redirecting');
  const GOOGLE = localizeEn('com_auth_sso_google');

  it('marks the provider clicked busy while its start is pending, and holds the others', async () => {
    pendingStart();

    renderCard({ providers: OPENID_AND_GOOGLE });
    fireEvent.click(providerButton(GOOGLE));

    expectBusy(await screen.findByRole('button', { name: REDIRECTING }));
    const okta = providerButton('Sign in with Okta');
    expect(okta).toBeDisabled();
    expect(okta).not.toHaveAttribute('aria-busy');
  });

  it('stays busy once the browser is sent to the provider', async () => {
    startFn.mockResolvedValue({ error: false, authUrl: '#google-consent' });

    renderCard({ providers: OPENID_AND_GOOGLE });
    fireEvent.click(providerButton(GOOGLE));

    await waitFor(() => expect(window.location.hash).toBe('#google-consent'));
    expectBusy(providerButton(REDIRECTING));
    expect(providerButton('Sign in with Okta')).toBeDisabled();
  });

  it('gives the button back when the start fails', async () => {
    startFn.mockResolvedValue({ error: true, code: 'sso_start_failed' });

    renderCard({ providers: OPENID_AND_GOOGLE });
    fireEvent.click(providerButton(GOOGLE));

    expect(await screen.findByText(localizeEn('com_auth_sso_redirect_failed'))).toBeVisible();
    expectIdle(providerButton(GOOGLE));
    expectIdle(providerButton('Sign in with Okta'));
  });

  it('gives the button back when the start cannot reach the server', async () => {
    startFn.mockRejectedValue(new Error('network'));

    renderCard({ providers: OPENID_AND_GOOGLE });
    fireEvent.click(providerButton(GOOGLE));

    expect(await screen.findByText(localizeEn('com_auth_sso_redirect_failed'))).toBeVisible();
    expectIdle(providerButton(GOOGLE));
  });

  it('words a start that came back without a provider URL instead of reloading the page', async () => {
    startFn.mockResolvedValue({ error: false, authUrl: '' });

    renderCard({ providers: OPENID_AND_GOOGLE, ssoOnly: true });
    expect(emailField()).toBeNull();
    fireEvent.click(providerButton(GOOGLE));

    expect(await screen.findByText(localizeEn('com_auth_sso_redirect_failed'))).toBeVisible();
    expectIdle(providerButton(GOOGLE));
    expect(emailField()).toBeVisible();
  });

  it('gives the button back when the browser restores the page from its back-forward cache', async () => {
    startFn.mockResolvedValue({ error: false, authUrl: '#google-consent' });

    renderCard({ providers: OPENID_AND_GOOGLE });
    fireEvent.click(providerButton(GOOGLE));
    await waitFor(() => expect(window.location.hash).toBe('#google-consent'));

    showPageAgain(false);
    expectBusy(providerButton(REDIRECTING));

    showPageAgain(true);
    expectIdle(providerButton(GOOGLE));
    expectIdle(providerButton('Sign in with Okta'));
    expect(screen.queryByText(localizeEn('com_auth_sso_redirect_failed'))).toBeNull();
  });

  it('opens an SSO-only page on the redirect card, before its provider has been asked', () => {
    pendingStart();

    const firstRender = renderToStaticMarkup(<AuthCard providers={[{ id: 'saml' }]} ssoOnly />);

    expect(firstRender).toContain(localizeEn('com_auth_sso_redirecting_auto'));
    expect(firstRender).not.toContain('<button');
    expect(startFn).not.toHaveBeenCalled();
  });

  it('keeps redirecting an SSO-only page once sent to its provider', async () => {
    startFn.mockResolvedValue({ error: false, authUrl: '#saml-idp' });

    renderCard({ providers: [{ id: 'saml' }], ssoOnly: true });

    await waitFor(() => expect(window.location.hash).toBe('#saml-idp'));
    expect(screen.getByText(localizeEn('com_auth_sso_redirecting_auto'))).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers the provider of an SSO-only page restored from the back-forward cache, without redirecting again', async () => {
    startFn.mockResolvedValue({ error: false, authUrl: '#saml-idp' });

    renderCard({ providers: [{ id: 'saml' }], ssoOnly: true });
    await waitFor(() => expect(window.location.hash).toBe('#saml-idp'));

    showPageAgain(true);

    expect(screen.queryByText(localizeEn('com_auth_sso_redirecting_auto'))).toBeNull();
    expectIdle(providerButton(localizeEn('com_auth_sso_saml')));
    expect(emailField()).toBeNull();
    expect(startFn).toHaveBeenCalledTimes(1);
  });
});

/** The card's Panel: the sign-in form, or the SSO-only redirect. */
function authCard() {
  const card = document.querySelector<HTMLElement>('.auth-card');
  if (!card) throw new Error('no .auth-card on the page');
  return card;
}

describe('AuthCard width', () => {
  it('fills the sign-in page up to max-w-md', () => {
    renderCard({ providers: OPENID });

    expect(authCard().style.getPropertyValue('--panel-width')).toBe('100%');
    expect(authCard()).toHaveClass('max-w-md');
  });

  it('fills the page of an SSO-only redirect up to max-w-md', () => {
    pendingStart();

    renderCard({ providers: OPENID, ssoOnly: true });

    expect(screen.getByText(localizeEn('com_auth_sso_redirecting_auto'))).toBeVisible();
    expect(authCard().style.getPropertyValue('--panel-width')).toBe('100%');
    expect(authCard()).toHaveClass('max-w-md');
  });
});
