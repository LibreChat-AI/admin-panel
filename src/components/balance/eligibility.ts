import type { AdminBalanceListItem } from '@/types';

export function canResetLimit(item: AdminBalanceListItem): boolean {
  const hasResetTrigger = item.pendingRequest != null || item.tokenCredits === 0;
  return item.balanceEnabled && (item.refillAmount ?? 0) > 0 && hasResetTrigger;
}
