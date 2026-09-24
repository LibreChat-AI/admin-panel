import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import translationEn from './en/translation.json';
import translationZhHans from './zh-Hans/translation.json';

export const defaultNS = 'translation';

export const supportedLocales = ['en', 'zh-Hans'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const resources = {
  en: { translation: translationEn },
  'zh-Hans': { translation: translationZhHans },
} as const;

const supportedByLowercase: Record<string, SupportedLocale> = Object.fromEntries(
  supportedLocales.map((locale) => [locale.toLowerCase(), locale]),
);

// Mirrors LibreChat's client locale normalization: exact supported match first,
// then alias table, then the base-language entry.
const localeAliases: Record<string, SupportedLocale> = {
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
};

export function normalizeLocale(locale?: string | null): SupportedLocale {
  if (!locale) {
    return 'en';
  }
  const normalized = locale.replace(/_/g, '-').toLowerCase();
  const exact = supportedByLowercase[normalized];
  if (exact) {
    return exact;
  }
  return localeAliases[normalized] ?? localeAliases[normalized.split('-')[0]] ?? 'en';
}

// A stored choice (i18nextLng, written by the settings language selector) wins;
// otherwise fall back to the browser language. SSR has no reliable locale
// signal (Bun defines `navigator` but leaves `language` empty), so it always
// renders the default locale and the browser takes over on hydration.
export function detectInitialLanguage(): SupportedLocale {
  if (typeof window === 'undefined') {
    return 'en';
  }
  const stored = localStorage.getItem('i18nextLng');
  if (stored) {
    return normalizeLocale(stored);
  }
  return normalizeLocale(navigator.language || navigator.languages?.[0]);
}

const initialLanguage = detectInitialLanguage();

i18n.use(initReactI18next).init({
  lng: initialLanguage,
  supportedLngs: [...supportedLocales],
  fallbackLng: {
    zh: ['zh-Hans'],
    default: ['en'],
  },
  fallbackNS: 'translation',
  ns: ['translation'],
  debug: false,
  defaultNS,
  resources,
  interpolation: { escapeValue: false },
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = initialLanguage;
}

export default i18n;
