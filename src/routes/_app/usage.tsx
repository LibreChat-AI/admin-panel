import { createFileRoute } from '@tanstack/react-router';
import { UsagePage } from '@/components/usage';

export const Route = createFileRoute('/_app/usage')({
  component: UsagePage,
});
