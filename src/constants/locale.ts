import type * as t from '@/types';

export const DEFAULT_LANGUAGE: t.LanguageCode = 'en';

export const LANGUAGE_STORAGE_KEY = 'admin-panel:language';

export const LANGUAGES: readonly t.LanguageOption[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'fa', nativeName: 'فارسی' },
];

export const LANGUAGE_CODES: readonly t.LanguageCode[] = LANGUAGES.map(({ code }) => code);
