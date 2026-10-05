import { Command } from 'cmdk';
import { Button, Icon } from '@clickhouse/click-ui';
import { PrincipalType } from 'librechat-data-provider';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Title as DialogTitle, Description as DialogDescription } from '@radix-ui/react-dialog';
import type { AdminGroup } from '@librechat/data-schemas';
import type * as t from '@/types';
import {
  availableScopesOptions,
  allRolesQueryOptions,
  allGroupsQueryOptions,
  createScopeFn,
  deleteScopeFn,
} from '@/server';
import { getScopeTypeConfig } from '@/constants';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

// ── Main selector ───────────────────────────────────────────────────

export function ScopeSelector({
  open,
  onOpenChange,
  currentSelection,
  onSelect,
  permissions,
  onError,
}: t.ScopeSelectorProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<t.ConfigScope | null>(null);
  const [deleting, setDeleting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: scopes = [], isLoading: loading } = useQuery({
    ...availableScopesOptions,
    enabled: open,
  });

  const { data: allRoles = [] } = useQuery({
    ...allRolesQueryOptions,
    enabled: open && showCreate,
  });

  const { data: allGroups = [] } = useQuery({
    ...allGroupsQueryOptions,
    enabled: open && showCreate,
  });

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, []);

  const resetState = useCallback(() => {
    setShowCreate(false);
    setCreating(false);
    setDeleteTarget(null);
    setDeleting(false);
  }, []);

  const close = useCallback(() => {
    onOpenChange(false);
    resetState();
  }, [onOpenChange, resetState]);

  const handleSelectBase = useCallback(() => {
    onSelect({ type: 'BASE' });
    close();
  }, [onSelect, close]);

  const handleSelectScope = useCallback(
    (scope: t.ConfigScope) => {
      onSelect({ type: 'SCOPE', scope });
      close();
    },
    [onSelect, close],
  );

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      onOpenChange(isOpen);
      if (!isOpen) {
        setSearch('');
        resetState();
      }
    },
    [onOpenChange, resetState],
  );

  const existingScopeKeys = useMemo(
    () => new Set(scopes.map((s) => `${s.principalType}:${s.principalId}`)),
    [scopes],
  );

  const availableRoles = useMemo(
    () => allRoles.filter((r) => !existingScopeKeys.has(`${PrincipalType.ROLE}:${r.id}`)),
    [allRoles, existingScopeKeys],
  );

  const availableGroups = useMemo(
    () => allGroups.filter((g) => !existingScopeKeys.has(`${PrincipalType.GROUP}:${g.id}`)),
    [allGroups, existingScopeKeys],
  );

  const handleCreateForRole = useCallback(
    async (role: t.Role) => {
      if (creating) return;
      setCreating(true);
      try {
        await createScopeFn({
          data: {
            principalType: PrincipalType.ROLE,
            name: role.name,
            priority: 10,
            principalId: role.id,
          },
        });
        await queryClient.invalidateQueries({ queryKey: ['availableScopes'] });
        resetState();
      } catch (err) {
        setCreating(false);
        onError?.(err instanceof Error ? err.message : localize('com_scope_create_error'));
      }
    },
    [creating, queryClient, resetState, onError, localize],
  );

  const handleCreateForGroup = useCallback(
    async (group: AdminGroup) => {
      if (creating) return;
      setCreating(true);
      try {
        await createScopeFn({
          data: {
            principalType: PrincipalType.GROUP,
            name: group.name,
            priority: 20,
            principalId: group.id,
          },
        });
        await queryClient.invalidateQueries({ queryKey: ['availableScopes'] });
        resetState();
      } catch (err) {
        setCreating(false);
        onError?.(err instanceof Error ? err.message : localize('com_scope_create_error'));
      }
    },
    [creating, queryClient, resetState, onError, localize],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteScopeFn({
        data: {
          principalType: deleteTarget.principalType,
          principalId: deleteTarget.principalId,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['availableScopes'] });
      if (
        currentSelection.type === 'SCOPE' &&
        currentSelection.scope.principalType === deleteTarget.principalType &&
        currentSelection.scope.principalId === deleteTarget.principalId
      ) {
        onSelect({ type: 'BASE' });
      }
      setDeleteTarget(null);
      setDeleting(false);
    } catch (err) {
      setDeleting(false);
      onError?.(err instanceof Error ? err.message : localize('com_scope_delete_error'));
    }
  }, [deleteTarget, deleting, queryClient, currentSelection, onSelect, onError, localize]);

  const roleScopes = useMemo(
    () => scopes.filter((s) => s.principalType === PrincipalType.ROLE),
    [scopes],
  );
  const groupScopes = useMemo(
    () => scopes.filter((s) => s.principalType === PrincipalType.GROUP),
    [scopes],
  );
  const userScopes = useMemo(
    () => scopes.filter((s) => s.principalType === PrincipalType.USER),
    [scopes],
  );

  const canAssign = permissions.canAssign ?? permissions.canEdit;

  if (!permissions.canView) return null;

  const baseConfig = getScopeTypeConfig('BASE');
  const roleConfig = getScopeTypeConfig(PrincipalType.ROLE);
  const groupConfig = getScopeTypeConfig(PrincipalType.GROUP);

  // ── Delete confirmation view ────────────────────────────────────────

  if (deleteTarget) {
    return (
      <Command.Dialog
        open={open}
        onOpenChange={handleOpenChange}
        label={localize('com_scope_delete')}
        overlayClassName="cmdk-overlay"
        contentClassName="cmdk-content scope-selector-dialog"
      >
        <VisuallyHidden>
          <DialogTitle>{localize('com_scope_delete')}</DialogTitle>
          <DialogDescription>{localize('com_scope_delete')}</DialogDescription>
        </VisuallyHidden>
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-(--cui-color-text-default)">
            {localize('com_scope_delete_confirm', { name: deleteTarget.name })}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-default)"
            >
              {localize('com_ui_cancel')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                deleting
                  ? 'cursor-not-allowed text-(--cui-color-text-muted)'
                  : 'cursor-pointer bg-(--cui-color-accent-danger) text-white hover:opacity-90',
              )}
            >
              {deleting ? (
                <>
                  <Icon name="loading-animated" size="xs" />
                  {localize('com_scope_deleting')}
                </>
              ) : (
                localize('com_scope_delete')
              )}
            </button>
          </div>
        </div>
      </Command.Dialog>
    );
  }

  // ── Create configuration picker (roles + groups in one view) ────────

  if (showCreate) {
    const noRoles = availableRoles.length === 0;
    const noGroups = availableGroups.length === 0;

    return (
      <Command.Dialog
        open={open}
        onOpenChange={handleOpenChange}
        label={localize('com_scope_create_new')}
        overlayClassName="cmdk-overlay"
        contentClassName="cmdk-content scope-selector-dialog"
      >
        <VisuallyHidden>
          <DialogTitle>{localize('com_scope_create_new')}</DialogTitle>
          <DialogDescription>{localize('com_scope_create_new')}</DialogDescription>
        </VisuallyHidden>
        <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default) px-4 py-3">
          <button
            type="button"
            onClick={() => setShowCreate(false)}
            className="flex cursor-pointer items-center text-(--cui-color-text-muted) hover:text-(--cui-color-text-default)"
          >
            <Icon name="chevron-left" size="sm" />
          </button>
          <span className="text-sm font-medium text-(--cui-color-text-default)">
            {localize('com_scope_create_new')}
          </span>
          {creating && (
            <span aria-hidden="true" className="ml-auto">
              <Icon name="loading-animated" size="sm" />
            </span>
          )}
        </div>
        <div ref={listRef} className="max-h-95 overflow-y-auto p-2 pb-3">
          {/* Roles section */}
          <div className="cmdk-group">
            <div className="cmdk-group-heading">{localize('com_scope_roles')}</div>
            {noRoles ? (
              <p className="px-4 py-4 text-center text-xs text-(--cui-color-text-muted)">
                {localize('com_scope_no_available_roles')}
              </p>
            ) : (
              availableRoles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => handleCreateForRole(role)}
                  disabled={creating}
                  className={cn(
                    'scope-item w-full text-left',
                    creating && 'pointer-events-none opacity-50',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="scope-icon"
                    style={{ color: roleConfig.color }}
                  >
                    <Icon name={roleConfig.icon} size="sm" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-(--cui-color-text-default)">
                      {role.name}
                    </span>
                    {role.description && (
                      <span className="text-xs text-(--cui-color-text-muted)">
                        {role.description}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Groups section */}
          <div className="cmdk-group">
            <div className="cmdk-group-heading">{localize('com_scope_groups')}</div>
            {noGroups ? (
              <p className="px-4 py-4 text-center text-xs text-(--cui-color-text-muted)">
                {localize('com_scope_no_available_groups')}
              </p>
            ) : (
              availableGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => handleCreateForGroup(group)}
                  disabled={creating}
                  className={cn(
                    'scope-item w-full text-left',
                    creating && 'pointer-events-none opacity-50',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="scope-icon"
                    style={{ color: groupConfig.color }}
                  >
                    <Icon name={groupConfig.icon} size="sm" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-(--cui-color-text-default)">
                      {group.name}
                    </span>
                    {group.description && (
                      <span className="text-xs text-(--cui-color-text-muted)">
                        {group.description}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </Command.Dialog>
    );
  }

  // ── Default: scope list view ────────────────────────────────────────

  return (
    <Command.Dialog
      open={open}
      onOpenChange={handleOpenChange}
      label={localize('com_scope_select')}
      overlayClassName="cmdk-overlay"
      contentClassName="cmdk-content scope-selector-dialog"
    >
      <VisuallyHidden>
        <DialogTitle>{localize('com_scope_select')}</DialogTitle>
        <DialogDescription>{localize('com_scope_select')}</DialogDescription>
      </VisuallyHidden>
      <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default) px-4">
        <Command.Input
          value={search}
          onValueChange={handleSearchChange}
          placeholder={localize('com_scope_search')}
          className="flex min-w-0 flex-1 bg-transparent py-3 text-sm text-(--cui-color-text-default) outline-none placeholder:text-(--cui-color-text-muted)"
        />
        {canAssign && (
          <Button
            htmlType="button"
            type="secondary"
            iconLeft="plus"
            label={localize('com_scope_create')}
            onClick={() => setShowCreate(true)}
          />
        )}
      </div>

      <Command.List ref={listRef} className="max-h-95 overflow-y-auto p-2 pb-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8">
            <span aria-hidden="true">
              <Icon name="loading-animated" size="sm" />
            </span>
            <span className="text-sm text-(--cui-color-text-muted)">
              {localize('com_ui_loading')}
            </span>
          </div>
        ) : (
          <>
            <Command.Empty className="px-4 py-8 text-center text-sm text-(--cui-color-text-muted)">
              {localize('com_scope_no_results')}
            </Command.Empty>

            <Command.Group heading={localize('com_scope_base_config')} className="cmdk-group">
              <Command.Item
                value="base-configuration"
                onSelect={handleSelectBase}
                className="scope-item"
                data-active={currentSelection.type === 'BASE'}
              >
                <span aria-hidden="true" className="scope-icon" style={{ color: baseConfig.color }}>
                  <Icon name={baseConfig.icon} size="sm" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-(--cui-color-text-default)">
                    {localize('com_scope_base_config')}
                  </span>
                  <span className="text-xs text-(--cui-color-text-muted)">
                    {localize('com_scope_base_config_desc')}
                  </span>
                </span>
                {currentSelection.type === 'BASE' && (
                  <span aria-hidden="true" className="shrink-0 text-(--cui-color-accent)">
                    <Icon name="check" size="sm" />
                  </span>
                )}
              </Command.Item>
            </Command.Group>

            {roleScopes.length > 0 && (
              <Command.Group heading={localize('com_scope_roles')} className="cmdk-group">
                {roleScopes.map((scope) => (
                  <ScopeItem
                    key={`${scope.principalType}:${scope.principalId}`}
                    scope={scope}
                    isSelected={isScopeSelected(currentSelection, scope)}
                    onSelect={handleSelectScope}
                    onDelete={canAssign ? setDeleteTarget : undefined}
                    localize={localize}
                  />
                ))}
              </Command.Group>
            )}

            {groupScopes.length > 0 && (
              <Command.Group heading={localize('com_scope_groups')} className="cmdk-group">
                {groupScopes.map((scope) => (
                  <ScopeItem
                    key={`${scope.principalType}:${scope.principalId}`}
                    scope={scope}
                    isSelected={isScopeSelected(currentSelection, scope)}
                    onSelect={handleSelectScope}
                    onDelete={canAssign ? setDeleteTarget : undefined}
                    localize={localize}
                  />
                ))}
              </Command.Group>
            )}

            {userScopes.length > 0 && (
              <Command.Group heading={localize('com_scope_users')} className="cmdk-group">
                {userScopes.map((scope) => (
                  <ScopeItem
                    key={`${scope.principalType}:${scope.principalId}`}
                    scope={scope}
                    isSelected={isScopeSelected(currentSelection, scope)}
                    onSelect={handleSelectScope}
                    localize={localize}
                  />
                ))}
              </Command.Group>
            )}
          </>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function isScopeSelected(selection: t.ScopeSelection, scope: t.ConfigScope): boolean {
  return (
    selection.type === 'SCOPE' &&
    selection.scope.principalType === scope.principalType &&
    selection.scope.principalId === scope.principalId
  );
}

interface ScopeItemProps extends t.ScopeItemProps {
  onDelete?: (scope: t.ConfigScope) => void;
}

function ScopeItem({ scope, isSelected, onSelect, onDelete, localize }: ScopeItemProps) {
  const config = getScopeTypeConfig(scope.principalType);

  const memberText =
    scope.memberCount != null ? localize('com_scope_members', { count: scope.memberCount }) : null;

  return (
    <Command.Item
      value={`${scope.principalType} ${scope.name} ${scope.principalId}`}
      onSelect={() => onSelect(scope)}
      className="scope-item group"
      data-active={isSelected}
    >
      <span aria-hidden="true" className="scope-icon" style={{ color: config.color }}>
        <Icon name={config.icon} size="sm" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-(--cui-color-text-default)">{scope.name}</span>
          {!scope.isActive && (
            <span className="rounded-sm bg-(--cui-color-background-secondary) px-1.5 py-0.5 text-[10px] font-medium text-(--cui-color-text-muted)">
              {localize('com_scope_inactive')}
            </span>
          )}
        </span>
        {memberText && <span className="text-xs text-(--cui-color-text-muted)">{memberText}</span>}
      </span>
      {isSelected && (
        <span aria-hidden="true" className="shrink-0 text-(--cui-color-accent)">
          <Icon name="check" size="sm" />
        </span>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(scope);
          }}
          className="shrink-0 cursor-pointer rounded-sm p-0.5 text-(--cui-color-text-muted) opacity-0 transition-opacity group-hover:opacity-100 group-data-[active=true]:opacity-100 group-data-[selected=true]:opacity-100 hover:text-(--cui-color-accent-danger)"
          aria-label={localize('com_scope_delete')}
          title={localize('com_scope_delete')}
        >
          <Icon name="trash" size="xs" />
        </button>
      )}
    </Command.Item>
  );
}

// ── Trigger button ──────────────────────────────────────────────────

export function ScopeTriggerButton({ currentSelection, onClick }: t.ScopeTriggerButtonProps) {
  const localize = useLocalize();

  const label =
    currentSelection.type === 'BASE'
      ? localize('com_scope_base_config')
      : currentSelection.scope.name;

  const typeKey =
    currentSelection.type === 'BASE' ? ('BASE' as const) : currentSelection.scope.principalType;
  const config = getScopeTypeConfig(typeKey);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover)"
      aria-label={`${localize('com_scope_select')}: ${label}`}
    >
      <span aria-hidden="true" style={{ color: config.color }}>
        <Icon name={config.icon} size="xs" />
      </span>
      <span>{label}</span>
      <span aria-hidden="true" className="text-(--cui-color-text-muted)">
        <Icon name="chevron-down" size="xs" />
      </span>
    </button>
  );
}
