import { z } from 'zod';
import { createFileRoute, redirect, Link } from '@tanstack/react-router';
import { takePostLoginRedirect } from '@/utils';
import { oauthExchangeFn } from '@/server';
import { useLocalize } from '@/hooks';

const searchSchema = z.object({
  code: z.string().optional(),
});

export const Route = createFileRoute('/auth/openid/callback')({
  head: () => ({ meta: [{ title: 'AIMO · Chat Admin Panel · Signing in' }] }),
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ code: search.code }),
  loader: async ({ deps: { code } }) => {
    if (!code || !/^[a-f0-9]{64}$/.test(code)) {
      return { error: 'invalid_code' as const };
    }

    try {
      const result = await oauthExchangeFn({ data: { code } });
      if (result.error) {
        return { error: 'exchange_failed' as const, message: result.message };
      }
      throw redirect({ to: takePostLoginRedirect() });
    } catch (e) {
      if (e instanceof Response || (e && typeof e === 'object' && 'to' in e)) throw e;
      return { error: 'exchange_failed' as const };
    }
  },
  component: OpenIdCallback,
});

function OpenIdCallback() {
  const loaderData = Route.useLoaderData();
  const localize = useLocalize();

  const errorMessage =
    loaderData.error === 'invalid_code'
      ? localize('com_auth_sso_exchange_failed')
      : (loaderData.message ?? localize('com_auth_sso_exchange_failed'));

  return (
    <div className="flex min-h-screen items-center justify-center bg-(--cui-color-background-default) px-4">
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
          {localize('com_auth_sso_error_title')}
        </h1>
        <p className="text-sm text-(--cui-color-text-muted)">{errorMessage}</p>
        <Link
          to="/login"
          search={{ redirect: '/' }}
          className="mt-2 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-4 py-2 text-sm font-medium text-(--cui-color-text-default) no-underline transition-colors hover:bg-(--cui-color-background-hover)"
        >
          {localize('com_auth_sso_back_to_login')}
        </Link>
      </div>
    </div>
  );
}
