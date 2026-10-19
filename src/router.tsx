import { QueryClient } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { pollGatewaySession, watchGatewaySessionEnd } from '@/utils';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  if (typeof window !== 'undefined') {
    watchGatewaySessionEnd(window);
    pollGatewaySession(window);
  }
  const queryClient = new QueryClient();
  const router = createTanStackRouter({
    routeTree,
    basepath: import.meta.env.VITE_BASE_PATH || '/',
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
