import userEvent from '@testing-library/user-event';
import { ClickUIProvider } from '@clickhouse/click-ui';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  Outlet,
  createRoute,
  createRouter,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
} from '@tanstack/react-router';
import type * as t from '@/types';
import { Route as CallbackRoute } from '../auth/$provider/callback';
import { adminLogoutFn, oauthExchangeFn } from '@/server';
import i18n from '@/locales/i18n';

vi.mock('@/server', () => ({ oauthExchangeFn: vi.fn(), adminLogoutFn: vi.fn() }));

const CODE = 'a'.repeat(64);
const UNAVAILABLE = { error: true, code: 'session_unavailable' } as const;
const TestRoot = createRootRouteWithContext<t.RouterContext>()({
  component: () => (
    <ClickUIProvider theme="light">
      <Outlet />
    </ClickUIProvider>
  ),
});
Object.assign(CallbackRoute.options, {
  id: '/auth/$provider/callback',
  path: '/auth/$provider/callback',
  getParentRoute: () => TestRoot,
});
const HomeRoute = createRoute({
  getParentRoute: () => TestRoot,
  path: '/',
  component: () => <h1>Signed in</h1>,
});
const routeTree = TestRoot.addChildren([CallbackRoute, HomeRoute]);

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.mocked(oauthExchangeFn).mockReset().mockResolvedValue(UNAVAILABLE);
  vi.mocked(adminLogoutFn).mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe('SSO callback recovery', () => {
  it.each(['temporary failure', 'success'] as const)(
    'blocks both actions until the retry exchange finishes with %s',
    async (outcome) => {
      const user = userEvent.setup();
      let complete: (result: t.SsoExchangeResult) => void = () => undefined;
      const pending = new Promise<t.SsoExchangeResult>((resolve) => {
        complete = resolve;
      });
      vi.mocked(oauthExchangeFn).mockResolvedValueOnce(UNAVAILABLE).mockReturnValueOnce(pending);
      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: [`/auth/openid/callback?code=${CODE}`],
        }),
        context: { queryClient: new QueryClient() },
      });
      render(<RouterProvider router={router} />);
      const retry = await screen.findByRole('button', { name: i18n.t('com_ui_retry') });
      const logout = screen.getByRole('button', { name: i18n.t('com_ui_sign_out') });

      await user.click(retry);
      await waitFor(() => expect(oauthExchangeFn).toHaveBeenCalledTimes(2));

      expect(retry).toHaveAttribute('aria-busy', 'true');
      expect(retry).toHaveAttribute('aria-disabled', 'true');
      expect(logout).toBeDisabled();
      await user.click(retry);
      fireEvent.click(logout);
      expect(oauthExchangeFn).toHaveBeenCalledTimes(2);
      expect(adminLogoutFn).not.toHaveBeenCalled();
      expect(oauthExchangeFn).toHaveBeenLastCalledWith({
        data: { code: CODE, provider: 'openid' },
      });

      await act(async () => {
        complete(
          outcome === 'temporary failure'
            ? UNAVAILABLE
            : {
                error: false,
                user: { id: 'admin', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
                redirectTo: '/',
              },
        );
      });

      if (outcome === 'success') {
        expect(await screen.findByRole('heading', { name: 'Signed in' })).toBeVisible();
        expect(router.state.location.pathname).toBe('/');
      } else {
        await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
        expect(retry).not.toHaveAttribute('aria-disabled');
        expect(logout).toBeEnabled();
        expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('com_auth_session_unavailable'));
      }
      expect(oauthExchangeFn).toHaveBeenCalledTimes(2);
      expect(adminLogoutFn).not.toHaveBeenCalled();
    },
  );
});
