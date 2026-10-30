import { Button } from '@clickhouse/click-ui';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { AdminGroup } from '@librechat/data-schemas';
import type * as t from '@/types';
import {
  LoadingState,
  SearchInput,
  EmptyState,
  Pagination,
  ScreenReaderAnnouncer,
  TrashButton,
} from '@/components/shared';
import { deleteGroupFn, groupsQueryOptions, GROUPS_PAGE_SIZE, MAX_SEARCH_LENGTH } from '@/server';
import { useLocalize, useAnnouncement, useCapabilities, useRefreshScopes } from '@/hooks';
import { cn, notifySuccess, notifyError } from '@/utils';
import { EditGroupDialog } from './EditGroupDialog';
import { SystemCapabilities } from '@/constants';
import { ConfirmDialog } from './ConfirmDialog';

export function GroupsTab({ onCreateGroup }: t.GroupsTabProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const refreshScopes = useRefreshScopes();
  const { hasCapability } = useCapabilities();
  const canManage = hasCapability(SystemCapabilities.MANAGE_GROUPS);
  const [editTarget, setEditTarget] = useState<AdminGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminGroup | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { message: announcement, announce } = useAnnouncement();
  const announcedSearch = useRef(debouncedSearch);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchField = useCallback(() => searchRef.current, []);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const handleSearchChange = (value: string) => {
    const clamped = value.slice(0, MAX_SEARCH_LENGTH);
    setSearch(clamped);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(clamped);
      setPage(1);
    }, 300);
  };

  const { data, isLoading, isError, isFetching } = useQuery({
    ...groupsQueryOptions(page, debouncedSearch),
    placeholderData: keepPreviousData,
  });

  const groups = data?.groups ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / GROUPS_PAGE_SIZE);

  /** Announces the match count once each new search has loaded; the first load stays quiet. */
  useEffect(() => {
    if (isFetching || isError || announcedSearch.current === debouncedSearch) return;
    announcedSearch.current = debouncedSearch;
    announce(localize('com_a11y_groups_found', { count: total }));
  }, [debouncedSearch, isFetching, isError, total, announce, localize]);

  const deleteMutation = useMutation({
    mutationFn: (group: AdminGroup) => deleteGroupFn({ data: { id: group.id } }),
    onSuccess: (_data, group) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      void refreshScopes();
      queryClient.invalidateQueries({ queryKey: ['groupAssignments'] });
      queryClient.invalidateQueries({ queryKey: ['groupMembers'] });
      notifySuccess(localize('com_toast_group_deleted', { name: group.name }));
      setDeleteTarget(null);
      if (groups.length === 1) {
        setPage((prev) => (prev > 1 ? prev - 1 : prev));
      }
    },
    onError: (err: Error) => notifyError(err.message),
  });

  if (isLoading && !data) {
    return <LoadingState />;
  }

  if (isError && !data) {
    return (
      <div role="alert" className="px-4 py-8 text-center text-sm text-(--cui-color-text-danger)">
        {localize('com_error_load_groups')}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-2 pe-1">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          inputRef={searchRef}
          value={search}
          onChange={handleSearchChange}
          placeholder={localize('com_access_search_groups')}
        />
        <Button
          htmlType="button"
          type="secondary"
          iconLeft="plus"
          label={localize('com_access_create_group')}
          onClick={onCreateGroup}
          disabled={!canManage}
          aria-disabled={!canManage || undefined}
          title={
            !canManage
              ? localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_GROUPS })
              : undefined
          }
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState message={localize('com_access_groups_empty')} />
      ) : (
        <div className={cn('flex flex-col', isFetching && 'opacity-60 transition-opacity')}>
          {groups.map((group) => (
            <div
              key={group.id}
              className="mb-2 flex items-center gap-3 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) px-3 py-3"
            >
              <button
                type="button"
                onClick={() => setEditTarget(group)}
                className="-my-2 -ms-2 min-w-0 flex-1 cursor-pointer rounded py-3 ps-3 text-start outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--cui-color-outline) focus-visible:outline-solid"
              >
                <div className="text-sm font-medium text-(--cui-color-text-default) hover:underline">
                  {group.name}
                </div>
                {group.description && (
                  <div className="truncate text-xs text-(--cui-color-text-muted)">
                    {group.description}
                  </div>
                )}
              </button>

              {canManage && (
                <TrashButton
                  onClick={() => setDeleteTarget(group)}
                  ariaLabel={`${localize('com_ui_delete')} ${group.name}`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <EditGroupDialog
        key={editTarget?.id}
        group={editTarget}
        canManage={canManage}
        onClose={() => setEditTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={localize('com_access_delete_group_title')}
        description={localize('com_access_delete_group_desc', { name: deleteTarget?.name ?? '' })}
        confirmLabel={localize('com_ui_delete')}
        saving={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
        returnFocusTo={searchField}
      />

      <ScreenReaderAnnouncer message={announcement} />
    </div>
  );
}
