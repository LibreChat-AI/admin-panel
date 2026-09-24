import { createFileRoute } from '@tanstack/react-router';
import { ToolsPage } from '@/components/tools';

export const Route = createFileRoute('/_app/tools')({
  component: ToolsRoute,
});

function ToolsRoute() {
  return <ToolsPage />;
}
