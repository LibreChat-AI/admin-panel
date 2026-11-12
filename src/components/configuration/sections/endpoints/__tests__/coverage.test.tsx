import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { HiddenFields } from '@/test/coverage';
import type * as t from '@/types';
import {
  COVERAGE_TEST_TIMEOUT_MS,
  UNKNOWN_KEY,
  SYNTHETIC_TEXT,
  SYNTHETIC_GROUP,
  typeInto,
  sampleValue,
  staleHidden,
  objectFields,
  editSynthetic,
  missingLeaves,
  renderedLeaves,
  objectDataPath,
  findSchemaField,
  unknownSettingsAt,
  withSyntheticFields,
} from '@/test/coverage';
import { toFieldId } from '@/components/configuration/renderer';
import { renderTab, PAGE_TREE, RAW_TREE } from '@/test/page';
import { setValueAtPath } from '@/utils';

vi.setConfig({ testTimeout: COVERAGE_TEST_TIMEOUT_MS });

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

const CUSTOM = findSchemaField(RAW_TREE, 'endpoints.custom')!;
const NAME = 'Sample';
const ENTRY: t.ConfigRecord = {
  ...((sampleValue(CUSTOM) as t.ConfigValue[])[0] as t.ConfigRecord),
  name: NAME,
  baseURL: 'https://api.example.com/v1',
};
const DATA: t.ConfigRecord = { endpoints: { custom: [ENTRY] } };
const ENTRY_PATH = 'endpoints.custom.0';

const HIDDEN: HiddenFields = {};

const DEFINITION = 'endpoints.custom.[].customParams.paramDefinitions.[]';
/**
 * Leaves another leaf's row edits: a definition's label and description row
 * says when the text is a built-in locale code (`labelCode`) and switches it
 * to custom text.
 */
const EDITED_WITH: Readonly<Record<string, string>> = {
  [`${DEFINITION}.labelCode`]: `${DEFINITION}.label`,
  [`${DEFINITION}.descriptionCode`]: `${DEFINITION}.description`,
};

function renderCustom(options: Omit<Parameters<typeof renderTab>[0], 'tab'>) {
  return renderTab({ tab: 'custom', expandAll: true, ...options });
}

/** Opens the editor drawer of an endpoint from its row in the list. */
function openEndpoint(name: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(
    `[data-endpoint-row="${name}"] button[aria-haspopup="dialog"]`,
  );
  if (!button) throw new Error(`no row for ${name}`);
  fireEvent.click(button);
  return screen.getByRole('dialog');
}

/** Picks each of `keys` that an "Add setting" list of the open editor offers. */
function addSettings(dialog: HTMLElement, keys: string[]): void {
  for (const key of keys) {
    const picker = [...dialog.querySelectorAll<HTMLSelectElement>('select[id$="-add"]')].find(
      (select) => [...select.options].some((option) => option.value === key),
    );
    if (picker) fireEvent.change(picker, { target: { value: key } });
  }
}

/** The synthetic keys of an object, relative to the endpoint entry (`models.zzNewSetting`). */
function syntheticKeys(base: string): string[] {
  const prefix = base === ENTRY_PATH ? '' : `${base.slice(ENTRY_PATH.length + 1)}.`;
  return [`${prefix}${SYNTHETIC_TEXT}`, `${prefix}${SYNTHETIC_GROUP}`];
}

describe('Custom endpoints tab: every schema field is reachable', () => {
  it('renders every leaf of an endpoint in its editor', () => {
    renderCustom({ yaml: DATA });
    openEndpoint(NAME);
    const shown = new Set(renderedLeaves(CUSTOM, DATA));
    for (const [leaf, row] of Object.entries(EDITED_WITH)) if (shown.has(row)) shown.add(leaf);
    expect(missingLeaves(CUSTOM, shown, HIDDEN)).toEqual([]);
  });

  it('names no hidden field the schema no longer has', () => {
    expect(staleHidden([CUSTOM], HIDDEN)).toEqual([]);
  });
});

const OBJECTS = objectFields(CUSTOM);

describe('Custom endpoints tab: settings a newer schema adds', () => {
  it.each(OBJECTS.map((field) => [field.path, field] as const))(
    'under %s: get a control, and an edit is saved at their path',
    (_path, field) => {
      const view = renderCustom({ tree: withSyntheticFields(PAGE_TREE, field.path), yaml: DATA });
      const dialog = openEndpoint(NAME);
      const base = objectDataPath(field, DATA);
      addSettings(dialog, syntheticKeys(base));
      expect(editSynthetic(base, view.plan)).toEqual([]);
    },
  );

  it('in Create endpoint: the new endpoint opens in its editor, which edits them', async () => {
    vi.useFakeTimers();
    try {
      const view = renderCustom({ tree: withSyntheticFields(PAGE_TREE, 'endpoints.custom') });
      fireEvent.click(screen.getByRole('button', { name: 'Create endpoint' }));
      fireEvent.click(screen.getByRole('button', { name: /Blank endpoint/ }));
      const draft = 'endpoints.custom.9999';
      typeInto(`${draft}.name`, 'Fresh');
      typeInto(`${draft}.baseURL`, 'https://api.example.com/v1');
      typeInto(`${draft}.apiKey`, '${FRESH_KEY}');
      const models = document.querySelector<HTMLInputElement>(
        `#${toFieldId(`${draft}.models.default`)} input:not([type="hidden"])`,
      );
      if (!models) throw new Error('no model input');
      fireEvent.change(models, { target: { value: 'fresh-model' } });
      fireEvent.keyDown(models, { key: 'Enter' });
      await act(async () => {
        vi.runOnlyPendingTimers();
      });
      const create = within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Create endpoint',
      });
      fireEvent.click(create);
      await act(async () => {
        vi.runOnlyPendingTimers();
      });
      addSettings(screen.getByRole('dialog'), [SYNTHETIC_TEXT, SYNTHETIC_GROUP]);
      expect(editSynthetic(ENTRY_PATH, view.plan)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Custom endpoints tab: keys the schema does not know', () => {
  it.each(OBJECTS.map((field) => [field.path, field] as const))(
    'under %s: are listed read-only',
    (_path, field) => {
      const base = objectDataPath(field, DATA);
      renderCustom({ yaml: setValueAtPath(DATA, `${base}.${UNKNOWN_KEY}`, 'kept as is') });
      openEndpoint(NAME);
      const list = unknownSettingsAt(base);
      expect(list).not.toBeNull();
      expect(list).toHaveTextContent(UNKNOWN_KEY);
      expect(list).toHaveTextContent('kept as is');
    },
  );
});
