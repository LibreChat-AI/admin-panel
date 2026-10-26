import { Command } from 'cmdk';
import { Icon } from '@clickhouse/click-ui';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Title as DialogTitle, Description as DialogDescription } from '@radix-ui/react-dialog';
import type * as t from '@/types';
import { useSearchIndex, useLocalize, usePilotMode } from '@/hooks';
import { CONFIG_TABS } from './configuration/configMeta';
import { useTheme } from '@/contexts/ThemeContext';

export function CommandMenu({ open, onOpenChange }: t.CommandMenuProps) {
  const localize = useLocalize();
  const pilotEnabled = usePilotMode();
  const router = useRouter();
  const { setTheme } = useTheme();
  const { items: configSections } = useSearchIndex(localize, open && !pilotEnabled);

  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, []);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const navigateTo = useCallback(
    (path: string, search?: Record<string, string>) => {
      close();
      router.navigate({ to: path, search });
    },
    [close, router],
  );

  const selectTheme = useCallback(
    (value: 'system' | 'light' | 'dark') => {
      setTheme(value);
      close();
    },
    [setTheme, close],
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={localize('com_cmdk_label')}
      overlayClassName="cmdk-overlay"
      contentClassName="cmdk-content"
    >
      <VisuallyHidden>
        <DialogTitle>{localize('com_cmdk_label')}</DialogTitle>
        <DialogDescription>{localize('com_cmdk_label')}</DialogDescription>
      </VisuallyHidden>
      <div className="flex items-center gap-3 border-b border-line2 px-5">
        <span aria-hidden="true" className="inline-flex shrink-0 text-muted">
          <Icon name="search" width="16px" height="16px" />
        </span>
        <Command.Input
          value={search}
          onValueChange={handleSearchChange}
          placeholder={localize('com_cmdk_placeholder')}
          className="flex h-13 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
        />
        <kbd className="aimo-kbd shrink-0">Esc</kbd>
      </div>
      <Command.List ref={listRef} className="max-h-90 overflow-y-auto p-2">
        <Command.Empty className="px-4 py-10 text-center text-sm text-muted">
          {localize('com_cmdk_no_results')}
        </Command.Empty>

        <Command.Group heading={localize('com_cmdk_group_navigation')} className="cmdk-group">
          <CommandItem
            icon="home"
            label={localize('com_nav_dashboard')}
            onSelect={() => navigateTo('/')}
          />
          {!pilotEnabled && (
            <CommandItem
              icon="settings"
              label={localize('com_nav_configuration')}
              onSelect={() => navigateTo('/configuration')}
            />
          )}
          <CommandItem
            icon="user"
            label={localize('com_nav_access')}
            onSelect={() => navigateTo('/access')}
          />
          <CommandItem
            icon="lock"
            label={localize('com_nav_grants')}
            onSelect={() => navigateTo('/grants')}
          />
          <CommandItem
            icon="question"
            label={localize('com_nav_help')}
            onSelect={() => navigateTo('/help')}
          />
        </Command.Group>

        <Command.Group heading={localize('com_cmdk_group_tabs')} className="cmdk-group">
          {!pilotEnabled &&
            CONFIG_TABS.map((tab) => (
              <CommandItem
                key={`config-tab-${tab.id}`}
                icon="settings"
                label={localize(tab.labelKey)}
                keywords={['configuration', 'config', tab.id]}
                onSelect={() => navigateTo('/configuration', { tab: tab.id })}
              />
            ))}
          <CommandItem
            icon="user"
            label={localize('com_access_tab_groups')}
            keywords={['access', 'groups', 'permissions']}
            onSelect={() => navigateTo('/access', { tab: 'groups' })}
          />
          <CommandItem
            icon="user"
            label={localize('com_access_tab_roles')}
            keywords={['access', 'roles', 'permissions']}
            onSelect={() => navigateTo('/access', { tab: 'roles' })}
          />
        </Command.Group>

        {configSections.length > 0 && (
          <Command.Group heading={localize('com_cmdk_group_sections')} className="cmdk-group">
            {configSections.map((item) => (
              <CommandItem
                key={item.id}
                icon="settings"
                label={item.label}
                keywords={item.keywords}
                onSelect={() => item.tab && navigateTo('/configuration', { tab: item.tab })}
              />
            ))}
          </Command.Group>
        )}

        <Command.Group heading={localize('com_cmdk_group_actions')} className="cmdk-group">
          <CommandItem
            icon="light-bulb-on"
            label={localize('com_cmdk_set_theme', { theme: localize('com_nav_theme_light') })}
            keywords={['theme', 'light', 'mode', 'appearance']}
            onSelect={() => selectTheme('light')}
          />
          <CommandItem
            icon="moon"
            label={localize('com_cmdk_set_theme', { theme: localize('com_nav_theme_dark') })}
            keywords={['theme', 'dark', 'mode', 'appearance']}
            onSelect={() => selectTheme('dark')}
          />
          <CommandItem
            icon="display"
            label={localize('com_cmdk_set_theme', { theme: localize('com_nav_theme_system') })}
            keywords={['theme', 'system', 'auto', 'mode', 'appearance']}
            onSelect={() => selectTheme('system')}
          />
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function CommandItem({ icon, label, keywords, onSelect }: t.CommandItemProps) {
  return (
    <Command.Item
      value={label}
      keywords={keywords}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink transition-colors aria-selected:bg-fill"
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0 text-muted">
          <Icon name={icon} size="sm" />
        </span>
      )}
      <span className="truncate">{label}</span>
    </Command.Item>
  );
}
