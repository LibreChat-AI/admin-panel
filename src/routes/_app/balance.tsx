import { createFileRoute } from '@tanstack/react-router';
import { AccessDenied, PermissionsUnavailable } from '@/components/shared';
import { READ_BALANCES_CAPABILITY } from '@/constants';
import { BalanceTab } from '@/components/balance';
import { useCapabilities } from '@/hooks';

export const Route = createFileRoute('/_app/balance')({
  component: BalanceRoute,
});

function BalanceRoute() {
  const { hasCapability, isLoading, isError } = useCapabilities();

  if (isLoading) return null;
  if (isError) return <PermissionsUnavailable />;
  if (!hasCapability(READ_BALANCES_CAPABILITY)) return <AccessDenied />;

  return <BalanceTab />;
}
