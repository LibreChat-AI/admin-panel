import { createFileRoute } from '@tanstack/react-router';
import { ServicesPage } from '@/components/services';

export const Route = createFileRoute('/_app/services')({
  component: ServicesRoute,
});

function ServicesRoute() {
  return <ServicesPage />;
}
