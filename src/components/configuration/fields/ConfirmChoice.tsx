import { useId } from 'react';
import { Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useReturnFocus, useLocalize, useSessionDraft } from '@/hooks';
import { SessionDraftError } from '@/components/shared';

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
  const recovery = useSessionDraft(open);
  const blocked = recovery?.blocked ?? false;
  const cancel = () => {
    if (!blocked) onCancel();
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
        showClose
        onClose={cancel}
        onCloseAutoFocus={returnFocus}
        aria-describedby={descriptionId}
        className="modal-frost"
      >
        {recovery?.sessionError && (
          <SessionDraftError
            code={recovery.sessionError}
            error={recovery.recoveryError}
            onRetry={recovery.retrySession}
          />
        )}
        <div
          className="flex flex-col gap-4"
          style={blocked ? { display: 'none' } : undefined}
          inert={blocked}
        >
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
              onClick={cancel}
            />
            {actions.map((action) => (
              <Button
                key={action.label}
                htmlType="button"
                type={action.type ?? 'primary'}
                label={action.label}
                onClick={() => {
                  if (!blocked) action.onSelect();
                }}
              />
            ))}
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
