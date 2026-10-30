import { flushSync } from 'react-dom';
import { useRef, useState } from 'react';
import { Icon, Dropdown } from '@clickhouse/click-ui';
import { Link, useRouter } from '@tanstack/react-router';
import type * as t from '@/types';
import { useStripAriaExpanded, useCapabilities, useLocalize } from '@/hooks';
import { getInitials, isFocusLost, cn } from '@/utils';
import { DecorativeIcon } from '@/components/shared';
import libreChatLogo from '@/assets/librechat.svg';
import { SettingsDialog } from './SettingsDialog';
import { SystemCapabilities } from '@/constants';
import { adminLogoutFn } from '@/server';

const navItems: t.NavItem[] = [
  { labelKey: 'com_nav_dashboard', path: '/', icon: 'home' },
  {
    labelKey: 'com_nav_configuration',
    path: '/configuration',
    icon: 'settings',
    capability: SystemCapabilities.READ_CONFIGS,
  },
  // TODO: re-enable once user management is ready
  // {
  //   labelKey: 'com_nav_users',
  //   path: '/users',
  //   icon: 'users',
  //   capability: SystemCapabilities.READ_USERS,
  // },
  {
    labelKey: 'com_nav_access',
    path: '/access',
    icon: 'user',
    capability: [SystemCapabilities.READ_ROLES, SystemCapabilities.READ_GROUPS],
  },
  { labelKey: 'com_nav_grants', path: '/grants', icon: 'lock' },
  { labelKey: 'com_nav_help', path: '/help', icon: 'question' },
];

/**
 * A collapsed row spans the rail's inner width (w-14, less its 1px border and
 * px-2 on each side) from the first frame of the collapse, so its icon centers
 * in the rail instead of sweeping in from the middle of the shrinking panel.
 * It narrows to the space a scrolling nav leaves beside its scrollbar.
 */
const RAIL_ROW = 'w-[calc(--spacing(10)-1px)] max-w-full justify-center gap-0';
const RAIL_LABEL = 'w-0 flex-none overflow-hidden';

function getUserInitials(user?: { name?: string; email?: string } | null): string {
  if (user?.name) return getInitials(user.name);
  if (user?.email) return user.email[0].toUpperCase();
  return '';
}

export function Sidebar({ user, collapsed, onToggle }: t.SidebarProps) {
  const localize = useLocalize();
  const router = useRouter();
  const { hasCapability } = useCapabilities();
  const currentPath = router.state.location.pathname;
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const userMenuRef = useStripAriaExpanded<HTMLButtonElement>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** An item was chosen: it may move focus itself (Settings opens a dialog), so closing leaves it be. */
  const chosenRef = useRef(false);

  const visibleItems = navItems.filter((item) => {
    if (!item.capability) return true;
    if (Array.isArray(item.capability)) return item.capability.some((c) => hasCapability(c));
    return hasCapability(item.capability);
  });

  const isActive = (path: string) =>
    path === '/' ? currentPath === '/' : currentPath.startsWith(path);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const result = await adminLogoutFn();
      if (!result.error && result.redirect) {
        window.location.href = result.redirect;
        return;
      }
      await router.invalidate();
      router.navigate({ to: '/login', search: { redirect: '/' } });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  /**
   * Closes the user menu and puts focus on its button before Settings opens,
   * as KebabMenu does: the menu's focus trap is gone before the dialog takes
   * focus, and the dialog gives focus back to that button when it closes.
   */
  const openSettings = () => {
    chosenRef.current = true;
    flushSync(() => setMenuOpen(false));
    userMenuRef.current?.focus();
    setSettingsOpen(true);
  };

  /**
   * Gives focus back to the avatar once the menu closes (Escape, a click
   * outside): Radix returns it to click-ui's trigger wrapper, which can't take
   * it, so it fell to `<body>`. After a chosen item, focus it moved stays.
   */
  const handleMenuCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    const chosen = chosenRef.current;
    chosenRef.current = false;
    if (!chosen) {
      userMenuRef.current?.focus();
      return;
    }
    requestAnimationFrame(() => {
      if (isFocusLost()) userMenuRef.current?.focus();
    });
  };

  /** The avatar shows the initials, so its name starts with them (WCAG 2.5.3, label in name). */
  const initials = getUserInitials(user);
  const userName = user?.name || user?.email || '';

  return (
    <>
      <aside
        aria-label={localize('com_a11y_admin_panel')}
        className={cn(
          'sticky top-0 z-(--z-floating) flex h-screen shrink-0 flex-col overflow-hidden border-e border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) transition-[width] duration-200',
          collapsed ? 'w-14' : 'w-63',
        )}
      >
        <div className="flex h-14 shrink-0 items-center px-2">
          <div
            className={cn(
              'flex items-center overflow-hidden px-1.5',
              collapsed ? RAIL_ROW : 'gap-2.5',
            )}
          >
            <img
              src={libreChatLogo}
              alt={localize('com_a11y_logo_alt')}
              className="h-6 w-6 shrink-0"
            />
            <span
              className={cn(
                'truncate text-sm font-semibold text-(--cui-color-text-default)',
                collapsed && RAIL_LABEL,
              )}
            >
              {localize('com_auth_title')}
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2" role="navigation">
          <div className="flex flex-col gap-0.5">
            {visibleItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                aria-current={isActive(item.path) ? 'page' : undefined}
                aria-label={collapsed ? localize(item.labelKey) : undefined}
                title={collapsed ? localize(item.labelKey) : undefined}
                className={cn(
                  'flex h-8 items-center overflow-hidden rounded-md px-2.5 text-sm whitespace-nowrap no-underline transition-colors duration-100',
                  collapsed ? RAIL_ROW : 'gap-2.5',
                  isActive(item.path)
                    ? 'bg-(--cui-color-background-active) font-medium text-(--cui-color-text-default)'
                    : 'font-normal text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)',
                )}
              >
                <span aria-hidden="true" className="shrink-0">
                  <Icon name={item.icon} size="sm" />
                </span>
                <span className={cn('truncate text-sm', collapsed && RAIL_LABEL)}>
                  {localize(item.labelKey)}
                </span>
              </Link>
            ))}
          </div>
        </nav>

        {initials && (
          <div className="flex shrink-0 items-center border-t border-(--cui-color-stroke-default) px-2 py-3">
            <div
              className={cn('flex min-w-0 items-center px-0.5', collapsed ? RAIL_ROW : 'gap-2.5')}
            >
              <Dropdown open={menuOpen} onOpenChange={setMenuOpen}>
                <Dropdown.Trigger>
                  <button
                    ref={userMenuRef}
                    type="button"
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) transition-colors hover:border-(--cui-color-stroke-intense) hover:bg-(--cui-color-background-hover)"
                    aria-label={localize('com_nav_user_menu_label', { initials, name: userName })}
                    aria-haspopup="true"
                    title={userName}
                  >
                    <span
                      aria-hidden="true"
                      className="text-xs font-medium text-(--cui-color-text-muted)"
                    >
                      {initials}
                    </span>
                  </button>
                </Dropdown.Trigger>
                <Dropdown.Content onCloseAutoFocus={handleMenuCloseAutoFocus}>
                  <div className="user-dropdown flex min-w-45 flex-col select-none">
                    {user && (
                      <div className="px-3 pt-3 pb-2">
                        <span className="block text-sm leading-tight font-medium text-(--cui-color-text-default)">
                          {user.name || ''}
                        </span>
                        {user.email && (
                          <span className="mt-0.5 block text-xs leading-tight text-(--cui-color-text-muted)">
                            {user.email}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="border-t border-(--cui-color-stroke-default)" />
                    <Dropdown.Item icon="settings" onSelect={openSettings}>
                      {localize('com_ui_settings')}
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon="slide-out"
                      onClick={() => {
                        chosenRef.current = true;
                        void handleLogout();
                      }}
                      disabled={isLoggingOut}
                    >
                      {isLoggingOut ? localize('com_ui_signing_out') : localize('com_ui_sign_out')}
                    </Dropdown.Item>
                  </div>
                </Dropdown.Content>
              </Dropdown>
              {user && (
                <div className={cn('min-w-0', collapsed ? RAIL_LABEL : 'flex-1')}>
                  <span className="block truncate text-sm leading-tight font-medium text-(--cui-color-text-default)">
                    {user.name || ''}
                  </span>
                  {user.email && (
                    <span className="block truncate text-xs leading-tight text-(--cui-color-text-muted)">
                      {user.email}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-label={localize(collapsed ? 'com_nav_expand_sidebar' : 'com_nav_collapse_sidebar')}
          title={localize(collapsed ? 'com_nav_expand_sidebar' : 'com_nav_collapse_sidebar')}
          className="sidebar-toggle flex w-full shrink-0 cursor-pointer items-center justify-center border-t border-(--cui-color-stroke-default) bg-transparent py-3 text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)"
        >
          <DecorativeIcon name={collapsed ? 'slide-in' : 'slide-out'} size="sm" />
        </button>
      </aside>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
