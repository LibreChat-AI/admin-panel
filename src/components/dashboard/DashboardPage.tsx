import { useMemo } from 'react';
import { Icon } from '@clickhouse/click-ui';
import { Link } from '@tanstack/react-router';
import type * as t from '@/types';
import { useCapabilities, useLocalize, usePilotMode } from '@/hooks';
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
];

export function DashboardPage() {
  const localize = useLocalize();
  const pilotEnabled = usePilotMode();
  const { hasCapability } = useCapabilities();

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

  const visibleLinks = useMemo(
    () =>
      QUICK_LINKS.filter((link) => {
        if (pilotEnabled && link.path === '/configuration') return false;
        if (!link.capability) return true;
        if (Array.isArray(link.capability)) return link.capability.some((c) => hasCapability(c));
        return hasCapability(link.capability);
      }),
    [hasCapability, pilotEnabled],
  );

  return (
    <div
      role="region"
      aria-label={localize('com_nav_dashboard')}
      className="admin-content-page flex flex-1 flex-col gap-7 overflow-auto"
    >
      <section aria-label={localize('com_dash_quick_links')}>
        <h3 className="aimo-label mb-3">{localize('com_dash_quick_links')}</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibleLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className="aimo-card aimo-card-link group flex items-start gap-4 px-5 py-4.5 no-underline"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill text-link"
              >
                <Icon name={link.icon} width="18px" height="18px" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[17px] leading-snug font-semibold tracking-[-0.022em] text-ink">
                  {localize(link.labelKey)}
                </span>
                <span className="text-sm text-muted">{localize(link.descKey)}</span>
              </div>
              <span
                aria-hidden="true"
                className="mt-1 text-muted transition-colors group-hover:text-link"
              >
                <Icon name="chevron-right" size="sm" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label={localize('com_dash_nav_tips')} className="aimo-tile">
        <h3 className="m-0 text-[17px] font-semibold tracking-[-0.022em] text-tile-title">
          {localize('com_dash_nav_tips')}
        </h3>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          <li className="flex items-baseline gap-3.5">
            <kbd className="aimo-kbd flex-none bg-tile-kbd-bg text-tile-kbd-ink">
              {isMac ? '⌘B' : 'Ctrl+B'}
            </kbd>
            <span>{localize('com_dash_tip_sidebar')}</span>
          </li>
          <li className="flex items-baseline gap-3.5">
            <kbd className="aimo-kbd flex-none bg-tile-kbd-bg text-tile-kbd-ink">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
            <span>{localize('com_dash_tip_cmdk')}</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
