import { useState, useEffect } from 'react';
import { Icon } from '@clickhouse/click-ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useRouter, Link, redirect } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { capabilitiesQueryOptions, useCommandMenu, useLocalize } from '@/hooks';
import { verifyAdminTokenFn } from '@/server';
import { SystemCapabilities, hasImpliedCapability } from '@/constants';
import { AccessDenied, LoadingState } from '@/components/shared';
import { CommandMenu } from '@/components/CommandMenu';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';

const ROUTE_TITLE_KEYS: Record<string, string> = {
  '/': 'com_dash_title',
  '/configuration': 'com_config_title',
  '/users': 'com_users_title',
  '/access': 'com_access_title',
  '/grants': 'com_grants_title',
  '/help': 'com_help_title',
};

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const result = await verifyAdminTokenFn();

    if (!result.valid) {
      throw redirect({
        to: '/login',
        search: { redirect: location.pathname },
      });
    }

    return { user: result.user };
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(capabilitiesQueryOptions(context.user.id));
  },
  pendingComponent: AppPending,
  component: AppLayout,
  errorComponent: AppError,
  notFoundComponent: AppNotFound,
});

function AppPending() {
  return (
    <div className="flex h-screen items-center justify-center">
      <LoadingState />
    </div>
  );
}

function AppLayout() {
  const { user } = Route.useRouteContext();
  const { available, capabilities } = useSuspenseQuery(capabilitiesQueryOptions(user.id)).data;
  const router = useRouter();
  const localize = useLocalize();
  const { open, setOpen } = useCommandMenu();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem('admin-panel:sidebar-collapsed');
    return stored !== null ? stored === 'true' : true;
  });
  const pathname = router.state.location.pathname;

  const toggleSidebar = () =>
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('admin-panel:sidebar-collapsed', String(next));
      return next;
    });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!available || !hasImpliedCapability(capabilities, SystemCapabilities.ACCESS_ADMIN)) {
    return <AccessDenied />;
  }

  const matchedKey = Object.keys(ROUTE_TITLE_KEYS).find((route) =>
    route === '/' ? pathname === '/' : pathname.startsWith(route),
  );
  const title = matchedKey ? localize(ROUTE_TITLE_KEYS[matchedKey]) : undefined;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={title} onSearchClick={() => setOpen(true)} />
        <main className="flex min-h-0 flex-1 flex-col overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandMenu open={open} onOpenChange={setOpen} />
    </div>
  );
}

function AppError({ error }: ErrorComponentProps) {
  if (import.meta.env.DEV) console.error(error);
  const localize = useLocalize();
  return (
    <div role="alert" className="flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-(--cui-color-background-secondary)">
          <span aria-hidden="true" className="text-(--cui-color-text-danger)">
            <Icon name="warning" size="md" />
          </span>
        </div>
        <h2 className="text-lg font-semibold text-(--cui-color-title-default)">
          {localize('com_error_page_title')}
        </h2>
        <p className="text-sm text-(--cui-color-text-muted)">{localize('com_error_page_desc')}</p>
        <Link
          to="/"
          className="mt-2 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-4 py-2 text-sm font-medium text-(--cui-color-text-default) no-underline transition-colors hover:bg-(--cui-color-background-hover)"
        >
          {localize('com_nav_go_home')}
        </Link>
      </div>
    </div>
  );
}

function AppNotFound() {
  const localize = useLocalize();
  return (
    <div role="alert" className="flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <span className="text-4xl font-bold text-(--cui-color-text-muted)">404</span>
        <h2 className="text-lg font-semibold text-(--cui-color-title-default)">
          {localize('com_error_not_found_title')}
        </h2>
        <p className="text-sm text-(--cui-color-text-muted)">
          {localize('com_error_not_found_desc')}
        </p>
        <Link
          to="/"
          className="mt-2 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-4 py-2 text-sm font-medium text-(--cui-color-text-default) no-underline transition-colors hover:bg-(--cui-color-background-hover)"
        >
          {localize('com_nav_go_home')}
        </Link>
      </div>
    </div>
  );
}
