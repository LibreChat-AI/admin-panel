import { useEffect, useState } from 'react';
import type * as t from '@/types';
import { cn } from '@/utils';
import { FormDialog } from '@/components/shared';
import { useLocalize } from '@/hooks';

/** 组名：1..64 个非空白字符（2.17.0 放宽，允许中文显示组名）。 */
const NAME_RE = /^[^|\s]{1,64}$/;
/** 常用 Nextcloud 角色组；"*"=全部。 */
const KNOWN_GROUPS = ['team-manager', 'team-editor', 'team-viewer'];

/** Create / edit a display group (2.17.0): metadata + the group's visibility
 * domains. Name is only settable at creation. An empty allowed_groups list
 * means "no restriction" — every logged-in user sees the group's tools. */
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
  const [allowedGroups, setAllowedGroups] = useState<string[]>([]);
  const [customGroup, setCustomGroup] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? '');
      setDisplayName(group?.display_name ?? '');
      setDescription(group?.description ?? '');
      setSortOrder(String(group?.sort_order ?? 0));
      setAllowedGroups(group?.allowed_groups ?? []);
      setCustomGroup('');
      setClientError(null);
    }
  }, [open, group]);

  const chipNames = [
    ...new Set(['*', ...KNOWN_GROUPS, ...allowedGroups.filter((g) => g !== '*')]),
  ];

  const toggleGroup = (name: string) =>
    setAllowedGroups((prev) =>
      prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name],
    );

  const addCustomGroup = () => {
    const next = customGroup.trim();
    if (next && !allowedGroups.includes(next)) {
      setAllowedGroups((prev) => [...prev, next]);
    }
    setCustomGroup('');
  };

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
      allowed_groups: allowedGroups,
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
              className="config-input w-full"
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
        <div>
          <span className="mb-1 block font-medium">
            {localize('com_tools_group_allowed_groups')}
          </span>
          <div className="flex flex-wrap gap-2">
            {chipNames.map((name) => {
              const active = allowedGroups.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleGroup(name)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    active
                      ? 'border-(--cui-color-accent-primary) bg-(--cui-color-accent-primary-muted) text-(--cui-color-text-default)'
                      : 'border-(--cui-color-stroke-default) text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover)',
                  )}
                >
                  {name === '*' ? localize('com_tools_all_groups') : name}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="config-input w-full max-w-48"
              value={customGroup}
              placeholder={localize('com_services_group_custom_placeholder')}
              onChange={(e) => setCustomGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustomGroup();
                }
              }}
            />
            <button
              type="button"
              className="shrink-0 rounded-lg border border-(--cui-color-stroke-default) px-3 py-1 text-xs transition-colors hover:bg-(--cui-color-background-hover)"
              onClick={addCustomGroup}
            >
              {localize('com_services_group_add')}
            </button>
          </div>
          <p className="mt-1 text-xs text-(--cui-color-text-muted)">
            {localize('com_tools_group_allowed_hint')}
          </p>
        </div>
      </div>
    </FormDialog>
  );
}
