import { useCallback, useState } from 'react';
import type * as t from '@/types';
import { DeleteProfileValueModal } from './DeleteProfileValueModal';
import { EditButton, TrashButton } from '@/components/shared';
import { useProfileMutations, useLocalize } from '@/hooks';
import { ProfileValueModal } from './ProfileValueModal';
import { getControlType } from './controls';

export function PreviewProfileActions({
  fieldPath,
  fieldLabel,
  fieldSchema,
  scope,
  currentValue,
  onProfileChange,
}: t.PreviewProfileActionsProps) {
  const localize = useLocalize();
  const [deleteScope, setDeleteScope] = useState<t.ConfigScope | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState<t.ConfigValue>(currentValue);

  const controlType = fieldSchema ? getControlType(fieldSchema) : 'text';

  const {
    saveMutation,
    removeMutation,
    saving: busy,
  } = useProfileMutations({
    fieldPath,
    onProfileChange,
  });

  const handleEdit = useCallback(() => {
    setEditValue(currentValue);
    setEditOpen(true);
  }, [currentValue]);

  const handleEditSave = useCallback(() => {
    saveMutation.mutate(
      { principalType: scope.principalType, principalId: scope.principalId, value: editValue },
      { onSuccess: () => setEditOpen(false) },
    );
  }, [scope, editValue, saveMutation]);

  return (
    <>
      <span className="inline-flex items-center gap-0.5">
        <EditButton
          onClick={handleEdit}
          ariaLabel={`${localize('com_scope_edit_profile_value')}: ${fieldLabel}`}
          disabled={busy}
        />
        <TrashButton
          onClick={() => setDeleteScope(scope)}
          ariaLabel={`${localize('com_scope_remove_profile_value')}: ${fieldLabel}`}
          disabled={busy}
        />
      </span>

      <ProfileValueModal
        open={editOpen}
        fieldSchema={fieldSchema}
        controlType={controlType}
        value={editValue}
        onChange={setEditValue}
        onSave={handleEditSave}
        onCancel={() => setEditOpen(false)}
        saving={busy}
        scopeName={scope.name}
        scopeType={scope.principalType}
        mode="edit"
      />

      <DeleteProfileValueModal
        scope={deleteScope}
        fieldLabel={fieldLabel}
        saving={busy}
        onConfirm={(s) => {
          removeMutation.mutate(
            { principalType: s.principalType, principalId: s.principalId },
            { onSuccess: () => setDeleteScope(null) },
          );
        }}
        onCancel={() => setDeleteScope(null)}
      />
    </>
  );
}
