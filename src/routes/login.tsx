import { Container } from '@clickhouse/click-ui';
import { createFileRoute } from '@tanstack/react-router';
import { useDocumentTitle, useLocalize } from '@/hooks';
import ThemeSelector from '@/components/ThemeSelector';
import { SessionError } from '@/components/SessionError';
import { toSafeRedirect, withBasePath } from '@/utils';
import { AuthCard } from '@/components/AuthCard';
import { ssoProvidersFn } from '@/server';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : '/',
    ...(search.session === 'ended' || search.session === 'unavailable'
      ? { session: search.session as 'ended' | 'unavailable' }
      : {}),
  }),
  loaderDeps: ({ search }) => ({ session: search.session }),
  loader: ({ deps }) =>
    deps.session === 'unavailable' ? { providers: [], ssoOnly: false } : ssoProvidersFn(),
  component: LoginPage,
});

function LoginPage() {
  const localize = useLocalize();
  const { redirect, session } = Route.useSearch();
  useDocumentTitle(
    localize(session === 'unavailable' ? 'com_auth_session_unavailable_title' : 'com_auth_sign_in'),
  );
  const { providers, ssoOnly } = Route.useLoaderData();

  if (session === 'unavailable') {
    return (
      <SessionError
        onRetry={async () => {
          window.location.assign(
            withBasePath(toSafeRedirect(redirect), import.meta.env.VITE_BASE_PATH),
          );
        }}
      />
    );
  }

  return (
    <Container
      orientation="vertical"
      alignItems="center"
      justifyContent="center"
      style={{ minHeight: '100vh', padding: '1rem', gap: '1rem' }}
    >
      {session === 'ended' && (
        <p role="status" className="text-center text-sm text-(--cui-color-text-muted)">
          {localize('com_auth_session_ended')}
        </p>
      )}
      <AuthCard
        redirectTo={redirect}
        providers={providers}
        ssoOnly={ssoOnly}
        autoRedirect={session !== 'ended'}
      />
      <div className="sm:absolute sm:bottom-0 sm:left-0 sm:m-4">
        <ThemeSelector returnThemeOnly />
      </div>
    </Container>
  );
}
