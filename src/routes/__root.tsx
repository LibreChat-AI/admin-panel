import '../locales/i18n';
import { ClickUIProvider } from '@clickhouse/click-ui';
import { TanStackDevtools } from '@tanstack/react-devtools';
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import {
  HeadContent,
  Link,
  Outlet,
  ScriptOnce,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import appCss from '../styles.css?url';
import { useLocalize } from '@/hooks';

const themeScript = `(function(){
  try {
    var t = localStorage.getItem('theme') || 'system';
    if (t === 'dark') document.documentElement.classList.add('dark');
    else if (t === 'light') document.documentElement.classList.add('light');
  } catch(e) {}
})();`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  ssr: false,
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'LibreChat Admin Panel',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        href: `${(import.meta.env.VITE_BASE_PATH || '').replace(/\/$/, '')}/favicon.ico`,
      },
    ],
  }),
  component: RootComponent,
  pendingComponent: RootPending,
  shellComponent: RootDocument,
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
});

function RootComponent() {
  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}

function ThemedApp() {
  const { resolvedTheme } = useTheme();
  return (
    <ClickUIProvider theme={resolvedTheme}>
      <div className="isolate">
        <Outlet />
      </div>
    </ClickUIProvider>
  );
}

function RootPending() {
  const localize = useLocalize();
  return (
    <div className="flex min-h-screen items-center justify-center bg-(--cui-color-background-default)">
      <div className="animate-pulse text-lg text-(--cui-color-text-muted)">
        {localize('com_ui_loading')}
      </div>
    </div>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ScriptOnce children={themeScript} />
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'TanStack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            {
              name: 'TanStack Query',
              render: <ReactQueryDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}

function RootError({ error }: ErrorComponentProps) {
  if (import.meta.env.DEV) console.error(error);
  const localize = useLocalize();
  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-(--cui-color-background-default) px-4"
    >
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-(--cui-color-background-secondary)">
          <svg
            aria-hidden="true"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--cui-color-text-danger)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-(--cui-color-title-default)">
          {localize('com_error_page_title')}
        </h1>
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

function RootNotFound() {
  const localize = useLocalize();
  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-(--cui-color-background-default) px-4"
    >
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="text-5xl font-bold text-(--cui-color-text-muted)">404</span>
        <h1 className="text-xl font-semibold text-(--cui-color-title-default)">
          {localize('com_error_not_found_title')}
        </h1>
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
