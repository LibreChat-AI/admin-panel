import { ClickUIProvider } from '@clickhouse/click-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  Outlet,
  createRouter,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
} from '@tanstack/react-router';
import type * as t from '@/types';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Route as DashboardRoute } from '../_app/index';
import { SystemCapabilities } from '@/constants';
import { localizeEn } from '@/test/coverage';
import { Route as AppRoute } from '../_app';

const server = vi.hoisted(() => ({
  verifyAdminTokenFn: vi.fn(),
  getEffectiveCapabilitiesFn: vi.fn(),
  never: () => new Promise<never>(() => undefined),
}));

vi.mock('@/server', () => ({
  verifyAdminTokenFn: server.verifyAdminTokenFn,
  getEffectiveCapabilitiesFn: server.getEffectiveCapabilitiesFn,
  adminLogoutFn: vi.fn(),
  configContractOptions: { queryKey: ['configContract'], queryFn: server.never, retry: false },
  configSchemaTreeOptions: { queryKey: ['configSchemaTree'], queryFn: server.never },
  baseConfigOptions: { queryKey: ['baseConfig'], queryFn: server.never },
}));

const USER = { id: 'u1', email: 'viewer@test.local', name: 'Viewer', role: 'USER' };
const ADMIN_CAPABILITIES = [SystemCapabilities.ACCESS_ADMIN, SystemCapabilities.READ_CONFIGS];
/** The panel's chrome: sidebar, header and the routed page. */
const CHROME = 'aside, header, main';

const TestRoot = createRootRouteWithContext<t.RouterContext>()({
  component: () => (
    <ThemeProvider>
      <ClickUIProvider theme="light">
        <Outlet />
      </ClickUIProvider>
    </ThemeProvider>
  ),
});

/**
 * The real `/_app` route and dashboard under a bare root, placed the way
 * `routeTree.gen.ts` places them under `__root` (whose document shell jsdom
 * cannot render).
 */
Object.assign(AppRoute.options, { id: '/_app', getParentRoute: () => TestRoot });
Object.assign(DashboardRoute.options, { id: '/', path: '/', getParentRoute: () => AppRoute });
const routeTree = TestRoot.addChildren([AppRoute.addChildren([DashboardRoute])]);

function matchMediaStub(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  };
}

interface ChromeLog {
  /** Every chrome element that entered the document, even ones removed again. */
  mounted: Element[];
  /** The sidebar's nav links when the sidebar first mounted. */
  firstNav: string[] | null;
  stop: () => void;
}

let chromeLog: ChromeLog | null = null;

/** Records chrome as it is added to the document, so a mount the next render undoes still counts. */
function watchChrome(): ChromeLog {
  const log: ChromeLog = { mounted: [], firstNav: null, stop: () => undefined };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const found = [...(node.matches(CHROME) ? [node] : []), ...node.querySelectorAll(CHROME)];
        log.mounted.push(...found);
        const aside = found.find((el) => el.tagName === 'ASIDE');
        if (aside && !log.firstNav) {
          log.firstNav = [...aside.querySelectorAll('nav a')].map((a) => a.textContent ?? '');
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  log.stop = () => observer.disconnect();
  chromeLog = log;
  return log;
}

function renderApp(queryClient = new QueryClient()) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { queryClient },
  });
  const chrome = watchChrome();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, chrome };
}

function expectNoChrome(chrome: ChromeLog) {
  expect(chrome.mounted).toEqual([]);
  expect(document.querySelector(CHROME)).toBeNull();
}

describe('/_app admin gate', () => {
  beforeAll(() => {
    vi.stubGlobal('matchMedia', matchMediaStub);
    vi.stubGlobal('scrollTo', () => undefined);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    chromeLog?.stop();
    chromeLog = null;
  });

  beforeEach(() => {
    server.verifyAdminTokenFn.mockReset().mockResolvedValue({ valid: true, user: USER });
    server.getEffectiveCapabilitiesFn.mockReset();
  });

  it('shows only the loading shell while the capabilities load', async () => {
    let resolve: (value: { capabilities: string[] }) => void = () => undefined;
    server.getEffectiveCapabilitiesFn.mockReturnValue(new Promise((r) => (resolve = r)));
    const { chrome } = renderApp();

    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true');
    expectNoChrome(chrome);

    await act(async () => resolve({ capabilities: ADMIN_CAPABILITIES }));
    expect(await screen.findByRole('complementary')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    [
      'capabilities without access:admin',
      () => Promise.resolve({ capabilities: ['read:configs'] }),
    ],
    ['a 403 from the grants API', () => Promise.reject(new Error('Forbidden (403)'))],
    ['no grants API on the server (404)', () => Promise.reject(new Error('Not Found (404)'))],
  ])('denies access before any chrome mounts, given %s', async (_case, capabilities) => {
    server.getEffectiveCapabilitiesFn.mockImplementation(capabilities);
    const { chrome } = renderApp();

    expect(
      await screen.findByRole('heading', { name: localizeEn('com_access_denied_title') }),
    ).toBeVisible();
    expectNoChrome(chrome);
  });

  it('shows PermissionsUnavailable, not the panel or the error page, when the capabilities fail', async () => {
    server.getEffectiveCapabilitiesFn.mockRejectedValue(new Error('Internal Server Error (500)'));
    const { chrome } = renderApp();

    expect(
      await screen.findByRole('heading', { name: localizeEn('com_perm_unavailable_title') }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: localizeEn('com_ui_reload') })).toBeVisible();
    expect(screen.queryByText(localizeEn('com_error_page_title'))).toBeNull();
    expectNoChrome(chrome);
    expect(server.getEffectiveCapabilitiesFn).toHaveBeenCalledTimes(1);
  });

  it('loads the capabilities in the route loader, before the layout renders', async () => {
    server.getEffectiveCapabilitiesFn.mockResolvedValue({ capabilities: ADMIN_CAPABILITIES });
    const queryClient = new QueryClient();
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { queryClient },
    });

    await router.load();

    expect(server.getEffectiveCapabilitiesFn).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['effectiveCapabilities', USER.id])).toBeDefined();
  });

  it('waits for stale cached capabilities to be fetched again before rendering', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      ['effectiveCapabilities', USER.id],
      { available: true, capabilities: ADMIN_CAPABILITIES },
      { updatedAt: Date.now() - 60_000 },
    );
    server.getEffectiveCapabilitiesFn.mockResolvedValue({ capabilities: ['read:configs'] });
    const { chrome } = renderApp(queryClient);

    expect(
      await screen.findByRole('heading', { name: localizeEn('com_access_denied_title') }),
    ).toBeVisible();
    expectNoChrome(chrome);
    expect(server.getEffectiveCapabilitiesFn).toHaveBeenCalledTimes(1);
  });

  it('fails closed when stale cached capabilities cannot be fetched again', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      ['effectiveCapabilities', USER.id],
      { available: true, capabilities: ADMIN_CAPABILITIES },
      { updatedAt: Date.now() - 60_000 },
    );
    server.getEffectiveCapabilitiesFn.mockRejectedValue(new Error('Internal Server Error (500)'));
    const { chrome } = renderApp(queryClient);

    expect(
      await screen.findByRole('heading', { name: localizeEn('com_perm_unavailable_title') }),
    ).toBeVisible();
    expectNoChrome(chrome);
  });

  it('renders the panel for an admin with its nav items already in place', async () => {
    server.getEffectiveCapabilitiesFn.mockResolvedValue({ capabilities: ADMIN_CAPABILITIES });
    const { chrome } = renderApp();

    const sidebar = await screen.findByRole('complementary');
    expect(
      within(sidebar).getByRole('link', { name: localizeEn('com_nav_configuration') }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: localizeEn('com_dash_quick_links') })).toBeVisible();
    expect(chrome.firstNav).toContain(localizeEn('com_nav_configuration'));
    expect(screen.queryByText(localizeEn('com_access_denied_title'))).toBeNull();
    expect(server.getEffectiveCapabilitiesFn).toHaveBeenCalledTimes(1);
  });

  it('keeps an admin in the panel when a later refetch of the capabilities fails', async () => {
    server.getEffectiveCapabilitiesFn.mockResolvedValue({ capabilities: ADMIN_CAPABILITIES });
    const { queryClient } = renderApp();
    await screen.findByRole('complementary');

    server.getEffectiveCapabilitiesFn.mockRejectedValue(new Error('Internal Server Error (500)'));
    await act(() => queryClient.invalidateQueries({ queryKey: ['effectiveCapabilities'] }));

    await waitFor(() => expect(server.getEffectiveCapabilitiesFn).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('complementary')).toBeVisible();
    expect(screen.queryByText(localizeEn('com_error_page_title'))).toBeNull();
    expect(screen.queryByText(localizeEn('com_perm_unavailable_title'))).toBeNull();
  });

  it('takes the panel away when a refetch shows access:admin was revoked', async () => {
    server.getEffectiveCapabilitiesFn.mockResolvedValue({ capabilities: ADMIN_CAPABILITIES });
    const { queryClient } = renderApp();
    await screen.findByRole('complementary');

    server.getEffectiveCapabilitiesFn.mockResolvedValue({ capabilities: [] });
    await act(() => queryClient.invalidateQueries({ queryKey: ['effectiveCapabilities'] }));

    expect(
      await screen.findByRole('heading', { name: localizeEn('com_access_denied_title') }),
    ).toBeVisible();
    expect(document.querySelector(CHROME)).toBeNull();
  });
});
