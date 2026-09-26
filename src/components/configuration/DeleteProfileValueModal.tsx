import { Icon, Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { getScopeTypeConfig } from '@/constants';
import { useLocalize } from '@/hooks';

export function DeleteProfileValueModal({
  scope,
  fieldLabel,
  saving,
  onConfirm,
  onCancel,
}: t.DeleteProfileValueModalProps) {
  const localize = useLocalize();
  const scopeConfig = scope ? getScopeTypeConfig(scope.principalType) : null;

  return (
    <Dialog
      open={!!scope}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()}
        title={localize('com_scope_confirm_remove')}
        showClose
        onClose={onCancel}
        className="modal-frost"
      >
        {scope && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              {scopeConfig && (
                <span aria-hidden="true" style={{ color: scopeConfig.color }}>
                  <Icon name={scopeConfig.icon} size="sm" />
                </span>
              )}
              <span className="text-sm text-(--cui-color-text-default)">{fieldLabel}</span>
              <span className="text-xs text-(--cui-color-text-muted)">{scope.name}</span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="secondary"
                label={localize('com_ui_cancel')}
                onClick={onCancel}
                disabled={saving}
              />
              <Button
                type="danger"
                label={localize('com_scope_confirm_yes')}
                onClick={() => onConfirm(scope)}
                disabled={saving}
              />
            </div>
          </div>
        )}
      </Dialog.Content>
    </Dialog>
  );
}
