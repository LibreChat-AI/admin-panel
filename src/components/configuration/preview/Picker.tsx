import { Command } from 'cmdk';
import { useMemo } from 'react';
import { Button } from '@clickhouse/click-ui';
import { useQuery } from '@tanstack/react-query';
import { PrincipalType } from 'librechat-data-provider';
import type { AdminGroup } from '@librechat/data-schemas';
import type * as t from '@/types';
import {
  searchUsersFn,
  allRolesQueryOptions,
  allGroupsQueryOptions,
  availableScopesOptions,
} from '@/server';
import {
  isSameScope,
  roleCandidate,
  userCandidate,
  groupCandidate,
  toScopeCandidate,
} from '@/utils';
import { getScopeTypeConfig, MIN_USER_SEARCH_LENGTH, SCOPE_PRINCIPAL_GROUPS } from '@/constants';
import { useLocalize, useConfigFeatures, useDebouncedFilter } from '@/hooks';
import { DecorativeIcon } from '@/components/shared';

const SCOPE_TYPES: ReadonlySet<string> = new Set(SCOPE_PRINCIPAL_GROUPS.map(({ type }) => type));
const NO_SCOPES: t.ConfigScope[] = [];
const NO_ROLES: t.Role[] = [];
const NO_GROUPS: AdminGroup[] = [];

function principalKey(principal: t.ConfigPrincipal): string {
  return `${principal.principalType}:${principal.principalId}`;
}

/** Candidates of every type, each once: the listed principals, then the profiles not among them. */
function mergeCandidates(
  listed: t.ScopeCandidate[],
  scopes: readonly t.ConfigScope[],
): Record<t.ScopePrincipalType, t.ScopeCandidate[]> {
  const byType: Record<t.ScopePrincipalType, t.ScopeCandidate[]> = {
    [PrincipalType.ROLE]: [],
    [PrincipalType.GROUP]: [],
    [PrincipalType.USER]: [],
  };
  const seen = new Set<string>();
  const add = (candidate: t.ScopeCandidate) => {
    const key = principalKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    byType[candidate.principalType].push(candidate);
  };
  listed.forEach(add);
  for (const scope of scopes) {
    if (SCOPE_TYPES.has(scope.principalType)) add(toScopeCandidate(scope));
  }
  return byType;
}

/**
 * Who to preview the configuration for: everyone (Base), or a role, group or
 * user. A server that resolves configs (`resolvedApi`) previews any of them,
 * with or without a profile; otherwise only the principals that have a
 * profile are offered, since the panel estimates the preview from it.
 */
export function PreviewPicker({ target, onPick, onCancel }: t.PreviewPickerProps) {
  const localize = useLocalize();
  const { resolvedApi } = useConfigFeatures();
  const userFilter = useDebouncedFilter('', () => undefined);
  const userQuery = userFilter.debouncedValue.trim();
  const searchesUsers = resolvedApi && userQuery.length >= MIN_USER_SEARCH_LENGTH;

  const { data: scopes = NO_SCOPES } = useQuery(availableScopesOptions);
  const { data: roles = NO_ROLES } = useQuery({ ...allRolesQueryOptions, enabled: resolvedApi });
  const { data: groups = NO_GROUPS } = useQuery({
    ...allGroupsQueryOptions,
    enabled: resolvedApi,
  });
  const users = useQuery({
    queryKey: ['scopeUserSearch', userQuery],
    queryFn: () => searchUsersFn({ data: { query: userQuery } }).then((r) => r.users),
    enabled: searchesUsers,
    staleTime: 30_000,
  });

  const profileKeys = useMemo(() => new Set(scopes.map(principalKey)), [scopes]);
  const candidates = useMemo(() => {
    if (!resolvedApi) return mergeCandidates([], scopes);
    const listed = [
      ...roles.map(roleCandidate),
      ...groups.map(groupCandidate),
      ...(users.data ?? []).map(userCandidate),
    ];
    return mergeCandidates(listed, scopes);
  }, [resolvedApi, roles, groups, users.data, scopes]);

  const isCurrent = (candidate: t.ScopeCandidate | null): boolean => {
    if (!candidate) return target.type === 'BASE';
    return target.type === 'PRINCIPAL' && isSameScope(target.principal, candidate);
  };

  const userHint = (): string | null => {
    if (!resolvedApi) return null;
    if (userQuery.length < MIN_USER_SEARCH_LENGTH) {
      return localize('com_config_preview_user_hint', { count: MIN_USER_SEARCH_LENGTH });
    }
    if (users.isError) return localize('com_scope_user_search_error');
    if (users.data?.length === 0) return localize('com_scope_user_search_empty');
    return null;
  };

  const baseConfig = getScopeTypeConfig('BASE');
  const hint = userHint();

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <p className="m-0 text-xs text-(--cui-color-text-muted)">
        {localize(
          resolvedApi ? 'com_config_preview_pick_desc' : 'com_config_preview_pick_desc_profiles',
        )}
      </p>
      <Command
        label={localize('com_config_preview_pick')}
        className="flex min-h-0 flex-col rounded-lg border border-(--cui-color-stroke-default)"
      >
        <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default) px-3">
          <DecorativeIcon name="search" size="sm" />
          <Command.Input
            autoFocus
            value={userFilter.value}
            onValueChange={userFilter.onChange}
            placeholder={localize(
              resolvedApi ? 'com_config_preview_search' : 'com_config_preview_search_profiles',
            )}
            className="flex min-w-0 flex-1 bg-transparent py-2.5 text-sm text-(--cui-color-text-default) outline-none placeholder:text-(--cui-color-text-muted)"
          />
          {users.isFetching && (
            <span aria-hidden="true" className="shrink-0">
              <DecorativeIcon name="loading-animated" size="sm" />
            </span>
          )}
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="px-2 py-3 text-sm text-(--cui-color-text-muted)">
            {localize('com_config_preview_pick_empty')}
          </Command.Empty>
          <Command.Group heading={localize('com_config_preview_everyone')} className="cmdk-group">
            <Command.Item
              value={`base ${localize('com_scope_base_config')}`}
              onSelect={() => onPick({ type: 'BASE' })}
              data-active={isCurrent(null) || undefined}
              className="scope-item"
            >
              <span aria-hidden="true" className="scope-icon" style={{ color: baseConfig.color }}>
                <DecorativeIcon name={baseConfig.icon} size="sm" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-(--cui-color-text-default)">
                  {localize('com_scope_base_config')}
                </span>
                <span className="truncate text-xs text-(--cui-color-text-muted)">
                  {localize('com_config_preview_base_desc')}
                </span>
              </span>
            </Command.Item>
          </Command.Group>
          {SCOPE_PRINCIPAL_GROUPS.map(({ type, headingKey }) => {
            const config = getScopeTypeConfig(type);
            const items = candidates[type];
            const showsHint = type === PrincipalType.USER && hint != null;
            if (items.length === 0 && !showsHint) return null;
            return (
              <Command.Group
                key={type}
                heading={localize(headingKey)}
                className="cmdk-group"
                forceMount={showsHint || undefined}
              >
                {items.map((candidate) => {
                  const key = principalKey(candidate);
                  const detail = candidate.email || candidate.description;
                  return (
                    <Command.Item
                      key={key}
                      value={`${key} ${candidate.name} ${candidate.email ?? ''} ${candidate.description ?? ''}`}
                      onSelect={() => onPick({ type: 'PRINCIPAL', principal: candidate })}
                      data-active={isCurrent(candidate) || undefined}
                      className="scope-item"
                    >
                      <span
                        aria-hidden="true"
                        className="scope-icon"
                        style={{ color: config.color }}
                      >
                        <DecorativeIcon name={config.icon} size="sm" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-(--cui-color-text-default)">
                          {candidate.name}
                        </span>
                        {detail && (
                          <span className="truncate text-xs text-(--cui-color-text-muted)">
                            {detail}
                          </span>
                        )}
                      </span>
                      {profileKeys.has(key) && (
                        <span className="shrink-0 text-xs text-(--cui-color-text-muted)">
                          {localize('com_config_preview_has_profile')}
                        </span>
                      )}
                    </Command.Item>
                  );
                })}
                {showsHint && (
                  <p className="m-0 px-2 py-1.5 text-xs text-(--cui-color-text-muted)">{hint}</p>
                )}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command>
      <div className="flex justify-end">
        <Button
          htmlType="button"
          type="secondary"
          label={localize('com_ui_cancel')}
          onClick={onCancel}
        />
      </div>
    </div>
  );
}
