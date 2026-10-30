import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import english from '@/locales/en/translation.json';
import persian from '@/locales/fa/translation.json';
import { useLanguage, useLocalize } from '@/hooks';
import i18n from '@/locales/i18n';

const en: Readonly<Record<string, string>> = english;
const fa: Readonly<Record<string, string>> = persian;
const PLACEHOLDER = /\{\{[^}]+\}\}|\$\{[A-Z_]+\}/g;

/** Keys whose `{{action}}` is a raw English word from code, so the Persian text names both actions instead. */
const ACTION_WORD_KEYS: ReadonlySet<string> = new Set([
  'com_config_issue_inherited_entry_immutable',
  'com_config_issue_yaml_entry_immutable',
]);

function placeholders(text: string): string {
  return [...text.matchAll(PLACEHOLDER)]
    .map(([match]) => match)
    .sort()
    .join('|');
}

describe('Persian locale', () => {
  afterEach(async () => {
    await act(() => i18n.changeLanguage('en'));
  });

  it('only has keys the English file defines', () => {
    expect(Object.keys(fa).filter((key) => !(key in en))).toEqual([]);
  });

  it('keeps every placeholder of the English text', () => {
    const wrong = Object.keys(fa).filter(
      (key) => !ACTION_WORD_KEYS.has(key) && placeholders(en[key]) !== placeholders(fa[key]),
    );
    expect(wrong).toEqual([]);
  });

  it('switches the document to right-to-left and back', async () => {
    await act(() => i18n.changeLanguage('fa'));
    expect(document.documentElement.lang).toBe('fa');
    expect(document.documentElement.dir).toBe('rtl');

    await act(() => i18n.changeLanguage('en'));
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('localizes through the hooks after a language change', () => {
    const { result } = renderHook(() => ({ language: useLanguage(), localize: useLocalize() }));
    act(() => result.current.language.setLanguage('fa'));

    expect(result.current.language.language).toBe('fa');
    expect(result.current.language.direction).toBe('rtl');
    expect(result.current.localize('com_audit_entry_count', { count: 3 })).toBe('3 مورد');
  });
});
