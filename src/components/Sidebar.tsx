import { useState } from 'react';
import { Icon, Dropdown } from '@clickhouse/click-ui';
import { Home, LayoutGrid, Shield } from 'lucide-react';
import { Link, useRouter } from '@tanstack/react-router';
import type * as t from '@/types';
import { useStripAriaExpanded, useCapabilities, useLocalize, usePilotMode } from '@/hooks';
import { SettingsDialog } from './SettingsDialog';
import { SystemCapabilities } from '@/constants';
import { getInitials, cn } from '@/utils';
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

function getUserInitials(user?: { name?: string; email?: string } | null): string {
  if (user?.name) return getInitials(user.name);
  if (user?.email) return user.email[0].toUpperCase();
  return '';
}

export function Sidebar({ user, navigation, collapsed, onToggle }: t.SidebarProps) {
  const localize = useLocalize();
  const pilotEnabled = usePilotMode();
  const router = useRouter();
  const { hasCapability } = useCapabilities();
  const currentPath = router.state.location.pathname;
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const userMenuRef = useStripAriaExpanded<HTMLButtonElement>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const visibleItems = navItems.filter((item) => {
    if (pilotEnabled && item.path === '/configuration') return false;
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

  const initials = getUserInitials(user);
  const gatewayLabel = localize('com_nav_gateway');
  const chatLabel = localize('com_nav_chat');
  const governanceAdminLabel = localize('com_nav_governance_admin_panel');

  return (
    <>
      <aside
        aria-label={localize('com_a11y_admin_panel')}
        className={cn(
          'admin-sidebar sticky top-0 z-(--z-floating) flex h-screen shrink-0 flex-col overflow-hidden bg-rail text-rail-ink transition-[width] duration-200 motion-reduce:transition-none',
          collapsed ? 'is-collapsed w-16' : 'w-60',
        )}
      >
        <Link
          to="/"
          className="admin-sidebar-brand"
          aria-label={`Chat Admin Panel ${localize('com_nav_dashboard')}`}
        >
          <span className="admin-sidebar-logo admin-sidebar-logo-long" aria-hidden="true" />
          <span className="admin-sidebar-logo admin-sidebar-logo-small" aria-hidden="true" />
          <span className="admin-sidebar-title">Chat Admin Panel</span>
        </Link>

        <nav className="flex min-h-0 flex-1 flex-col pb-2" role="navigation">
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pt-2">
            {visibleItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                aria-current={isActive(item.path) ? 'page' : undefined}
                aria-label={collapsed ? localize(item.labelKey) : undefined}
                title={collapsed ? localize(item.labelKey) : undefined}
                className="admin-sidebar-link"
              >
                <span aria-hidden="true" className="shrink-0">
                  {item.path === '/' ? (
                    <LayoutGrid strokeWidth={1.8} />
                  ) : (
                    <Icon name={item.icon} size="sm" />
                  )}
                </span>
                <span className="truncate text-sm">{localize(item.labelKey)}</span>
              </Link>
            ))}
          </div>
          {(navigation.chatUrl || navigation.governanceAdminUrl || navigation.gatewayUrl) && (
            <div className="flex shrink-0 flex-col gap-0.5 border-t border-rail-line pt-2">
              {navigation.chatUrl && (
                <a
                  href={navigation.chatUrl}
                  aria-label={collapsed ? chatLabel : undefined}
                  title={collapsed ? chatLabel : undefined}
                  className="admin-sidebar-link"
                >
                  <span aria-hidden="true" className="shrink-0">
                    <Icon name="chat" size="sm" />
                  </span>
                  <span className="truncate text-sm">{chatLabel}</span>
                </a>
              )}
              {navigation.governanceAdminUrl && (
                <a
                  href={navigation.governanceAdminUrl}
                  aria-label={collapsed ? governanceAdminLabel : undefined}
                  title={collapsed ? governanceAdminLabel : undefined}
                  className="admin-sidebar-link"
                >
                  <Shield aria-hidden="true" className="shrink-0" />
                  <span className="truncate text-sm">{governanceAdminLabel}</span>
                </a>
              )}
              {navigation.gatewayUrl && (
                <a
                  href={navigation.gatewayUrl}
                  aria-label={collapsed ? gatewayLabel : undefined}
                  title={collapsed ? gatewayLabel : undefined}
                  className="admin-sidebar-link"
                >
                  <Home aria-hidden="true" className="shrink-0" />
                  <span className="truncate text-sm">{gatewayLabel}</span>
                </a>
              )}
            </div>
          )}
        </nav>

        {initials && (
          <div className="flex shrink-0 items-center border-t border-rail-line px-3.5 py-3">
            <div className="flex min-w-0 items-center gap-3 overflow-hidden">
              <Dropdown>
                <Dropdown.Trigger>
                  <button
                    ref={userMenuRef}
                    type="button"
                    className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-avatar transition-colors hover:bg-rail-active"
                    aria-label={`${localize('com_nav_user_menu')}, ${user?.name || user?.email || ''}`}
                    aria-haspopup="true"
                    title={user?.name || user?.email || ''}
                  >
                    <span aria-hidden="true" className="text-xs font-semibold text-white">
                      {initials}
                    </span>
                  </button>
                </Dropdown.Trigger>
                <Dropdown.Content
                  side="top"
                  align="start"
                  responsivePositioning={false}
                  className="admin-user-popover"
                >
                  <div className="user-dropdown flex w-full flex-col select-none">
                    {user && (
                      <div className="admin-user-popover-heading">
                        <span className="admin-user-popover-name">{user.name || ''}</span>
                        {user.email && (
                          <span className="admin-user-popover-email">{user.email}</span>
                        )}
                      </div>
                    )}
                    <Dropdown.Item icon="settings" onClick={() => setSettingsOpen(true)}>
                      {localize('com_ui_settings')}
                    </Dropdown.Item>
                    <Dropdown.Item onClick={handleLogout} disabled={isLoggingOut}>
                      <span className="admin-user-popover-action">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
                          <path d="M13 8l4 4-4 4M7 12h10" />
                        </svg>
                        <span>
                          {isLoggingOut
                            ? localize('com_ui_signing_out')
                            : localize('com_ui_sign_out')}
                        </span>
                      </span>
                    </Dropdown.Item>
                  </div>
                </Dropdown.Content>
              </Dropdown>
              {user && (
                <div className="sidebar-user-details min-w-0 flex-1">
                  <span className="block truncate text-sm leading-tight font-semibold text-rail-ink">
                    {user.name || ''}
                  </span>
                  {user.email && (
                    <span className="block truncate text-xs leading-tight text-rail-muted">
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
          className="flex h-12 w-full shrink-0 cursor-pointer items-center justify-center border-t border-rail-line bg-transparent text-rail-muted transition-colors hover:bg-rail-hover hover:text-rail-ink"
        >
          <Icon name={collapsed ? 'slide-in' : 'slide-out'} size="sm" />
        </button>
      </aside>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
