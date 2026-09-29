import { Dialog, Select } from '@clickhouse/click-ui';
import { useTranslation } from 'react-i18next';
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

const LANGUAGE_OPTIONS = ['en', 'zh-Hans'] as const;
type LanguageOption = (typeof LANGUAGE_OPTIONS)[number];
const LANGUAGE_LABEL_KEYS: Record<LanguageOption, string> = {
  en: 'com_ui_language_english',
  'zh-Hans': 'com_ui_language_zh_hans',
};

export function SettingsDialog({ open, onClose }: t.SettingsDialogProps) {
  const localize = useLocalize();
  const { theme, setTheme } = useTheme();
  const { i18n } = useTranslation();

  const resolvedLanguage = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const currentLanguage: LanguageOption = resolvedLanguage.startsWith('zh') ? 'zh-Hans' : 'en';

  const setLanguage = (language: LanguageOption) => {
    i18n.changeLanguage(language);
    localStorage.setItem('i18nextLng', language);
    document.documentElement.lang = language;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()}
        title={localize('com_ui_settings')}
        showClose
        onClose={onClose}
        className="modal-frost"
      >
        <div className="flex flex-col gap-6 py-2">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-(--cui-color-text-default)">
                {localize('com_nav_theme')}
              </span>
              <span className="text-xs text-(--cui-color-text-muted)">
                {localize('com_settings_theme_desc')}
              </span>
            </div>
            <div className="flex gap-1 rounded-lg border border-(--cui-color-stroke-default) p-0.5">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setTheme(opt)}
                  className={cn(
                    'cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    theme === opt
                      ? 'bg-(--cui-color-background-active) text-(--cui-color-text-default)'
                      : 'text-(--cui-color-text-muted) hover:text-(--cui-color-text-default)',
                  )}
                  aria-pressed={theme === opt}
                >
                  {localize(THEME_LABEL_KEYS[opt])}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-(--cui-color-text-default)">
                {localize('com_ui_language')}
              </span>
            </div>
            <div className="w-40 shrink-0">
              <Select
                value={currentLanguage}
                onSelect={(v) => setLanguage(v as LanguageOption)}
                aria-label={localize('com_ui_language')}
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <Select.Item key={opt} value={opt}>
                    {localize(LANGUAGE_LABEL_KEYS[opt])}
                  </Select.Item>
                ))}
              </Select>
            </div>
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
