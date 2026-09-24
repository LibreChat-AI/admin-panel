/**
 * Guards locale parity between en and zh-Hans: identical key sets,
 * matching interpolation placeholders, and a working language switch.
 */
import { describe, it, expect } from 'vitest';
import i18n, { normalizeLocale, detectInitialLanguage } from './i18n';
import en from './en/translation.json';
import zhHans from './zh-Hans/translation.json';

const enKeys = Object.keys(en).sort();
const zhKeys = Object.keys(zhHans).sort();

describe('locale parity (en / zh-Hans)', () => {
  it('zh-Hans defines the same key set as en', () => {
    expect(zhKeys).toEqual(enKeys);
  });

  it('interpolation placeholders match en for every key', () => {
    const re = /\{\{[^}]+\}\}/g;
    const mismatches = enKeys.filter(
      (key) =>
        (String(en[key as keyof typeof en]).match(re) ?? []).sort().join() !==
        (String(zhHans[key as keyof typeof zhHans]).match(re) ?? []).sort().join(),
    );
    expect(mismatches).toHaveLength(0);
  });

  it('switches to zh-Hans and back', async () => {
    await i18n.changeLanguage('zh-Hans');
    expect(i18n.t('com_ui_save')).toBe(zhHans['com_ui_save']);
    await i18n.changeLanguage('en');
    expect(i18n.t('com_ui_save')).toBe(en['com_ui_save']);
  });

  it('resolves browser-style zh codes to zh-Hans', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(i18n.t('com_ui_save')).toBe(zhHans['com_ui_save']);
    await i18n.changeLanguage('zh');
    expect(i18n.t('com_ui_save')).toBe(zhHans['com_ui_save']);
    await i18n.changeLanguage('en');
    expect(i18n.t('com_ui_save')).toBe(en['com_ui_save']);
  });
});

describe('locale normalization (LibreChat-style)', () => {
  it('maps exact, alias, and base-language codes to supported locales', () => {
    expect(normalizeLocale(null)).toBe('en');
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('zh-CN')).toBe('zh-Hans');
    expect(normalizeLocale('zh')).toBe('zh-Hans');
    expect(normalizeLocale('zh-Hans')).toBe('zh-Hans');
    expect(normalizeLocale('zh_TW')).toBe('zh-Hans');
    expect(normalizeLocale('zh-TW')).toBe('zh-Hans');
    expect(normalizeLocale('fr')).toBe('en');
  });

  it('prefers a stored choice over the browser language', () => {
    localStorage.setItem('i18nextLng', 'zh-Hans');
    expect(detectInitialLanguage()).toBe('zh-Hans');
    localStorage.setItem('i18nextLng', 'en');
    expect(detectInitialLanguage()).toBe('en');
    localStorage.removeItem('i18nextLng');
  });
});
