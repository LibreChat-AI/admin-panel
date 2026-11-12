import { useId } from 'react';
import { Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useReturnFocus, useLocalize } from '@/hooks';

/**
 * Asks before a change with consequences beyond the field (switching file
 * storage, accepting every or no file type, opening sign-up to everyone).
 * Cancel keeps the current value; each action applies one outcome. Its body
 * describes the dialog, so screen readers read it on open.
 */
export function ConfirmChoiceDialog({
  open,
  title,
  children,
  actions,
  onCancel,
}: t.ConfirmChoiceDialogProps) {
  const localize = useLocalize();
  const returnFocus = useReturnFocus(open);
  const descriptionId = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <Dialog.Content
        title={title}
        showClose
        onClose={onCancel}
        onCloseAutoFocus={returnFocus}
        aria-describedby={descriptionId}
        className="modal-frost"
      >
        <div className="flex flex-col gap-4">
          <div
            id={descriptionId}
            className="flex flex-col gap-2 text-sm leading-relaxed text-(--cui-color-text-default)"
          >
            {children}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              htmlType="button"
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={onCancel}
            />
            {actions.map((action) => (
              <Button
                key={action.label}
                htmlType="button"
                type={action.type ?? 'primary'}
                label={action.label}
                onClick={action.onSelect}
              />
            ))}
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
