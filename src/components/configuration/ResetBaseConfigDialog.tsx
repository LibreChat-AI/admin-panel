import { useId } from 'react';
import { Link, Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useReturnFocus, useLocalize } from '@/hooks';
import { activeConfigTab } from '@/utils';
import { ReviewList } from './review';

/**
 * "Revert all admin overrides to librechat.yaml" (RV-5): lists every base
 * override it removes and what each setting goes back to, as a danger action.
 * The list scrolls on its own, so it is a focusable region keyboard users can scroll.
 * Its body text describes the dialog, so screen readers read it on open.
 */
export function ResetBaseConfigDialog({
  open,
  resetting,
  error,
  termsUrl,
  overrides,
  onConfirm,
  onCancel,
}: t.ResetBaseConfigDialogProps) {
  const localize = useLocalize();
  const returnFocus = useReturnFocus(open, activeConfigTab);
  const listLabelId = useId();
  const descriptionId = useId();
  const count = overrides?.count ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <Dialog.Content
        title={localize('com_config_review_reset_title')}
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
            {localize('com_config_review_reset_body')}
          </p>
          {overrides && count > 0 && (
            <div className="flex flex-col gap-2">
              <p
                id={listLabelId}
                className="m-0 text-sm font-medium text-(--cui-color-text-default)"
              >
                {localize('com_config_review_reset_list', { count })}
              </p>
              <div
                role="region"
                tabIndex={0}
                aria-labelledby={listLabelId}
                className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-lg border border-(--cui-color-stroke-default) px-3 py-2 focus-visible:outline-1 focus-visible:outline-(--cui-color-outline)"
              >
                <ReviewList tabs={overrides.model.tabs} isScope={false} compact />
              </div>
            </div>
          )}
          {error && (
            <div
              className="flex flex-col gap-1.5 rounded-lg bg-[rgba(220,38,38,0.1)] px-3 py-2 text-sm font-medium text-(--cui-color-text-danger)"
              role="alert"
            >
              {error}
              {termsUrl && (
                <Link href={termsUrl} target="_blank" rel="noopener" size="sm" weight="medium">
                  {localize('com_config_terms_open')}
                </Link>
              )}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              htmlType="button"
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={onCancel}
              disabled={resetting}
            />
            <Button
              htmlType="button"
              type="danger"
              label={
                resetting
                  ? localize('com_config_reset_base_resetting')
                  : localize('com_config_review_reset_action', { count })
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
