import { Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useReturnFocus, useLocalize, useDiscardPrompt } from '@/hooks';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { DiscardConfirm } from './DiscardConfirm';
import { cn } from '@/utils';

const sizeClasses: Record<string, string> = {
  sm: '',
  lg: '!max-w-2xl',
};

/** Text-like inputs, where Enter would otherwise submit the form implicitly. */
function isTextInput(target: EventTarget): boolean {
  return (
    target instanceof HTMLInputElement &&
    !['checkbox', 'radio', 'button', 'submit'].includes(target.type)
  );
}

/**
 * A dialog wrapping one form (VS-11): the title stays at the top and the
 * error and Cancel/Submit footer at the bottom while only the fields scroll,
 * so long forms (Create MCP server) keep their actions in reach. With a
 * `discardPrompt`, Escape, Cancel and the close button first ask before what
 * was typed is thrown away; asked again (a second Escape), the form stays
 * open, so only Discard throws the draft away.
 */
export function FormDialog({
  open,
  title,
  submitLabel,
  submitDisabled,
  saving,
  error,
  hint,
  size,
  discardPrompt,
  submitOnEnter = true,
  onSubmit,
  onClose,
  children,
}: t.FormDialogProps) {
  const localize = useLocalize();
  const returnFocus = useReturnFocus(open);
  const prompt = useDiscardPrompt();
  const asking = prompt.confirming && discardPrompt != null;

  const close = () => {
    prompt.dismiss();
    onClose();
  };
  const requestClose = () => {
    if (discardPrompt == null) {
      close();
      return;
    }
    prompt.request();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) requestClose();
      }}
    >
      <Dialog.Content
        title={title}
        showClose
        onClose={requestClose}
        onCloseAutoFocus={returnFocus}
        className={cn('modal-frost form-dialog-content', size && sizeClasses[size])}
      >
        <form
          ref={(el) => {
            prompt.formRef.current = el;
          }}
          onSubmit={handleSubmit}
          onInput={prompt.dismiss}
          onKeyDown={(e) => {
            if (!submitOnEnter && e.key === 'Enter' && isTextInput(e.target)) e.preventDefault();
          }}
          className="form-dialog-form"
        >
          <div className="form-dialog-body">
            <RowFilterContext.Provider value={null}>{children}</RowFilterContext.Provider>
          </div>
          <div className="form-dialog-footer">
            {asking ? (
              <DiscardConfirm message={discardPrompt} onKeep={prompt.keep} onDiscard={close} />
            ) : (
              <>
                {error && (
                  <p role="alert" className="m-0 text-sm text-(--cui-color-text-danger)">
                    {error}
                  </p>
                )}
                {!error && hint && (
                  <p className="m-0 text-sm text-(--cui-color-text-muted)">{hint}</p>
                )}
                <div className="flex items-center justify-end gap-2">
                  <Button
                    htmlType="button"
                    type="secondary"
                    label={localize('com_ui_cancel')}
                    onClick={requestClose}
                    disabled={saving}
                  />
                  <Button
                    htmlType="submit"
                    type="primary"
                    label={submitLabel}
                    disabled={submitDisabled || saving}
                  />
                </div>
              </>
            )}
          </div>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}
