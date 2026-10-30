export type LanguageCode = 'en' | 'fa';

/** A language the panel ships, labeled by its own name so it reads the same in every locale. */
export interface LanguageOption {
  code: LanguageCode;
  nativeName: string;
}
