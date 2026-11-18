import { useEffect, useState } from 'react';
import { ClickUIProvider } from '@clickhouse/click-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import {
  Outlet,
  createRouter,
  createRoute,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
} from '@tanstack/react-router';
import type * as t from '@/types';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Route as ConfigRoute } from '../_app/configuration/index';
import { holdSessionRedirects, hasSessionRedirectHold } from '@/utils';
import { useNavigationGuard } from '@/hooks';
import { SystemCapabilities } from '@/constants';
import { Route as LoginRoute } from '../login';
import { Route as AppRoute } from '../_app';

const server = vi.hoisted(() => ({
  verify: vi.fn(),
  capabilities: vi.fn(),
  schema: vi.fn(),
  base: vi.fn(),
  never: () => new Promise<never>(() => undefined),
}));
vi.mock('@/server', () => ({
  verifyAdminTokenFn: server.verify,
  getEffectiveCapabilitiesFn: server.capabilities,
  adminLogoutFn: vi.fn(),
  ssoProvidersFn: vi.fn(async () => ({ providers: [], ssoOnly: false })),
  configContractOptions: { queryKey: ['configContract'], queryFn: server.never, retry: false },
  configSchemaTreeOptions: { queryKey: ['configSchemaTree'], queryFn: server.schema },
  baseConfigOptions: { queryKey: ['baseConfig'], queryFn: server.base },
}));

const USER = { id: 'u1', email: 'viewer@test.local', name: 'Viewer', role: 'USER' };
const notified = vi.fn();
let unmounts = 0;

/** Local state makes any route-driven loss of unsaved work visible. */
function DraftProbe() {
  const [draft, setDraft] = useState('unsaved local draft');
  const guard = useNavigationGuard({
    isDirty: true,
    discardEdits: () => undefined,
    openReview: () => undefined,
    reviewOpen: false,
    saving: false,
    paused: false,
    describeScope: () => '',
  });
  useEffect(() => {
    const release = holdSessionRedirects(notified);
    return () => {
      release();
      unmounts++;
    };
  }, []);
  const { user, tenantId } = AppRoute.useRouteContext();
  return (
    <>
      <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <span data-testid="guard">{String(guard.open)}</span>
      <span data-testid="identity">{`${user.id}:${tenantId}`}</span>
      <button onClick={guard.onCancel}>Cancel navigation</button>
    </>
  );
}

const Root = createRootRouteWithContext<t.RouterContext>()({
  component: () => (
    <ThemeProvider>
      <ClickUIProvider theme="light"><Outlet /></ClickUIProvider>
    </ThemeProvider>
  ),
});
Object.assign(AppRoute.options, { id: '/_app', getParentRoute: () => Root });
Object.assign(LoginRoute.options, { id: '/login', path: '/login', getParentRoute: () => Root });
Object.assign(ConfigRoute.options, {
  id: '/configuration/',
  path: '/configuration/',
  getParentRoute: () => AppRoute,
  component: DraftProbe,
});
const HelpRoute = createRoute({ getParentRoute: () => AppRoute, path: '/help' });
const routeTree = Root.addChildren([AppRoute.addChildren([ConfigRoute, HelpRoute]), LoginRoute]);

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal('scrollTo', () => undefined);
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => cleanup());

function setup(initialFailure?: t.SessionErrorCode) {
  unmounts = 0;
  notified.mockClear();
  server.verify.mockReset().mockResolvedValue(
    initialFailure ? { valid: false, error: initialFailure } : { valid: true, user: USER },
  );
  server.capabilities.mockReset().mockResolvedValue({
    capabilities: [SystemCapabilities.ACCESS_ADMIN, SystemCapabilities.READ_CONFIGS],
  });
  server.schema.mockReset().mockResolvedValue([]);
  server.base.mockReset().mockResolvedValue({});
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/configuration?tab=first'] }),
    context: { queryClient },
  });
  render(
    <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>,
  );
  return { router, queryClient };
}

async function ready() {
  const state = setup();
  await screen.findByRole('textbox', { name: 'draft' });
  await waitFor(() => expect(hasSessionRedirectHold()).toBe(true));
  return state;
}

function expectDraft() {
  expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue('unsaved local draft');
  expect(screen.getByTestId('identity')).toHaveTextContent('u1:null');
  expect(unmounts).toBe(0);
}

describe('configuration search navigation with a held draft', () => {
  it('changes tabs without replacing the draft or refetching its baseline', async () => {
    const { router } = await ready();
    const initialBaseCalls = server.base.mock.calls.length;
    await act(() => router.navigate({ to: '/configuration', search: { tab: 'second' } }));
    expect(router.state.location.search.tab).toBe('second');
    expectDraft();
    expect(notified).not.toHaveBeenCalled();
    expect(server.base).toHaveBeenCalledTimes(initialBaseCalls);
    expect(server.capabilities).toHaveBeenCalledTimes(1);
  });

  it('still blocks ordinary path departure', async () => {
    const { router } = await ready();
    void router.navigate({ to: '/login', search: { redirect: '/' } });
    await waitFor(() => expect(screen.getByTestId('guard')).toHaveTextContent('true'));
    expect(router.state.location.pathname).toBe('/configuration');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel navigation' }));
    expectDraft();
  });

  it.each(['AUTH_SESSION_CHECK_UNAVAILABLE', 'OPENID_SESSION_ENDED'] as const)(
    'keeps the draft and reports %s when verification fails',
    async (error) => {
      const { router } = await ready();
      server.verify.mockResolvedValue({ valid: false, error });
      await act(() => router.navigate({ to: '/configuration', search: { tab: 'second' } }));
      expect(router.state.location.pathname).toBe('/configuration');
      expectDraft();
      expect(notified).toHaveBeenCalledExactlyOnceWith(error);
      expect(server.capabilities).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the draft when the verification request cannot reach the server', async () => {
    const { router } = await ready();
    server.verify.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(() => router.navigate({ to: '/configuration', search: { tab: 'second' } }));
    expectDraft();
    expect(notified).toHaveBeenCalledExactlyOnceWith('AUTH_SESSION_CHECK_UNAVAILABLE');
  });

  it.each([
    { user: { ...USER, id: 'other-user' }, tenantId: undefined },
    { user: USER, tenantId: 'other-tenant' },
  ])('keeps the draft attached to its original account and tenant', async (session) => {
    const { router } = await ready();
    server.verify.mockResolvedValue({ valid: true, ...session });
    await act(() => router.navigate({ to: '/configuration', search: { tab: 'second' } }));
    expectDraft();
    expect(notified).toHaveBeenCalledExactlyOnceWith('OPENID_SESSION_ENDED');
  });

  it('does not use the held identity to enter a different protected page', async () => {
    const { router } = await ready();
    server.verify.mockResolvedValue({ valid: false, error: 'OPENID_SESSION_ENDED' });
    await act(() => router.navigate({ to: '/help', ignoreBlocker: true }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(notified).not.toHaveBeenCalled();
  });

  it.each(['AUTH_SESSION_CHECK_UNAVAILABLE', 'OPENID_SESSION_ENDED'] as const)(
    'does not bypass initial authentication for %s even with a hold',
    async (error) => {
      const release = holdSessionRedirects();
      try {
        const { router } = setup(error);
        await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
        expect(screen.queryByRole('textbox', { name: 'draft' })).toBeNull();
        expect(server.capabilities).not.toHaveBeenCalled();
      } finally {
        release();
      }
    },
  );
});
