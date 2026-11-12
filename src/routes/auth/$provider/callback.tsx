import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import {
  withBasePath,
  toSafeRedirect,
  isSsoProviderId,
  resolveSsoCallback,
  parseSsoCallbackSearch,
} from '@/utils';
import { SsoError } from '@/components/SsoError';
import { oauthExchangeFn } from '@/server';

export const Route = createFileRoute('/auth/$provider/callback')({
  validateSearch: parseSsoCallbackSearch,
  loaderDeps: ({ search }) => ({ code: search.code, error: search.error }),
  loader: async ({ params, deps }) => {
    const { provider } = params;
    if (!isSsoProviderId(provider)) throw notFound();
    const result = await resolveSsoCallback(deps, (code) =>
      oauthExchangeFn({ data: { code, provider } }),
    );
    if (!result.error) {
      const path = toSafeRedirect(result.redirectTo);
      throw redirect({ href: withBasePath(path, import.meta.env.VITE_BASE_PATH) });
    }
    return { code: result.code };
  },
  component: SsoCallback,
});

function SsoCallback() {
  const { code } = Route.useLoaderData();
  return <SsoError code={code} />;
}
