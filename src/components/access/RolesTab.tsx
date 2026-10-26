import { useMemo, useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  LoadingState,
  Pagination,
  SearchInput,
  EmptyState,
  TrashButton,
} from '@/components/shared';
import { deleteRoleFn, allRolesQueryOptions, ROLES_PAGE_SIZE } from '@/server';
import { useCapabilities, useLocalize } from '@/hooks';
import { notifySuccess, notifyError } from '@/utils';
import { EditRoleDialog } from './EditRoleDialog';
import { SystemCapabilities } from '@/constants';
import { ConfirmDialog } from './ConfirmDialog';

export function RolesTab({ onCreateRole }: t.RolesTabProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { hasCapability } = useCapabilities();
  const canManage = hasCapability(SystemCapabilities.MANAGE_ROLES);
  const [editTarget, setEditTarget] = useState<t.Role | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<t.Role | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data: allRoles = [], isLoading, isError } = useQuery(allRolesQueryOptions);

  const filtered = useMemo(() => {
    if (!search) return allRoles;
    const q = search.toLowerCase();
    return allRoles.filter(
      (role) => role.name.toLowerCase().includes(q) || role.description.toLowerCase().includes(q),
    );
  }, [allRoles, search]);

  const totalPages = Math.ceil(filtered.length / ROLES_PAGE_SIZE);
  const paged = useMemo(
    () => filtered.slice((page - 1) * ROLES_PAGE_SIZE, page * ROLES_PAGE_SIZE),
    [filtered, page],
  );

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const deleteMutation = useMutation({
    mutationFn: (role: t.Role) => deleteRoleFn({ data: { id: role.id } }),
    onSuccess: (_data, role) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['availableScopes'] });
      queryClient.invalidateQueries({ queryKey: ['roleAssignments'] });
      queryClient.invalidateQueries({ queryKey: ['roleMembers'] });
      notifySuccess(localize('com_toast_role_deleted', { name: role.name }));
      setDeleteTarget(null);
      if (paged.length === 1) {
        setPage((prev) => (prev > 1 ? prev - 1 : prev));
      }
    },
    onError: (err: Error) => notifyError(err.message),
  });

  if (isLoading) {
    return <LoadingState />;
  }

  if (isError) {
    return <EmptyState message={localize('com_access_roles_error')} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder={localize('com_access_search_roles')}
        />
        <Button
          type="primary"
          iconLeft="plus"
          label={localize('com_access_create_role')}
          onClick={onCreateRole}
          disabled={!canManage}
          aria-disabled={!canManage || undefined}
          title={
            !canManage
              ? localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_ROLES })
              : undefined
          }
        />
      </div>

      {paged.length === 0 ? (
        <EmptyState
          message={search ? localize('com_access_no_results') : localize('com_access_roles_empty')}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {paged.map((role) => (
            <div
              key={role.id}
              className="aimo-card aimo-card-link flex items-center gap-3 py-1.5 pr-3 pl-1.5"
            >
              <button
                type="button"
                onClick={() => setEditTarget(role)}
                className="min-w-0 flex-1 cursor-pointer rounded-inner px-3.5 py-2.5 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold tracking-[-0.02em] text-ink">
                    {role.name}
                  </span>
                  {role.isSystemRole && (
                    <span className="inline-block shrink-0 rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold text-ink2">
                      {localize('com_access_system_role')}
                    </span>
                  )}
                </div>
                {role.description && (
                  <div className="mt-0.5 truncate text-sm text-muted">{role.description}</div>
                )}
              </button>

              {canManage && !role.isSystemRole && (
                <TrashButton
                  onClick={() => setDeleteTarget(role)}
                  ariaLabel={`${localize('com_ui_delete')} ${role.name}`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <EditRoleDialog
        key={editTarget?.id}
        role={editTarget}
        canManage={canManage}
        onClose={() => setEditTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={localize('com_access_delete_role_title')}
        description={localize('com_access_delete_role_desc', { name: deleteTarget?.name ?? '' })}
        confirmLabel={localize('com_ui_delete')}
        saving={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
