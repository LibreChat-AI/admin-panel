import { Icon } from '@clickhouse/click-ui';
import { useLocalize, useLanguage } from '@/hooks';
import { LANGUAGES } from '@/constants';

/** Switches to the next shipped language, labeled with that language's own name. */
export function LanguageSelector() {
  const localize = useLocalize();
  const { language, setLanguage } = useLanguage();
  const index = LANGUAGES.findIndex((option) => option.code === language);
  const next = LANGUAGES[(index + 1) % LANGUAGES.length];

  return (
    <button
      type="button"
      lang={next.code}
      className="flex items-center gap-2 rounded-lg p-3 text-sm text-(--cui-color-text-default) hover:bg-(--cui-color-background-hover)"
      aria-label={localize('com_ui_switch_language', { language: next.nativeName })}
      onClick={() => setLanguage(next.code)}
    >
      <Icon name="globe" size="md" aria-hidden="true" />
      <span>{next.nativeName}</span>
    </button>
  );
}
