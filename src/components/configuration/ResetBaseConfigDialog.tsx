import { Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

export function ResetBaseConfigDialog({
  open,
  resetting,
  error,
  onConfirm,
  onCancel,
}: t.ResetBaseConfigDialogProps) {
  const localize = useLocalize();

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()}
        title={localize('com_config_reset_base_title')}
        showClose
        onClose={onCancel}
        className="modal-frost"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-(--cui-color-text-default)">
            {localize('com_config_reset_base_confirm')}
          </p>
          {error && (
            <div
              className="rounded-lg bg-[rgba(220,38,38,0.1)] px-3 py-2 text-sm font-medium text-(--cui-color-text-danger)"
              role="alert"
            >
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={onCancel}
              disabled={resetting}
            />
            <Button
              type="danger"
              label={
                resetting
                  ? localize('com_config_reset_base_resetting')
                  : localize('com_config_reset_base_action')
              }
              iconLeft={resetting ? 'loading-animated' : undefined}
              onClick={onConfirm}
              disabled={resetting}
            />
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
