import { useMemo } from 'react';
import { Icon } from '@clickhouse/click-ui';
import { Link } from '@tanstack/react-router';
import type * as t from '@/types';
import { useCapabilities, useLocalize } from '@/hooks';
import { SystemCapabilities } from '@/constants';

const QUICK_LINKS: (t.NavItem & { descKey: string })[] = [
  {
    labelKey: 'com_nav_configuration',
    path: '/configuration',
    icon: 'settings',
    descKey: 'com_dash_config_desc',
    capability: SystemCapabilities.READ_CONFIGS,
  },
  {
    labelKey: 'com_nav_access',
    path: '/access',
    icon: 'user',
    descKey: 'com_dash_access_desc',
    capability: [SystemCapabilities.READ_ROLES, SystemCapabilities.READ_GROUPS],
  },
  {
    labelKey: 'com_nav_grants',
    path: '/grants',
    icon: 'lock',
    descKey: 'com_dash_grants_desc',
  },
  {
    labelKey: 'com_nav_help',
    path: '/help',
    icon: 'question',
    descKey: 'com_dash_help_desc',
  },
  {
    labelKey: 'com_nav_tools',
    path: '/tools',
    icon: 'plug',
    descKey: 'com_dash_tools_desc',
  },
  {
    labelKey: 'com_nav_services',
    path: '/services',
    icon: 'server',
    descKey: 'com_dash_services_desc',
  },
];

export function DashboardPage() {
  const localize = useLocalize();
  const { hasCapability } = useCapabilities();

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

  const visibleLinks = useMemo(
    () =>
      QUICK_LINKS.filter((link) => {
        if (!link.capability) return true;
        if (Array.isArray(link.capability)) return link.capability.some((c) => hasCapability(c));
        return hasCapability(link.capability);
      }),
    [hasCapability],
  );

  return (
    <div
      role="region"
      aria-label={localize('com_nav_dashboard')}
      className="flex flex-1 flex-col gap-8 overflow-auto p-6"
    >
      <section aria-label={localize('com_dash_quick_links')}>
        <h3 className="mb-3 text-sm font-medium text-(--cui-color-text-muted)">
          {localize('com_dash_quick_links')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {visibleLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className="flex items-start gap-3 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) p-4 no-underline transition-colors hover:bg-(--cui-color-background-hover)"
            >
              <span aria-hidden="true" className="mt-0.5 text-(--cui-color-text-muted)">
                <Icon name={link.icon} size="sm" />
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-(--cui-color-text-default)">
                  {localize(link.labelKey)}
                </span>
                <span className="text-xs text-(--cui-color-text-muted)">
                  {localize(link.descKey)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section
        aria-label={localize('com_dash_nav_tips')}
        className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) p-5"
      >
        <h3 className="mb-3 text-sm font-medium text-(--cui-color-text-default)">
          {localize('com_dash_nav_tips')}
        </h3>
        <ul className="flex flex-col gap-3 text-sm text-(--cui-color-text-muted)">
          <li className="flex items-center gap-3">
            <kbd className="shrink-0 rounded border border-(--cui-color-stroke-default) bg-(--cui-color-background-secondary) px-1.5 py-0.5 text-xs font-medium text-(--cui-color-text-default)">
              {isMac ? '⌘B' : 'Ctrl+B'}
            </kbd>
            <span>{localize('com_dash_tip_sidebar')}</span>
          </li>
          <li className="flex items-center gap-3">
            <kbd className="shrink-0 rounded border border-(--cui-color-stroke-default) bg-(--cui-color-background-secondary) px-1.5 py-0.5 text-xs font-medium text-(--cui-color-text-default)">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
            <span>{localize('com_dash_tip_cmdk')}</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
