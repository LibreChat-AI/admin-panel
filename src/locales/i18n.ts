import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, LANGUAGE_STORAGE_KEY } from '@/constants';
import translationEn from './en/translation.json';
import translationFa from './fa/translation.json';

export const defaultNS = 'translation';

export const resources = {
  en: { translation: translationEn },
  fa: { translation: translationFa },
} as const;

/** Mirrors the active language onto `<html>` so `lang`, `dir` and logical CSS follow it. */
function applyDocumentLanguage(lng: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.lang = lng;
  root.dir = i18n.dir(lng);
}

i18n.on('languageChanged', applyDocumentLanguage);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: {
      default: [DEFAULT_LANGUAGE],
    },
    supportedLngs: LANGUAGE_CODES,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    fallbackNS: 'translation',
    ns: ['translation'],
    debug: false,
    defaultNS,
    resources,
    interpolation: { escapeValue: false },
  });

export default i18n;
