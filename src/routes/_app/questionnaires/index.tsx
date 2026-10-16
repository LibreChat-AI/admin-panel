import { createFileRoute } from '@tanstack/react-router';
import { AccessDenied, PermissionsUnavailable } from '@/components/shared';
import { QuestionnairesPage } from '@/components/questionnaires';
import { READ_QUESTIONNAIRES_CAPABILITY } from '@/constants';
import { useCapabilities } from '@/hooks';

export const Route = createFileRoute('/_app/questionnaires/')({
  component: QuestionnairesRoute,
});

function QuestionnairesRoute() {
  const { hasCapability, isLoading, isError } = useCapabilities();

  if (isLoading) return null;
  if (isError) return <PermissionsUnavailable />;
  if (!hasCapability(READ_QUESTIONNAIRES_CAPABILITY)) return <AccessDenied />;

  return <QuestionnairesPage />;
}
