import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@clickhouse/click-ui';
import type { TerraVoxGroup } from '@/server';
import {
  createToolGroupFn,
  deleteToolGroupFn,
  toolGroupsQueryOptions,
  updateToolGroupFn,
} from '@/server';
import { EmptyState, InlineAction, LoadingState } from '@/components/shared';
import { ConfirmDialog } from '@/components/access';
import { useLocalize } from '@/hooks';
import { ToolGroupEditDialog } from './ToolGroupEditDialog';

const TAG_STYLE =
  'rounded-full border border-(--cui-color-stroke-default) px-2 py-0.5 text-xs text-(--cui-color-text-muted)';
const IMPLICIT_STYLE =
  'rounded-full bg-(--cui-color-background-muted) px-2 py-0.5 text-xs text-(--cui-color-text-muted)';

/**
 * Group cards: each group is a tool_id namespace. Explicit groups carry admin
 * metadata; implicit ones exist only because tools with that prefix exist —
 * editing one promotes it to explicit (upsert on the gateway), deleting is
 * blocked while any tool still lives in the namespace.
 */
export function ToolGroupsTab() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<TerraVoxGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TerraVoxGroup | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);

  const groupsQuery = useQuery(toolGroupsQueryOptions);
  const groups = groupsQuery.data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['terravox'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (input: {
      name?: string;
      display_name: string;
      description: string;
      sort_order: number;
      allowed_groups: string[];
    }) =>
      input.name
        ? createToolGroupFn({ data: input })
        : updateToolGroupFn({
            data: {
              name: editing!.name,
              display_name: input.display_name,
              description: input.description,
              sort_order: input.sort_order,
              allowed_groups: input.allowed_groups,
            },
          }),
    onSuccess: () => {
      setEditOpen(false);
      setEditing(null);
      setMutError(null);
      invalidate();
    },
    onError: () => {
      /* dialog stays open and shows the error */
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteToolGroupFn({ data: { name } }),
    onSuccess: () => {
      setDeleteTarget(null);
      setMutError(null);
      invalidate();
    },
    onError: (error: Error) => setMutError(error.message),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-(--cui-color-text-muted)">{localize('com_tools_groups_hint')}</p>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setEditOpen(true);
          }}
          className="ms-auto flex items-center gap-1.5 rounded-lg bg-(--cui-color-accent-primary) px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90"
        >
          <Icon name="plus" size="sm" />
          {localize('com_tools_group_add_button')}
        </button>
      </div>

      {mutError && (
        <p role="alert" className="text-sm text-(--cui-color-text-danger)">
          {mutError}
        </p>
      )}

      {groupsQuery.isLoading && <LoadingState />}
      {groupsQuery.isError && (
        <EmptyState
          message={(groupsQuery.error as Error)?.message ?? localize('com_tools_retry_later')}
        />
      )}
      {!groupsQuery.isLoading && !groupsQuery.isError && groups.length === 0 && (
        <EmptyState message={localize('com_tools_groups_empty')} />
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <div
            key={group.name}
            className="flex flex-col gap-2 rounded-lg border border-(--cui-color-stroke-default) p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-(--cui-color-text-default)">
                    {group.display_name || group.name}
                  </span>
                  {!group.explicit && (
                    <span className={IMPLICIT_STYLE}>{localize('com_tools_group_implicit')}</span>
                  )}
                </div>
                <code className="text-xs text-(--cui-color-text-muted)">{group.name}</code>
              </div>
              {/* 行内操作（2.19.0）：平铺按钮替代三点菜单 */}
              <div className="flex shrink-0 items-center gap-1">
                <InlineAction
                  label={localize('com_ui_edit')}
                  onClick={() => {
                    setEditing(group);
                    setEditOpen(true);
                  }}
                >
                  ✎
                </InlineAction>
                <InlineAction
                  label={localize('com_ui_delete')}
                  danger
                  onClick={() => setDeleteTarget(group)}
                >
                  ✕
                </InlineAction>
              </div>
            </div>
            {group.description && (
              <p className="line-clamp-2 text-xs text-(--cui-color-text-muted)">
                {group.description}
              </p>
            )}
            {group.allowed_groups.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {group.allowed_groups.map((name) => (
                  <span key={name} className={TAG_STYLE}>
                    {name === '*' ? localize('com_tools_all_groups') : name}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-auto flex items-center gap-2 pt-1">
              <span className={TAG_STYLE}>
                {localize('com_tools_group_tool_count', { count: group.tool_count })}
              </span>
              <span className={TAG_STYLE}>
                {localize('com_tools_group_sort', { order: group.sort_order })}
              </span>
            </div>
          </div>
        ))}
      </div>

      <ToolGroupEditDialog
        open={editOpen}
        group={editing}
        saving={saveMutation.isPending}
        error={saveMutation.isError ? (saveMutation.error as Error).message : undefined}
        onSubmit={(input) => saveMutation.mutate(input)}
        onClose={() => {
          setEditOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={localize('com_tools_group_delete_title')}
        description={
          (deleteTarget?.tool_count ?? 0) > 0
            ? localize('com_tools_group_delete_not_empty', { count: deleteTarget?.tool_count ?? 0 })
            : localize('com_tools_group_delete_desc', { name: deleteTarget?.name ?? '' })
        }
        confirmLabel={localize('com_ui_delete')}
        saving={deleteMutation.isPending}
        error={deleteMutation.isError ? (deleteMutation.error as Error).message : undefined}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.name)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
