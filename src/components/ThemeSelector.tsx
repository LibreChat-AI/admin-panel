import { Icon } from '@clickhouse/click-ui';
import { useCallback, useEffect, useState } from 'react';
import type * as t from '@/types';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalize } from '@/hooks';

const themeIcons: Record<t.ThemeOption, 'display' | 'light-bulb-on' | 'moon'> = {
  system: 'display',
  light: 'light-bulb-on',
  dark: 'moon',
};

const themeLabels: Record<t.ThemeOption, string> = {
  system: 'com_nav_theme_system',
  light: 'com_nav_theme_light',
  dark: 'com_nav_theme_dark',
};

function isDark(theme: string): boolean {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return theme === 'dark';
}

function ThemeButton({ theme, onChange }: { theme: string; onChange: (value: string) => void }) {
  const localize = useLocalize();
  const nextTheme = isDark(theme) ? 'light' : 'dark';
  const [announcement, setAnnouncement] = useState('');

  const handleChange = useCallback(
    (next: string) => {
      onChange(next);
      setAnnouncement(
        isDark(next)
          ? localize('com_ui_dark_theme_enabled')
          : localize('com_ui_light_theme_enabled'),
      );
    },
    [onChange, localize],
  );

  useEffect(() => {
    if (!announcement) return;
    const timeout = setTimeout(() => setAnnouncement(''), 2000);
    return () => clearTimeout(timeout);
  }, [announcement]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleChange(nextTheme);
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [nextTheme, handleChange]);

  const currentLabel = localize(themeLabels[theme as t.ThemeOption] ?? themeLabels.system);

  return (
    <>
      <button
        className="flex items-center gap-2 rounded-lg p-3 hover:bg-(--cui-color-background-hover)"
        aria-label={`${localize('com_ui_toggle_theme')}, ${currentLabel}`}
        aria-keyshortcuts="Ctrl+Shift+T"
        onClick={(e) => {
          e.preventDefault();
          handleChange(nextTheme);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleChange(nextTheme);
          }
        }}
        style={{ color: 'var(--cui-color-text-default)' }}
      >
        <Icon name={themeIcons[theme as t.ThemeOption] ?? 'display'} size="md" aria-hidden="true" />
      </button>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </>
  );
}

export default function ThemeSelector({ returnThemeOnly }: { returnThemeOnly?: boolean }) {
  const { theme, setTheme } = useTheme();

  const changeTheme = useCallback(
    (value: string) => {
      setTheme(value as t.ThemeOption);
    },
    [setTheme],
  );

  if (returnThemeOnly) {
    return <ThemeButton theme={theme} onChange={changeTheme} />;
  }

  return (
    <div className="flex flex-col items-center justify-center sm:pt-0">
      <div className="absolute bottom-0 inset-s-0 m-4">
        <ThemeButton theme={theme} onChange={changeTheme} />
      </div>
    </div>
  );
}
