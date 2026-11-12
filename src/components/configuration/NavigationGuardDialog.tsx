import { useId } from 'react';
import { Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useReturnFocus, useLocalize } from '@/hooks';
import { activeConfigTab } from '@/utils';

/**
 * Themed unsaved-changes prompt for leaving the page or switching profile
 * (WS5: SH-6): Save & continue, Discard, or Cancel, with the change count.
 * Its body text describes the dialog, so screen readers read it on open.
 */
export function NavigationGuardDialog({
  open,
  intent,
  changeCount,
  onSave,
  onDiscard,
  onCancel,
}: t.NavigationGuardDialogProps) {
  const localize = useLocalize();
  const returnFocus = useReturnFocus(open, activeConfigTab);
  const descriptionId = useId();

  const title = (() => {
    if (intent.kind === 'scope') {
      return localize('com_config_shell_guard_switch_title', {
        name: intent.name,
        count: changeCount,
      });
    }
    return localize('com_config_shell_guard_leave_title', { count: changeCount });
  })();

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
          <p
            id={descriptionId}
            className="m-0 text-sm leading-relaxed text-(--cui-color-text-default)"
          >
            {localize('com_config_shell_guard_desc', { count: changeCount })}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              htmlType="button"
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={onCancel}
            />
            <Button
              htmlType="button"
              type="danger"
              label={localize('com_config_shell_guard_discard')}
              onClick={onDiscard}
            />
            <Button
              htmlType="button"
              type="primary"
              label={localize('com_config_shell_guard_save')}
              onClick={onSave}
            />
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
