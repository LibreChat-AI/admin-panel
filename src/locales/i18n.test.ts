import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import translation from '@/locales/en/translation.json';
import { useLocalize } from '@/hooks';
import i18n from '@/locales/i18n';

type Values = Record<string, string | number>;

const texts: Readonly<Record<string, string>> = translation;
const PLACEHOLDER = /\{\{(\w+)\}\}/g;
const SUFFIX_COUNTS: Readonly<Record<string, number>> = { zero: 0, one: 1 };
const PLURAL_COUNTS = [0, 1, 2, 21] as const;

/** A count that selects the plural form a key's suffix names (`_one` → 1), 2 otherwise. */
function sampleCount(key: string): number {
  return SUFFIX_COUNTS[key.slice(key.lastIndexOf('_') + 1)] ?? 2;
}

/** A value for each `{{name}}` of a text; `{{user.name}}`-style placeholders stay literal. */
function sampleValues(key: string, text: string): Values {
  return Object.fromEntries(
    [...text.matchAll(PLACEHOLDER)].map(([, name]) => [
      name,
      name === 'count' ? sampleCount(key) : `<${name}>`,
    ]),
  );
}

function fill(text: string, values: Values): string {
  return text.replace(PLACEHOLDER, (match, name: string) => String(values[name] ?? match));
}

/** The English form i18next should pick for a count: `_zero` for 0 when the key has one. */
function pluralText(base: string, count: number): string {
  if (count === 0 && `${base}_zero` in texts) return texts[`${base}_zero`];
  return texts[`${base}_${count === 1 ? 'one' : 'other'}`];
}

const pluralBases = Object.keys(texts)
  .filter((key) => key.endsWith('_one') && `${key.slice(0, -4)}_other` in texts)
  .map((key) => key.slice(0, -4));

describe('i18n', () => {
  it('renders every key as its own text with its values, never as its id', () => {
    const wrong = Object.entries(texts).flatMap(([key, text]) => {
      const values = sampleValues(key, text);
      const rendered = i18n.t(key, values);
      return rendered === fill(text, values) ? [] : [`${key}: ${rendered}`];
    });
    expect(wrong).toEqual([]);
  });

  it('picks the plural form for the count from the base key', () => {
    expect(pluralBases.length).toBeGreaterThan(0);
    const wrong = pluralBases.flatMap((base) =>
      PLURAL_COUNTS.flatMap((count) => {
        const text = pluralText(base, count);
        const values = { ...sampleValues(base, text), count };
        const rendered = i18n.t(base, values);
        return rendered === fill(text, values) ? [] : [`${base} (${count}): ${rendered}`];
      }),
    );
    expect(wrong).toEqual([]);
  });

  it('localizes through useLocalize with interpolation and plurals', () => {
    const { result } = renderHook(() => useLocalize());
    const localize = result.current;
    expect(localize('com_audit_entry_count', { count: 0 })).toBe(texts.com_audit_entry_count_zero);
    expect(localize('com_audit_entry_count', { count: 1 })).toBe('1 entry');
    expect(localize('com_audit_entry_count', { count: 44 })).toBe('44 entries');
    expect(i18n.resolvedLanguage).toBe('en');
  });
});
