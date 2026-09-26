import { Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

const sizeClasses: Record<string, string> = {
  sm: '',
  lg: '!max-w-2xl',
};

export function FormDialog({
  open,
  title,
  submitLabel,
  submitDisabled,
  saving,
  error,
  size,
  onSubmit,
  onClose,
  children,
}: t.FormDialogProps) {
  const localize = useLocalize();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()}
        title={title}
        showClose
        onClose={onClose}
        className={cn('modal-frost', size && sizeClasses[size])}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {children}
          {error && (
            <p role="alert" className="text-sm text-(--cui-color-text-danger)">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={onClose}
              disabled={saving}
            />
            <Button
              type="primary"
              label={submitLabel}
              disabled={submitDisabled || saving}
            />
          </div>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}
