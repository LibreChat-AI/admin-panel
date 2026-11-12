import { useMemo } from 'react';
import { Icon } from '@clickhouse/click-ui';
import { useQuery } from '@tanstack/react-query';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { allRolesQueryOptions, allGroupsQueryOptions, availableScopesOptions } from '@/server';
import { DEFAULT_SCOPE_PRIORITY, getScopeTypeConfig } from '@/constants';
import { UserSearchInline } from '@/components/shared';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

const KINDS: t.ImportPrincipalKind[] = [
  PrincipalType.ROLE,
  PrincipalType.GROUP,
  PrincipalType.USER,
];
const KIND_LABELS: Readonly<Record<t.ImportPrincipalKind, string>> = {
  [PrincipalType.ROLE]: 'com_scope_roles',
  [PrincipalType.GROUP]: 'com_scope_groups',
  [PrincipalType.USER]: 'com_scope_users',
};
const NEW_TYPES = [PrincipalType.ROLE, PrincipalType.GROUP] as const;

function TargetOption({
  selected,
  onClick,
  icon,
  iconColor,
  label,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: t.IconName;
  iconColor: string;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-(--cui-color-accent) bg-(--cui-color-background-hover)'
          : 'border-(--cui-color-stroke-default) bg-transparent hover:bg-(--cui-color-background-hover)',
      )}
    >
      <span aria-hidden="true" style={{ color: iconColor }}>
        <Icon name={icon} size="sm" />
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium text-(--cui-color-text-default)">{label}</span>
        {description && (
          <span className="text-xs text-(--cui-color-text-muted)">{description}</span>
        )}
      </span>
    </button>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-(--cui-color-background-active) text-(--cui-color-text-default)'
              : 'text-(--cui-color-text-muted) hover:text-(--cui-color-text-default)',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Roles, groups and users as import targets, whether or not they already have a profile. */
function usePrincipals(kind: t.ImportPrincipalKind, enabled: boolean): t.ImportPrincipal[] {
  const { data: scopes = [] } = useQuery({ ...availableScopesOptions, enabled });
  const { data: roles = [] } = useQuery({
    ...allRolesQueryOptions,
    enabled: enabled && kind === PrincipalType.ROLE,
  });
  const { data: groups = [] } = useQuery({
    ...allGroupsQueryOptions,
    enabled: enabled && kind === PrincipalType.GROUP,
  });
  return useMemo(() => {
    const profiles = new Map(scopes.map((s) => [`${s.principalType}:${s.principalId}`, s]));
    const toPrincipal = (principalId: string, name: string): t.ImportPrincipal => {
      const existing = profiles.get(`${kind}:${principalId}`);
      return {
        exists: existing != null,
        scope: existing ?? {
          principalType: kind,
          principalId,
          name,
          priority: DEFAULT_SCOPE_PRIORITY[kind],
          isActive: true,
        },
      };
    };
    if (kind === PrincipalType.ROLE) return roles.map((role) => toPrincipal(role.id, role.name));
    if (kind === PrincipalType.GROUP)
      return groups.map((group) => toPrincipal(group.id, group.name));
    return scopes
      .filter((scope) => scope.principalType === PrincipalType.USER)
      .map((scope) => ({ scope, exists: true }));
  }, [kind, scopes, roles, groups]);
}

function PrincipalList({
  principals,
  selected,
  onSelect,
}: {
  principals: t.ImportPrincipal[];
  selected: t.ImportPrincipal | null;
  onSelect: (principal: t.ImportPrincipal) => void;
}) {
  const localize = useLocalize();
  if (principals.length === 0) {
    return (
      <span className="py-1 text-xs text-(--cui-color-text-muted)">
        {localize('com_config_review_import_target_none')}
      </span>
    );
  }
  return (
    <div role="radiogroup" className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
      {principals.map((principal) => {
        const { scope } = principal;
        const config = getScopeTypeConfig(scope.principalType);
        const isSelected =
          selected?.scope.principalType === scope.principalType &&
          selected.scope.principalId === scope.principalId;
        return (
          <button
            key={`${scope.principalType}:${scope.principalId}`}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(principal)}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              isSelected
                ? 'bg-(--cui-color-background-active) text-(--cui-color-text-default)'
                : 'text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)',
            )}
          >
            <span aria-hidden="true" style={{ color: config.color }}>
              <Icon name={config.icon} size="xs" />
            </span>
            <span className="min-w-0 flex-1 truncate">{scope.name}</span>
            <span className="shrink-0 text-xs text-(--cui-color-text-muted)">
              {localize(
                principal.exists
                  ? 'com_config_review_import_has_profile'
                  : 'com_config_review_import_no_profile',
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Step 2: where the import goes. Any role, group or user can be the target,
 * with or without a profile; creating a new role or group is a separate,
 * clearly labelled option because it also creates that principal.
 */
export function Targets({
  open,
  currentScope,
  mode,
  onModeChange,
  kind,
  onKindChange,
  selected,
  onSelect,
  newType,
  onNewTypeChange,
  newName,
  onNewNameChange,
}: t.ImportTargetsProps) {
  const localize = useLocalize();
  const principals = usePrincipals(kind, open && mode === 'existing');

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-(--cui-color-text-muted)">
        {localize('com_config_review_import_target_title')}
      </p>
      <div
        role="radiogroup"
        aria-label={localize('com_config_import_target')}
        className="flex flex-col gap-2"
      >
        {currentScope && (
          <TargetOption
            selected={mode === 'current'}
            onClick={() => onModeChange('current')}
            icon={getScopeTypeConfig(currentScope.principalType).icon}
            iconColor={getScopeTypeConfig(currentScope.principalType).color}
            label={localize('com_config_import_as_current', { name: currentScope.name })}
            description={localize('com_config_import_as_current_desc')}
          />
        )}
        <TargetOption
          selected={mode === 'base'}
          onClick={() => onModeChange('base')}
          icon="settings"
          iconColor={getScopeTypeConfig('BASE').color}
          label={localize('com_config_import_as_base')}
          description={localize('com_config_review_import_base_desc')}
        />
        <TargetOption
          selected={mode === 'existing'}
          onClick={() => onModeChange('existing')}
          icon="users"
          iconColor={getScopeTypeConfig(PrincipalType.GROUP).color}
          label={localize('com_config_review_import_existing')}
          description={localize('com_config_review_import_existing_desc')}
        />
        {mode === 'existing' && (
          <div className="ml-6 flex flex-col gap-2 border-l-2 border-(--cui-color-stroke-default) pl-3">
            <Segmented
              label={localize('com_config_import_scope_type')}
              value={kind}
              onChange={onKindChange}
              options={KINDS.map((value) => ({ value, label: localize(KIND_LABELS[value]) }))}
            />
            {kind === PrincipalType.USER && (
              <UserSearchInline
                existingIds={principals.map((p) => p.scope.principalId)}
                listboxId="import-user-search"
                onAdd={(user) =>
                  onSelect({
                    exists: false,
                    scope: {
                      principalType: PrincipalType.USER,
                      principalId: user.id,
                      name: user.name || user.email || user.id,
                      priority: DEFAULT_SCOPE_PRIORITY[PrincipalType.USER],
                      isActive: true,
                    },
                  })
                }
              />
            )}
            <PrincipalList
              principals={
                selected && !selected.exists && selected.scope.principalType === kind
                  ? [
                      selected,
                      ...principals.filter(
                        (p) => p.scope.principalId !== selected.scope.principalId,
                      ),
                    ]
                  : principals
              }
              selected={selected}
              onSelect={onSelect}
            />
            {selected && !selected.exists && (
              <p className="m-0 text-xs text-(--cui-color-text-muted)">
                {localize('com_config_review_import_will_create', {
                  name: selected.scope.name,
                  priority: selected.scope.priority,
                })}
              </p>
            )}
          </div>
        )}
        <TargetOption
          selected={mode === 'create'}
          onClick={() => onModeChange('create')}
          icon="plus"
          iconColor="var(--cui-color-text-muted)"
          label={localize('com_config_review_import_create')}
          description={localize('com_config_review_import_create_desc')}
        />
        {mode === 'create' && (
          <div className="ml-6 flex flex-col gap-3 border-l-2 border-(--cui-color-stroke-default) pt-1 pl-3">
            <Segmented
              label={localize('com_config_import_scope_type')}
              value={newType}
              onChange={onNewTypeChange}
              options={NEW_TYPES.map((value) => ({
                value,
                label: localize(
                  value === PrincipalType.ROLE
                    ? 'com_config_review_type_role'
                    : 'com_config_review_type_group',
                ),
              }))}
            />
            <div className="flex flex-col gap-1">
              <label
                htmlFor="import-new-scope-name"
                className="text-xs font-medium text-(--cui-color-text-muted)"
              >
                {localize('com_config_import_scope_name')}
              </label>
              <input
                id="import-new-scope-name"
                type="text"
                value={newName}
                onChange={(event) => onNewNameChange(event.target.value)}
                className="config-input w-full"
                placeholder={localize('com_config_import_scope_name_placeholder')}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
