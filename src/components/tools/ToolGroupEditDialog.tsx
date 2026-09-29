import { useEffect, useState } from 'react';
import type * as t from '@/types';
import { FormDialog } from '@/components/shared';
import { useLocalize } from '@/hooks';

const NAME_RE = /^[a-z0-9_-]+$/;

/** Create / edit a group's explicit metadata. Namespace (name) is only
 * settable at creation — it is the tool_id prefix tools live under. */
export function ToolGroupEditDialog({
  open,
  group,
  saving,
  error,
  onSubmit,
  onClose,
}: t.ToolGroupEditDialogProps) {
  const localize = useLocalize();
  const isEdit = group !== null;
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? '');
      setDisplayName(group?.display_name ?? '');
      setDescription(group?.description ?? '');
      setSortOrder(String(group?.sort_order ?? 0));
      setClientError(null);
    }
  }, [open, group]);

  const handleSubmit = () => {
    setClientError(null);
    if (!isEdit && !NAME_RE.test(name.trim())) {
      setClientError(localize('com_tools_group_err_name'));
      return;
    }
    onSubmit({
      ...(isEdit ? {} : { name: name.trim() }),
      display_name: displayName.trim(),
      description: description.trim(),
      sort_order: Number(sortOrder) || 0,
    });
  };

  return (
    <FormDialog
      open={open}
      title={localize(isEdit ? 'com_tools_group_edit_title' : 'com_tools_group_add_title')}
      submitLabel={localize(isEdit ? 'com_tools_save' : 'com_tools_create')}
      saving={saving}
      error={clientError ?? error}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 text-sm">
        {isEdit ? (
          <div>
            <label className="mb-1 block font-medium" htmlFor="group-name">
              {localize('com_tools_group_field_name')}
            </label>
            <code className="config-input-mono block w-full rounded-md border border-(--cui-color-stroke-default) bg-(--cui-color-background-muted) px-2.5 py-1.5 text-xs">
              {group.name}
            </code>
          </div>
        ) : (
          <div>
            <label className="mb-1 block font-medium" htmlFor="group-name">
              {localize('com_tools_group_field_name')}
            </label>
            <input
              id="group-name"
              className="config-input w-full font-mono"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="spatial"
            />
            <p className="mt-1 text-xs text-(--cui-color-text-muted)">
              {localize('com_tools_group_name_hint')}
            </p>
          </div>
        )}
        <div>
          <label className="mb-1 block font-medium" htmlFor="group-display">
            {localize('com_tools_group_field_display_name')}
          </label>
          <input
            id="group-display"
            className="config-input w-full"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block font-medium" htmlFor="group-desc">
            {localize('com_tools_group_field_description')}
          </label>
          <textarea
            id="group-desc"
            className="config-input min-h-16 w-full resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block font-medium" htmlFor="group-sort">
            {localize('com_tools_group_field_sort_order')}
          </label>
          <input
            id="group-sort"
            type="number"
            className="config-input w-32"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
          <p className="mt-1 text-xs text-(--cui-color-text-muted)">
            {localize('com_tools_group_sort_hint')}
          </p>
        </div>
      </div>
    </FormDialog>
  );
}
