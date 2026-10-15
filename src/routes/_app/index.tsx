import { createFileRoute } from '@tanstack/react-router';
import { DashboardPage } from '@/components/dashboard';

export const Route = createFileRoute('/_app/')({
  head: () => ({ meta: [{ title: 'AIMO · Chat Admin Panel · Overview' }] }),
  component: DashboardRoute,
});

function DashboardRoute() {
  return <DashboardPage />;
}
