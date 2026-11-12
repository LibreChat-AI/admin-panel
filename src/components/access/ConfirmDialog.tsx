import { useRef } from 'react';
import { Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize, useReturnFocus } from '@/hooks';
import { BusyButton } from '@/components/shared';
import { isFocusLost } from '@/utils';

/**
 * Asks before a destructive action. It opens on Cancel, so Enter never
 * confirms by accident, and the message describes the dialog. Confirm keeps
 * it open while `saving` until the caller closes it on success.
 *
 * Cancel, Escape and the close button give focus back to the control that
 * opened it. Closing after Confirm gives it to `returnFocusTo()` instead: the
 * action removes the opener's row, but only once the list refetches, after
 * the dialog has closed. A close while the action is still saving counts as
 * confirmed; one after it failed (the dialog stays open) does not.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmType = 'danger',
  saving,
  error,
  onConfirm,
  onCancel,
  returnFocusTo,
}: t.ConfirmDialogProps) {
  const localize = useLocalize();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);
  const returnFocus = useReturnFocus(open, returnFocusTo);

  const cancel = () => {
    if (!saving) confirmedRef.current = false;
    onCancel();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) cancel();
      }}
    >
      <Dialog.Content
        title={title}
        description={description}
        showClose
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (confirmedRef.current && isFocusLost()) returnFocusTo?.()?.focus();
          confirmedRef.current = false;
          returnFocus(event);
        }}
        className="modal-frost"
      >
        <div className="flex flex-col gap-4 pt-4">
          {error && (
            <p role="alert" className="m-0 text-sm text-(--cui-color-text-danger)">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              ref={cancelRef}
              htmlType="button"
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={cancel}
            />
            <BusyButton
              htmlType="button"
              type={confirmType}
              label={confirmLabel}
              busy={saving}
              onClick={() => {
                confirmedRef.current = true;
                onConfirm();
              }}
            />
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
