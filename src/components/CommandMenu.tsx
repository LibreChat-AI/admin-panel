import { Command } from 'cmdk';
import { Icon } from '@clickhouse/click-ui';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Title as DialogTitle, Description as DialogDescription } from '@radix-ui/react-dialog';
import type * as t from '@/types';
import { matchesQuery, searchConfigIndex } from './configuration/search';
import { useSearchIndex, useLocalize, useLanguage, useReturnFocus } from '@/hooks';
import { CONFIG_TABS } from './configuration/configMeta';
import { LANGUAGES } from '@/constants';
import { pageTitle, restoreFocusLater } from '@/utils';
import { CommandDialog } from '@/components/shared';
import { useTheme } from '@/contexts/ThemeContext';

const MAX_SETTING_HITS = 30;

/**
 * The command menu (Ctrl+K): pages, tabs, settings and theme actions. "No
 * results" is a status message beside the listbox, which may hold only
 * options; the list stays in the DOM, hidden, as the target of the input's
 * `aria-controls`.
 */
export function CommandMenu({ open, onOpenChange }: t.CommandMenuProps) {
  const localize = useLocalize();
  const router = useRouter();
  const { setTheme } = useTheme();
  const { setLanguage } = useLanguage();
  const { items: settings } = useSearchIndex(localize, open);

  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocus = useReturnFocus(open);
  /** The navigation a command started, while its menu closes. */
  const navigationRef = useRef<Promise<void> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setSearch('');
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  /** Closes for a command that opens a page: focus then goes to that page. */
  const closeToNavigate = useCallback(
    (navigate: () => Promise<void>) => {
      close();
      navigationRef.current = navigate();
    },
    [close],
  );

  /**
   * Gives focus back to the opener; after a command opened a page, to that
   * page's title once it has rendered (WCAG 2.4.3), unless the page put focus
   * somewhere itself (a setting it reveals takes it from the title).
   */
  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      const navigation = navigationRef.current;
      navigationRef.current = null;
      if (!navigation) {
        returnFocus(event);
        return;
      }
      event.preventDefault();
      const focusTitle = () => restoreFocusLater([pageTitle]);
      void navigation.then(focusTitle, focusTitle);
    },
    [returnFocus],
  );

  const navigateTo = useCallback(
    (path: string, searchParams?: Record<string, string>) => {
      closeToNavigate(() => router.navigate({ to: path, search: searchParams }));
    },
    [closeToNavigate, router],
  );

  /** Opens a setting on the configuration page (revealed and focused there), keeping the open profile. */
  const openSetting = useCallback(
    (item: t.ConfigSearchItem) => {
      const { pathname, search: current } = router.state.location;
      const scope =
        pathname.startsWith('/configuration') && typeof current.scope === 'string'
          ? current.scope
          : undefined;
      closeToNavigate(() =>
        router.navigate({
          to: '/configuration',
          search: { tab: item.tab, field: item.path, ...(scope && { scope }) },
        }),
      );
    },
    [closeToNavigate, router],
  );

  const selectTheme = useCallback(
    (value: 'system' | 'light' | 'dark') => {
      setTheme(value);
      close();
    },
    [setTheme, close],
  );

  const selectLanguage = useCallback(
    (value: t.LanguageCode) => {
      setLanguage(value);
      close();
    },
    [setLanguage, close],
  );

  const navigation: t.StaticCommand[] = [
    {
      id: 'nav-home',
      icon: 'home',
      label: localize('com_nav_dashboard'),
      onSelect: () => navigateTo('/'),
    },
    {
      id: 'nav-config',
      icon: 'settings',
      label: localize('com_nav_configuration'),
      onSelect: () => navigateTo('/configuration'),
    },
    {
      id: 'nav-access',
      icon: 'user',
      label: localize('com_nav_access'),
      onSelect: () => navigateTo('/access'),
    },
    {
      id: 'nav-grants',
      icon: 'lock',
      label: localize('com_nav_grants'),
      onSelect: () => navigateTo('/grants'),
    },
    {
      id: 'nav-help',
      icon: 'question',
      label: localize('com_nav_help'),
      onSelect: () => navigateTo('/help'),
    },
  ];

  const tabs: t.StaticCommand[] = [
    ...CONFIG_TABS.map((tab): t.StaticCommand => ({
      id: `config-tab-${tab.id}`,
      icon: 'settings',
      label: localize(tab.labelKey),
      keywords: ['configuration', 'config', tab.id],
      onSelect: () => navigateTo('/configuration', { tab: tab.id }),
    })),
    {
      id: 'access-groups',
      icon: 'user',
      label: localize('com_access_tab_groups'),
      keywords: ['access', 'groups', 'permissions'],
      onSelect: () => navigateTo('/access', { tab: 'groups' }),
    },
    {
      id: 'access-roles',
      icon: 'user',
      label: localize('com_access_tab_roles'),
      keywords: ['access', 'roles', 'permissions'],
      onSelect: () => navigateTo('/access', { tab: 'roles' }),
    },
  ];

  const actions: t.StaticCommand[] = [
    {
      id: 'theme-light',
      icon: 'light-bulb-on',
      label: localize('com_cmdk_set_theme', { theme: localize('com_nav_theme_light') }),
      keywords: ['theme', 'light', 'mode', 'appearance'],
      onSelect: () => selectTheme('light'),
    },
    {
      id: 'theme-dark',
      icon: 'moon',
      label: localize('com_cmdk_set_theme', { theme: localize('com_nav_theme_dark') }),
      keywords: ['theme', 'dark', 'mode', 'appearance'],
      onSelect: () => selectTheme('dark'),
    },
    {
      id: 'theme-system',
      icon: 'display',
      label: localize('com_cmdk_set_theme', { theme: localize('com_nav_theme_system') }),
      keywords: ['theme', 'system', 'auto', 'mode', 'appearance'],
      onSelect: () => selectTheme('system'),
    },
    ...LANGUAGES.map(
      (option): t.StaticCommand => ({
        id: `language-${option.code}`,
        icon: 'globe',
        label: localize('com_cmdk_set_language', { language: option.nativeName }),
        keywords: ['language', 'locale', 'translation', option.code, option.nativeName],
        onSelect: () => selectLanguage(option.code),
      }),
    ),
  ];

  const query = search.trim();
  const filterStatic = (commands: t.StaticCommand[]) =>
    query
      ? commands.filter((command) =>
          matchesQuery([command.label, ...(command.keywords ?? [])], query),
        )
      : commands;
  const location = router.state.location;
  const currentTab =
    location.pathname.startsWith('/configuration') && typeof location.search.tab === 'string'
      ? location.search.tab
      : undefined;
  const settingHits = useMemo(
    () => (query ? searchConfigIndex(settings, query, MAX_SETTING_HITS, currentTab) : []),
    [settings, query, currentTab],
  );

  const staticGroups = [
    { heading: localize('com_cmdk_group_navigation'), commands: filterStatic(navigation) },
    { heading: localize('com_cmdk_group_tabs'), commands: filterStatic(tabs) },
  ];
  const visibleActions = filterStatic(actions);
  const isEmpty =
    settingHits.length === 0 &&
    visibleActions.length === 0 &&
    staticGroups.every((group) => group.commands.length === 0);

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      onCloseAutoFocus={handleCloseAutoFocus}
      label={localize('com_cmdk_label')}
      shouldFilter={false}
      overlayClassName="cmdk-overlay"
      contentClassName="cmdk-content"
    >
      <VisuallyHidden>
        <DialogTitle>{localize('com_cmdk_label')}</DialogTitle>
        <DialogDescription>{localize('com_cmdk_label')}</DialogDescription>
      </VisuallyHidden>
      <Command.Input
        value={search}
        onValueChange={handleSearchChange}
        placeholder={localize('com_cmdk_placeholder')}
        className="flex w-full border-b border-(--cui-color-stroke-default) bg-transparent px-4 py-3 text-sm text-(--cui-color-text-default) outline-none placeholder:text-(--cui-color-text-muted)"
      />
      <div role="status">
        {isEmpty && (
          <p className="m-0 px-4 py-8 text-center text-sm text-(--cui-color-text-muted)">
            {localize('com_cmdk_no_results')}
          </p>
        )}
      </div>
      <Command.List
        ref={listRef}
        hidden={isEmpty}
        className="max-h-[min(28rem,60vh)] overflow-y-auto p-2"
      >
        {staticGroups.map(
          (group) =>
            group.commands.length > 0 && (
              <Command.Group key={group.heading} heading={group.heading} className="cmdk-group">
                {group.commands.map((command) => (
                  <CommandItem
                    key={command.id}
                    value={command.id}
                    icon={command.icon}
                    label={command.label}
                    onSelect={command.onSelect}
                  />
                ))}
              </Command.Group>
            ),
        )}

        {settingHits.length > 0 && (
          <Command.Group heading={localize('com_cmdk_group_settings')} className="cmdk-group">
            {settingHits.map(({ item }) => (
              <CommandItem
                key={item.id}
                value={item.id}
                icon={item.kind === 'entry' ? 'folder-closed' : 'settings'}
                label={item.label}
                detail={item.breadcrumb.join(' › ')}
                trailing={item.value}
                onSelect={() => openSetting(item)}
              />
            ))}
          </Command.Group>
        )}

        {visibleActions.length > 0 && (
          <Command.Group heading={localize('com_cmdk_group_actions')} className="cmdk-group">
            {visibleActions.map((command) => (
              <CommandItem
                key={command.id}
                value={command.id}
                icon={command.icon}
                label={command.label}
                onSelect={command.onSelect}
              />
            ))}
          </Command.Group>
        )}
      </Command.List>
    </CommandDialog>
  );
}

function CommandItem({ value, icon, label, detail, trailing, onSelect }: t.CommandItemProps) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="group flex cursor-pointer items-center gap-3 rounded-(--cui-radii-sm) px-3 py-2 text-sm text-(--cui-color-text-default) aria-selected:bg-(--cui-color-background-active)"
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0 text-(--cui-color-text-muted)">
          <Icon name={icon} size="sm" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {detail && (
          <span className="truncate text-xs text-(--cui-color-text-muted) group-aria-selected:text-(--cui-color-text-default)">
            {detail}
          </span>
        )}
      </span>
      {trailing && (
        <span className="max-w-[40%] shrink-0 truncate font-mono text-xs text-(--cui-color-text-muted) group-aria-selected:text-(--cui-color-text-default)">
          {trailing}
        </span>
      )}
    </Command.Item>
  );
}
