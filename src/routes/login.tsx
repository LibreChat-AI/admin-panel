import { Container } from '@clickhouse/click-ui';
import { createFileRoute } from '@tanstack/react-router';
import ThemeSelector from '@/components/ThemeSelector';
import { AuthCard } from '@/components/AuthCard';
import { checkOpenIdFn } from '@/server';

export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'AIMO · Chat Admin Panel · Sign in' }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : '/',
  }),
  loader: async () => {
    const openIdStatus = await checkOpenIdFn();
    return {
      ssoAvailable: openIdStatus.available,
      ssoOnly: openIdStatus.available && openIdStatus.ssoOnly,
    };
  },
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const { ssoAvailable, ssoOnly } = Route.useLoaderData();

  return (
    <Container
      orientation="vertical"
      alignItems="center"
      justifyContent="center"
      style={{ minHeight: '100vh', padding: '1rem', gap: '1rem' }}
    >
      <AuthCard redirectTo={redirect} autoRedirectSso={ssoOnly} ssoAvailable={ssoAvailable} />
      <div className="sm:absolute sm:bottom-0 sm:left-0 sm:m-4">
        <ThemeSelector returnThemeOnly />
      </div>
    </Container>
  );
}
