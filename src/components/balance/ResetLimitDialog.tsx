import { useEffect, useState } from 'react';
import { ConfirmationDialog } from '@clickhouse/click-ui';
import type { AdminBalanceListItem } from '@/types';
import { useAddCredit, useLocalize } from '@/hooks';
import { canResetLimit } from './eligibility';

function unavailableMessage(item: AdminBalanceListItem) {
  if (!item.balanceEnabled) {
    return 'com_balance_status_not_enabled' as const;
  }
  if ((item.refillAmount ?? 0) <= 0) {
    return 'com_balance_no_refill_amount' as const;
  }
  return 'com_balance_no_pending_request' as const;
}

export function ResetLimitDialog({
  target,
  onClose,
}: {
  target: AdminBalanceListItem | null;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { mutate, isPending } = useAddCredit();
  // Generated once per dialog "session" — a slow-network double-click on the
  // same open dialog reuses this key rather than minting a new one, so the
  // backend's idempotency check actually has something to catch.
  const [idempotencyKey, setIdempotencyKey] = useState('');

  useEffect(() => {
    if (target) {
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [target]);

  if (!target) {
    return null;
  }

  const refillAmount = target.refillAmount ?? 0;
  const canReset = canResetLimit(target);
  const resultingBalance = target.tokenCredits + refillAmount;

  const handleConfirm = () => {
    if (!canReset) return;
    mutate(
      {
        userId: target.id,
        amount: refillAmount,
        idempotencyKey,
        requestId: target.pendingRequest?.requestId,
        name: target.name,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <ConfirmationDialog
      open
      title={localize('com_balance_reset_limit_title', { name: target.name })}
      primaryActionLabel={localize('com_balance_reset_limit')}
      primaryActionType="primary"
      secondaryActionLabel={localize('com_ui_cancel')}
      disabled={!canReset}
      loading={isPending}
      onConfirm={handleConfirm}
      onCancel={onClose}
      showClose
    >
      <div className="flex flex-col gap-3">
        {target.pendingRequest?.reason && (
          <div className="flex flex-col gap-1 rounded-md border border-(--cui-color-stroke-default) bg-(--cui-color-background-secondary) p-2">
            <span className="text-xs font-medium text-(--cui-color-text-muted)">
              {localize('com_balance_request_reason')}
            </span>
            <span className="text-sm text-(--cui-color-text-default)">
              {target.pendingRequest.reason}
            </span>
          </div>
        )}

        {canReset ? (
          <>
            <p className="text-sm text-(--cui-color-text-default)">
              {localize('com_balance_reset_limit_confirm', {
                amount: refillAmount.toLocaleString(),
                name: target.name,
              })}
            </p>
            <span className="text-sm text-(--cui-color-text-muted)">
              {localize('com_balance_col_current_balance')}: {target.tokenCredits.toLocaleString()}
            </span>
            <span className="text-sm font-medium text-(--cui-color-text-default)">
              {localize('com_balance_resulting_balance', {
                amount: resultingBalance.toLocaleString(),
              })}
            </span>
          </>
        ) : (
          <p role="alert" className="text-sm text-(--cui-color-text-danger)">
            {localize(unavailableMessage(target))}
          </p>
        )}
      </div>
    </ConfirmationDialog>
  );
}
