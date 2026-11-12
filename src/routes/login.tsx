import { Container } from '@clickhouse/click-ui';
import { createFileRoute } from '@tanstack/react-router';
import { useDocumentTitle, useLocalize } from '@/hooks';
import ThemeSelector from '@/components/ThemeSelector';
import { AuthCard } from '@/components/AuthCard';
import { ssoProvidersFn } from '@/server';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : '/',
  }),
  loader: () => ssoProvidersFn(),
  component: LoginPage,
});

function LoginPage() {
  const localize = useLocalize();
  const { redirect } = Route.useSearch();
  useDocumentTitle(localize('com_auth_sign_in'));
  const { providers, ssoOnly } = Route.useLoaderData();

  return (
    <Container
      orientation="vertical"
      alignItems="center"
      justifyContent="center"
      style={{ minHeight: '100vh', padding: '1rem', gap: '1rem' }}
    >
      <AuthCard redirectTo={redirect} providers={providers} ssoOnly={ssoOnly} />
      <div className="sm:absolute sm:bottom-0 sm:left-0 sm:m-4">
        <ThemeSelector returnThemeOnly />
      </div>
    </Container>
  );
}
