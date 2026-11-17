import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { adminLogoutFn } from '@/server';
import { localizeEn } from '@/test/coverage';
import { SessionError } from '../SessionError';

const navigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate }),
}));
vi.mock('@/server', () => ({ adminLogoutFn: vi.fn() }));

beforeEach(() => {
  navigate.mockClear();
  vi.mocked(adminLogoutFn).mockReset();
});

describe('SessionError', () => {
  it.each([false, true])(
    'leaves the page title unchanged during embedded recovery (ended: %s)',
    (ended) => {
      const title = 'Configuration · LibreChat Admin Panel';
      document.title = title;
      const { unmount } = render(<SessionError embedded ended={ended} />);
      expect(document.title).toBe(title);
      unmount();
      expect(document.title).toBe(title);
    },
  );

  it('provides a page landmark and heading while limiting the alert to the message', () => {
    render(<SessionError />);

    const main = screen.getByRole('main');
    expect(main).toContainElement(
      screen.getByRole('heading', {
        level: 1,
        name: localizeEn('com_auth_session_unavailable_title'),
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(localizeEn('com_auth_session_unavailable'));
    expect(screen.getByRole('alert')).not.toContainElement(
      screen.getByRole('button', {
        name: localizeEn('com_ui_retry'),
      }),
    );
  });

  it.each(['retry', 'logout'] as const)(
    'keeps focus and blocks other actions while %s is running',
    async (action) => {
      const user = userEvent.setup();
      let fail: (error: Error) => void = () => undefined;
      const pending = new Promise<never>((_, reject) => {
        fail = reject;
      });
      const retry = vi.fn(() => pending);
      vi.mocked(adminLogoutFn).mockReturnValue(pending);
      render(<SessionError onRetry={retry} />);
      const retryButton = screen.getByRole('button', { name: localizeEn('com_ui_retry') });
      const logoutButton = screen.getByRole('button', { name: localizeEn('com_ui_sign_out') });
      const active = action === 'retry' ? retryButton : logoutButton;
      const other = action === 'retry' ? logoutButton : retryButton;

      await user.click(active);

      expect(active).toHaveFocus();
      expect(active).toBeEnabled();
      expect(active).toHaveAttribute('aria-busy', 'true');
      expect(active).toHaveAttribute('aria-disabled', 'true');
      expect(other).toBeDisabled();
      expect(other).not.toHaveAttribute('aria-busy');
      expect(screen.getByRole('status')).toHaveTextContent(
        localizeEn(action === 'retry' ? 'com_ui_loading' : 'com_ui_signing_out'),
      );
      await user.click(active);
      fireEvent.click(other);
      expect(retry).toHaveBeenCalledTimes(action === 'retry' ? 1 : 0);
      expect(adminLogoutFn).toHaveBeenCalledTimes(action === 'logout' ? 1 : 0);

      await act(async () => fail(new Error('Temporary failure')));

      expect(active).toHaveFocus();
      expect(active).not.toHaveAttribute('aria-busy');
      expect(active).not.toHaveAttribute('aria-disabled');
      expect(other).toBeEnabled();
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    },
  );

  it('retries the session check without signing out', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    render(<SessionError onRetry={retry} />);

    expect(screen.getByText(localizeEn('com_auth_session_unavailable'))).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: localizeEn('com_ui_retry') }));

    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(adminLogoutFn).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps both actions available when Retry fails again', async () => {
    const retry = vi.fn().mockRejectedValue(new Error('AUTH_SESSION_CHECK_UNAVAILABLE'));
    render(<SessionError onRetry={retry} />);

    fireEvent.click(screen.getByRole('button', { name: localizeEn('com_ui_retry') }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: localizeEn('com_ui_retry') })).toBeEnabled(),
    );
    expect(screen.getByText(localizeEn('com_auth_session_unavailable'))).toBeVisible();
    expect(screen.getByRole('button', { name: localizeEn('com_ui_sign_out') })).toBeEnabled();
    expect(adminLogoutFn).not.toHaveBeenCalled();
  });

  it('signs out through the existing logout operation', async () => {
    vi.mocked(adminLogoutFn).mockResolvedValue({ error: false, redirect: undefined });
    render(<SessionError />);

    fireEvent.click(screen.getByRole('button', { name: localizeEn('com_ui_sign_out') }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/login',
        search: { redirect: '/', session: 'ended' },
      }),
    );
    expect(adminLogoutFn).toHaveBeenCalledTimes(1);
  });

  it('follows the logout redirect returned by LibreChat', async () => {
    const originalUrl = window.location.href;
    const redirect = `${originalUrl.split('#')[0]}#signed-out`;
    vi.mocked(adminLogoutFn).mockResolvedValue({ error: false, redirect });
    render(<SessionError />);

    fireEvent.click(screen.getByRole('button', { name: localizeEn('com_ui_sign_out') }));

    await waitFor(() => expect(window.location.href).toBe(redirect));
    expect(navigate).not.toHaveBeenCalled();
    window.history.replaceState(null, '', originalUrl);
  });

  it.each(['reply', 'network'] as const)(
    'keeps Retry and Sign out available after a %s logout failure',
    async (failure) => {
      if (failure === 'reply')
        vi.mocked(adminLogoutFn).mockResolvedValue({ error: true, message: 'Logout failed' });
      else vi.mocked(adminLogoutFn).mockRejectedValue(new Error('fetch failed'));
      render(<SessionError />);

      fireEvent.click(screen.getByRole('button', { name: localizeEn('com_ui_sign_out') }));

      expect(await screen.findByText(localizeEn('com_auth_logout_failed'))).toBeVisible();
      expect(screen.getByRole('button', { name: localizeEn('com_ui_retry') })).toBeEnabled();
      expect(screen.getByRole('button', { name: localizeEn('com_ui_sign_out') })).toBeEnabled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );
});
