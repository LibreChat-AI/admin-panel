import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { localizeEn } from '@/test/coverage';
import { ssoCallbackError } from '@/utils';
import { SsoError } from '../SsoError';

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

describe('SsoError', () => {
  it.each([
    ['TENANT_CONTEXT_REQUIRED', 'com_auth_error_tenant_required'],
    ['auth_failed', 'com_auth_error_sso_auth_failed'],
    ['pkce_store_failed', 'com_auth_error_sso_pkce_failed'],
    ['pkce_retrieval_failed', 'com_auth_error_sso_pkce_failed'],
  ])('words the %s callback error as the panel phrase %s', (error, key) => {
    render(<SsoError code={ssoCallbackError(error)} />);

    expect(screen.getByText(localizeEn(key))).toBeVisible();
    expect(
      screen.getByRole('link', { name: localizeEn('com_auth_sso_back_to_login') }),
    ).toBeVisible();
  });

  it('names the browser tab after the page', () => {
    document.title = 'LibreChat Admin Panel';
    render(<SsoError code={ssoCallbackError('auth_failed')} />);

    expect(document.title).toBe(
      `${localizeEn('com_auth_sso_error_title')} · ${localizeEn('com_app_name')}`,
    );
    expect(document.title).toBe('Authentication failed · LibreChat Admin Panel');
  });

  it('shows the generic phrase for an unknown error and none of its text', () => {
    const { container } = render(
      <SsoError code={ssoCallbackError('<img src=x onerror=alert(1)>Call +1 555 0100')} />,
    );

    expect(screen.getByText(localizeEn('com_auth_error_sso_failed'))).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toContain('555');
  });
});
