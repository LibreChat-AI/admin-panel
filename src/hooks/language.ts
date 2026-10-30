import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type * as t from '@/types';
import { DEFAULT_LANGUAGE, LANGUAGE_CODES } from '@/constants';

function toLanguageCode(lng: string | undefined): t.LanguageCode {
  return LANGUAGE_CODES.find((code) => code === lng) ?? DEFAULT_LANGUAGE;
}

/** The active UI language, its text direction, and a setter that persists the choice. */
export function useLanguage(): {
  language: t.LanguageCode;
  direction: 'ltr' | 'rtl';
  setLanguage: (next: t.LanguageCode) => void;
} {
  const { i18n } = useTranslation();
  const language = toLanguageCode(i18n.resolvedLanguage);
  const setLanguage = useCallback(
    (next: t.LanguageCode) => {
      void i18n.changeLanguage(next);
    },
    [i18n],
  );
  return { language, direction: i18n.dir(language), setLanguage };
}
