import { useState } from 'react';
import { Icon, Switch } from '@clickhouse/click-ui';
import { PermissionTypes } from 'librechat-data-provider';
import type * as t from '@/types';
import { PERMISSION_TYPE_SCHEMA } from '@/constants';
import { useLocalize, usePilotMode } from '@/hooks';
import { cn } from '@/utils';

const PERMISSION_TYPE_ORDER: PermissionTypes[] = [
  PermissionTypes.PROMPTS,
  PermissionTypes.AGENTS,
  PermissionTypes.MEMORIES,
  PermissionTypes.MCP_SERVERS,
  PermissionTypes.REMOTE_AGENTS,
  PermissionTypes.SKILLS,
  PermissionTypes.SHARED_LINKS,
  PermissionTypes.BOOKMARKS,
  PermissionTypes.MULTI_CONVO,
  PermissionTypes.TEMPORARY_CHAT,
  PermissionTypes.RUN_CODE,
  PermissionTypes.WEB_SEARCH,
  PermissionTypes.FILE_SEARCH,
  PermissionTypes.FILE_CITATIONS,
  PermissionTypes.PEOPLE_PICKER,
  PermissionTypes.MARKETPLACE,
];

const PILOT_BLOCKED_PERMISSIONS = new Set<PermissionTypes>([
  PermissionTypes.AGENTS,
  PermissionTypes.MEMORIES,
  PermissionTypes.MCP_SERVERS,
  PermissionTypes.REMOTE_AGENTS,
  PermissionTypes.SKILLS,
  PermissionTypes.MULTI_CONVO,
  PermissionTypes.RUN_CODE,
  PermissionTypes.WEB_SEARCH,
  PermissionTypes.FILE_SEARCH,
  PermissionTypes.FILE_CITATIONS,
  PermissionTypes.MARKETPLACE,
]);

const multiPermTypes = PERMISSION_TYPE_ORDER.filter((pt) => PERMISSION_TYPE_SCHEMA[pt].length > 1);
const singlePermTypes = PERMISSION_TYPE_ORDER.filter(
  (pt) => PERMISSION_TYPE_SCHEMA[pt].length === 1,
);

export function RolePermissionsPanel({
  permissions,
  onChange,
  disabled,
}: t.RolePermissionsPanelProps) {
  const localize = useLocalize();
  const pilotEnabled = usePilotMode();
  const visibleMultiPermTypes = pilotEnabled
    ? multiPermTypes.filter((type) => !PILOT_BLOCKED_PERMISSIONS.has(type))
    : multiPermTypes;
  const visibleSinglePermTypes = pilotEnabled
    ? singlePermTypes.filter((type) => !PILOT_BLOCKED_PERMISSIONS.has(type))
    : singlePermTypes;
  const [collapsed, setCollapsed] = useState<Set<PermissionTypes>>(() => new Set(multiPermTypes));

  const toggleCollapsed = (type: PermissionTypes) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleToggle = (type: PermissionTypes, perm: string, value: boolean) => {
    const updated = { ...permissions };
    updated[type] = { ...updated[type], [perm]: value };
    onChange(updated);
  };

  const handleToggleAll = (type: PermissionTypes, value: boolean) => {
    const updated = { ...permissions };
    const perms = PERMISSION_TYPE_SCHEMA[type];
    const section: Record<string, boolean> = {};
    for (const p of perms) section[p] = value;
    updated[type] = section;
    onChange(updated);
  };

  const descKey = (type: PermissionTypes) => `com_perm_desc_${type}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Expandable permission cards */}
      <div className="flex flex-col gap-2">
        {visibleMultiPermTypes.map((type) => {
          const perms = PERMISSION_TYPE_SCHEMA[type];
          const section = permissions[type] ?? {};
          const allEnabled = perms.every((p) => section[p] === true);
          const isOpen = !collapsed.has(type);
          const description = localize(descKey(type));
          const hasDescription = description !== descKey(type);

          return (
            <div key={type} className="rounded-inner border border-line bg-surface">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => toggleCollapsed(type)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCollapsed(type);
                  }
                }}
                className="aimo-disclosure"
              >
                <div className="flex flex-1 items-center gap-2">
                  <Icon
                    name="chevron-right"
                    size="sm"
                    className={cn('text-muted transition-transform', isOpen && 'rotate-90')}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-ink">
                      {localize(`com_perm_type_${type}`)}
                    </span>
                    {hasDescription && (
                      <span className="text-xs text-muted tabular-nums">{description}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-muted tabular-nums">
                    {allEnabled
                      ? localize('com_ui_all')
                      : `${perms.filter((p) => section[p]).length}/${perms.length}`}
                  </span>
                  <Switch
                    id={`perm-all-${type}`}
                    checked={allEnabled}
                    onCheckedChange={(v) => handleToggleAll(type, v)}
                    disabled={disabled}
                    aria-label={`${localize(`com_perm_type_${type}`)}: ${localize('com_ui_select_all')}`}
                  />
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-line2 px-4 py-2">
                  <div className="flex flex-col gap-1 pl-6">
                    {perms.map((perm) => (
                      <label
                        key={perm}
                        htmlFor={disabled ? undefined : `perm-${type}-${perm}`}
                        className={cn(
                          'flex items-center justify-between py-1.5',
                          disabled ? 'cursor-default' : 'cursor-pointer',
                        )}
                      >
                        <span className="text-sm text-ink2">{localize(`com_perm_${perm}`)}</span>
                        <Switch
                          id={`perm-${type}-${perm}`}
                          checked={section[perm] ?? false}
                          onCheckedChange={(v) => handleToggle(type, perm, v)}
                          disabled={disabled}
                          aria-label={`${localize(`com_perm_type_${type}`)}: ${localize(`com_perm_${perm}`)}`}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Clustered single-permission toggles */}
      {visibleSinglePermTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="aimo-label">{localize('com_perm_features')}</span>
          <div
            className={
              visibleSinglePermTypes.length > 6
                ? 'grid w-fit grid-cols-[auto_auto_auto] gap-x-4 gap-y-1.5'
                : 'flex flex-wrap gap-x-6 gap-y-1.5'
            }
          >
            {visibleSinglePermTypes.map((type) => {
              const perm = PERMISSION_TYPE_SCHEMA[type][0];
              const section = permissions[type] ?? {};
              const switchId = `perm-${type}-${perm}`;
              return (
                <label
                  key={type}
                  htmlFor={disabled ? undefined : switchId}
                  className={cn(
                    'flex w-fit items-center gap-2 rounded-full px-2 py-1 text-sm text-ink',
                    disabled ? 'cursor-default' : 'cursor-pointer',
                  )}
                >
                  <span className="shrink-0">
                    <Switch
                      id={switchId}
                      checked={section[perm] ?? false}
                      onCheckedChange={(v) => handleToggle(type, perm, v)}
                      disabled={disabled}
                      aria-label={localize(`com_perm_type_${type}`)}
                    />
                  </span>
                  <span className="wrap-break-word" title={localize(`com_perm_type_${type}`)}>
                    {localize(`com_perm_type_${type}`)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
