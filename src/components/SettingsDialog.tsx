import * as Dialog from '@radix-ui/react-dialog';
import type * as t from '@/types';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

const THEME_OPTIONS: t.ThemeOption[] = ['system', 'light', 'dark'];
const THEME_LABEL_KEYS: Record<t.ThemeOption, string> = {
  system: 'com_nav_theme_system',
  light: 'com_nav_theme_light',
  dark: 'com_nav_theme_dark',
};

export function SettingsDialog({ open, onClose }: t.SettingsDialogProps) {
  const localize = useLocalize();
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('admin-settings-overlay', resolvedTheme === 'dark' && 'is-dark')}
        />
        <Dialog.Content
          className={cn('admin-settings-dialog', resolvedTheme === 'dark' && 'is-dark')}
        >
          <Dialog.Title className="admin-settings-title">
            {localize('com_ui_settings')}
          </Dialog.Title>
          <Dialog.Close asChild>
            <button className="admin-settings-close" type="button" aria-label="Close settings">
              ×
            </button>
          </Dialog.Close>
          <Dialog.Description className="sr-only">
            {localize('com_settings_theme_desc')}
          </Dialog.Description>
          <div className="admin-settings-theme-row">
            <div>
              <strong>{localize('com_nav_theme')}</strong>
              <p>{localize('com_settings_theme_desc')}</p>
            </div>
            <div
              className="admin-settings-theme-options"
              role="group"
              aria-label={localize('com_nav_theme')}
            >
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={theme === option}
                  onClick={() => setTheme(option)}
                >
                  {localize(THEME_LABEL_KEYS[option])}
                </button>
              ))}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
