import { Command } from 'cmdk';
import { Icon } from '@clickhouse/click-ui';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Title as DialogTitle, Description as DialogDescription } from '@radix-ui/react-dialog';
import type * as t from '@/types';
import { CONFIG_TABS } from './configuration/configMeta';
import { useSearchIndex, useLocalize } from '@/hooks';
import { useTheme } from '@/contexts/ThemeContext';

export function CommandMenu({ open, onOpenChange }: t.CommandMenuProps) {
  const localize = useLocalize();
  const router = useRouter();
  const { setTheme } = useTheme();
  const { items: configSections } = useSearchIndex(localize, open);

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
      <Command.Input
        value={search}
        onValueChange={handleSearchChange}
        placeholder={localize('com_cmdk_placeholder')}
        className="flex w-full border-b border-(--cui-color-stroke-default) bg-transparent px-4 py-3 text-sm text-(--cui-color-text-default) outline-none placeholder:text-(--cui-color-text-muted)"
      />
      <Command.List ref={listRef} className="max-h-85 overflow-y-auto p-2">
        <Command.Empty className="px-4 py-8 text-center text-sm text-(--cui-color-text-muted)">
          {localize('com_cmdk_no_results')}
        </Command.Empty>

        <Command.Group heading={localize('com_cmdk_group_navigation')} className="cmdk-group">
          <CommandItem
            icon="home"
            label={localize('com_nav_dashboard')}
            onSelect={() => navigateTo('/')}
          />
          <CommandItem
            icon="settings"
            label={localize('com_nav_configuration')}
            onSelect={() => navigateTo('/configuration')}
          />
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
            icon="document"
            label={localize('com_nav_questionnaires')}
            onSelect={() => navigateTo('/questionnaires')}
          />
          <CommandItem
            icon="question"
            label={localize('com_nav_help')}
            onSelect={() => navigateTo('/help')}
          />
        </Command.Group>

        <Command.Group heading={localize('com_cmdk_group_tabs')} className="cmdk-group">
          {CONFIG_TABS.map((tab) => (
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
      className="flex cursor-pointer items-center gap-3 rounded-(--cui-radii-sm) px-3 py-2 text-sm text-(--cui-color-text-default) aria-selected:bg-(--cui-color-background-active)"
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0 text-(--cui-color-text-muted)">
          <Icon name={icon} size="sm" />
        </span>
      )}
      <span className="truncate">{label}</span>
    </Command.Item>
  );
}
