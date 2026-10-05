import { describe, it, expect } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  CONFIG_TABS,
  OTHER_TAB,
  SECTION_META,
  HIDDEN_SECTIONS,
  splitCamelCase,
} from './configMeta';

describe('splitCamelCase', () => {
  it('splits camelCase into words', () => {
    expect(splitCamelCase('fileConfig')).toEqual(['file', 'Config']);
  });

  it('returns single word unchanged', () => {
    expect(splitCamelCase('cache')).toEqual(['cache']);
  });
});

describe('SECTION_META / CONFIG_TABS consistency', () => {
  const validTabIds = new Set(CONFIG_TABS.map((t) => t.id));

  it('every SECTION_META entry maps to a valid tab', () => {
    for (const [key, meta] of Object.entries(SECTION_META)) {
      expect(
        validTabIds.has(meta.tab),
        `Section "${key}" references unknown tab "${meta.tab}"`,
      ).toBe(true);
    }
  });

  it('every SECTION_META entry has a titleKey and descriptionKey', () => {
    for (const [key, meta] of Object.entries(SECTION_META)) {
      expect(meta.titleKey, `Section "${key}" missing titleKey`).toBeTruthy();
      expect(meta.descriptionKey, `Section "${key}" missing descriptionKey`).toBeTruthy();
    }
  });

  it('every CONFIG_TAB has a non-empty id and labelKey', () => {
    for (const tab of CONFIG_TABS) {
      expect(tab.id).toBeTruthy();
      expect(tab.labelKey).toBeTruthy();
    }
  });
});

describe('Other tab routing', () => {
  const fakeSection = (key: string) => ({ key, children: [] });

  it('Other tab is hidden when all sections are in SECTION_META', () => {
    const schemaTree = Object.keys(SECTION_META).map(fakeSection);
    const hasUnmapped = schemaTree.some((s) => !(s.key in SECTION_META));

    expect(hasUnmapped).toBe(false);

    const visibleTabs = hasUnmapped ? [...CONFIG_TABS, OTHER_TAB] : CONFIG_TABS;
    expect(visibleTabs.find((t) => t.id === 'other')).toBeUndefined();
  });

  it('Other tab appears when schema has an unmapped section', () => {
    const schemaTree = [
      ...Object.keys(SECTION_META).slice(0, 3).map(fakeSection),
      fakeSection('brandNewSection'),
    ];
    const hasUnmapped = schemaTree.some((s) => !(s.key in SECTION_META));

    expect(hasUnmapped).toBe(true);

    const visibleTabs = hasUnmapped ? [...CONFIG_TABS, OTHER_TAB] : CONFIG_TABS;
    expect(visibleTabs.find((t) => t.id === 'other')).toBeDefined();
  });

  it('unmapped sections route to Other tab and mapped sections do not', () => {
    const mappedKey = Object.keys(SECTION_META)[0];
    const schemaTree = [fakeSection(mappedKey), fakeSection('unknownFeature')];

    const filterForTab = (activeTab: string) =>
      schemaTree.filter((s) => {
        if (activeTab === OTHER_TAB.id) return !(s.key in SECTION_META);
        return SECTION_META[s.key]?.tab === activeTab;
      });

    const mappedTab = SECTION_META[mappedKey].tab;
    expect(filterForTab(mappedTab).map((s) => s.key)).toEqual([mappedKey]);
    expect(filterForTab(OTHER_TAB.id).map((s) => s.key)).toEqual(['unknownFeature']);
  });
});

describe('schema coverage', () => {
  it('every top-level configSchema key has SECTION_META or is hidden', () => {
    const shape = (configSchema as t.ZodSchemaLike).shape ?? {};
    const unmapped = Object.keys(shape).filter(
      (key) => !HIDDEN_SECTIONS.has(key) && !Object.hasOwn(SECTION_META, key),
    );
    expect(unmapped, `Sections without SECTION_META: ${unmapped.join(', ')}`).toEqual([]);
  });
});
