import { createFileRoute } from '@tanstack/react-router';
import { AccessDenied, PermissionsUnavailable } from '@/components/shared';
import { QuestionnaireEditorPage } from '@/components/questionnaires';
import { READ_QUESTIONNAIRES_CAPABILITY } from '@/constants';
import { useCapabilities } from '@/hooks';

export const Route = createFileRoute('/_app/questionnaires/$questionnaireId')({
  component: QuestionnaireEditorRoute,
});

function QuestionnaireEditorRoute() {
  const { questionnaireId } = Route.useParams();
  const { hasCapability, isLoading, isError } = useCapabilities();

  if (isLoading) return null;
  if (isError) return <PermissionsUnavailable />;
  if (!hasCapability(READ_QUESTIONNAIRES_CAPABILITY)) return <AccessDenied />;

  return <QuestionnaireEditorPage questionnaireId={questionnaireId} />;
}
