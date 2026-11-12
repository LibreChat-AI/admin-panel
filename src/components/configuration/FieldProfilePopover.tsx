import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { formatScopeName, maskSecretValues } from '@/utils';
import { useFieldState, useLocalize } from '@/hooks';
import { fieldProfileValuesOptions } from '@/server';
import { getScopeTypeConfig } from '@/constants';

function principalKey(scope: t.ConfigScope): string {
  return `${scope.principalType}:${scope.principalId}`;
}

function isHiddenAt(scope: t.ConfigScope, path: string): boolean {
  return (scope.tombstones ?? []).some(
    (hidden) => path === hidden || path.startsWith(`${hidden}.`),
  );
}

function formatValue(value: t.ConfigValue | undefined, key: string): string {
  const masked = maskSecretValues(value, key);
  if (masked === undefined || masked === null || masked === '') return '—';
  if (typeof masked === 'string') return masked;
  return JSON.stringify(masked);
}

/**
 * Read-only cascade of one field: the Base value, then each profile that
 * overrides it, lowest priority first, each with a way to open that profile
 * (WS8: PR-8). Edits go through the profile itself, so they are reviewed and
 * saved like any other change.
 */
export function FieldProfilePopover({
  fieldPath,
  profiles,
  onOpenProfile,
}: t.FieldCascadeListProps) {
  const localize = useLocalize();
  const base = useFieldState(fieldPath);
  const key = fieldPath.slice(fieldPath.lastIndexOf('.') + 1);
  const { data: values, isLoading } = useQuery(fieldProfileValuesOptions(fieldPath));
  const valueByScope = new Map((values ?? []).map((v) => [principalKey(v.scope), v.value]));
  const baseConfig = getScopeTypeConfig('BASE');
  const describeProfileValue = (
    hidden: boolean,
    loading: boolean,
    value: t.ConfigValue | undefined,
  ): string => {
    if (hidden) return localize('com_scope_cascade_hidden');
    if (loading) return localize('com_ui_loading');
    return formatValue(value, key);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-(--cui-color-text-muted)">{localize('com_scope_cascade_help')}</p>
      <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        <li className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <span aria-hidden="true" className="scope-icon" style={{ color: baseConfig.color }}>
            <Icon name={baseConfig.icon} size="sm" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-(--cui-color-text-default)">
              {localize('com_scope_base_config')}
            </span>
            <span className="text-xs wrap-break-word text-(--cui-color-text-muted)">
              {formatValue(base.effective, key)}
            </span>
          </span>
        </li>
        {profiles.map((scope) => {
          const config = getScopeTypeConfig(scope.principalType);
          const hidden = isHiddenAt(scope, fieldPath);
          const value = describeProfileValue(
            hidden,
            isLoading,
            valueByScope.get(principalKey(scope)),
          );
          return (
            <li
              key={principalKey(scope)}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5"
            >
              <span aria-hidden="true" className="scope-icon" style={{ color: config.color }}>
                <Icon name={config.icon} size="sm" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-(--cui-color-text-default)">
                    {formatScopeName(scope)}
                  </span>
                  <span className="shrink-0 text-xs text-(--cui-color-text-muted)">
                    {localize('com_scope_priority', { priority: scope.priority })}
                  </span>
                  {!scope.isActive && (
                    <Badge text={localize('com_scope_inactive')} state="warning" size="sm" />
                  )}
                </span>
                <span className="text-xs wrap-break-word text-(--cui-color-text-muted)">
                  {value}
                </span>
              </span>
              <Button
                htmlType="button"
                type="secondary"
                label={localize('com_scope_cascade_open')}
                onClick={() => onOpenProfile(scope)}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
