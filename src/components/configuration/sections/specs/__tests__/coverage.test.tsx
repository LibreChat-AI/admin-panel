import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { HiddenFields } from '@/test/coverage';
import type * as t from '@/types';
import {
  COVERAGE_TEST_TIMEOUT_MS,
  UNKNOWN_KEY,
  SYNTHETIC_TEXT,
  SYNTHETIC_GROUP,
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

const SPECS = findSchemaField(RAW_TREE, 'modelSpecs')!;
const PRESET = 'modelSpecs.list.[].preset';
const SAMPLE = sampleValue(SPECS) as t.ConfigRecord;
const SAMPLE_DATA: t.ConfigRecord = { modelSpecs: SAMPLE };
/** An agent spec: its agent replaces the model, so its editor differs. */
const AGENT_DATA = setValueAtPath(
  setValueAtPath(SAMPLE_DATA, 'modelSpecs.list.0.preset.endpoint', 'agents'),
  'modelSpecs.list.0.preset.agent_id',
  'agent_123',
);

/** "How users pick models" edits Enforce and Prioritize together as one choice. */
const COMBINED: Readonly<Record<string, string>> = {
  'modelSpecs.enforce': 'modelSpecs-mode',
  'modelSpecs.prioritize': 'modelSpecs-mode',
};

const HIDDEN: HiddenFields = {};

function renderSpecs(options: Omit<Parameters<typeof renderTab>[0], 'tab'>) {
  return renderTab({ tab: 'specs', expandAll: true, ...options });
}

describe('Model specs tab: every schema field is reachable', () => {
  it('renders every leaf of the mode, the list, each spec and its preset', () => {
    const shown = new Set<string>();
    for (const data of [SAMPLE_DATA, AGENT_DATA]) {
      const view = renderSpecs({ yaml: data });
      for (const leaf of renderedLeaves(SPECS, data)) shown.add(leaf);
      for (const [leaf, id] of Object.entries(COMBINED)) {
        if (document.getElementById(id)) shown.add(leaf);
      }
      view.unmount();
    }
    expect(missingLeaves(SPECS, shown, HIDDEN)).toEqual([]);
  });

  it('names no hidden field the schema no longer has', () => {
    expect(staleHidden([SPECS], HIDDEN)).toEqual([]);
  });
});

const OBJECTS = objectFields(SPECS);

/** Opens "Advanced (raw)" of the first spec's preset and adds `key` from its picker. */
function addPresetField(key: string): void {
  const id = `${toFieldId('modelSpecs.list.0.preset')}-raw-add`;
  if (!document.getElementById(id)) {
    fireEvent.click(screen.getByRole('button', { name: 'Advanced (raw)' }));
  }
  const picker = document.getElementById(id);
  if (!picker) throw new Error('no preset field picker');
  fireEvent.change(picker, { target: { value: key } });
}

describe('Model specs tab: settings a newer schema adds', () => {
  it.each(OBJECTS.map((field) => [field.path, field] as const))(
    'under %s: get a control, and an edit is saved at their path',
    (_path, field) => {
      const view = renderSpecs({
        tree: withSyntheticFields(PAGE_TREE, field.path),
        yaml: SAMPLE_DATA,
      });
      if (field.path === PRESET) {
        addPresetField(SYNTHETIC_TEXT);
        addPresetField(SYNTHETIC_GROUP);
      }
      expect(editSynthetic(objectDataPath(field, SAMPLE_DATA), view.plan)).toEqual([]);
    },
  );
});

describe('Model specs tab: keys the schema does not know', () => {
  it.each(OBJECTS.map((field) => [field.path, field] as const))(
    'under %s: are listed read-only',
    (_path, field) => {
      const base = objectDataPath(field, SAMPLE_DATA);
      renderSpecs({ yaml: setValueAtPath(SAMPLE_DATA, `${base}.${UNKNOWN_KEY}`, 'kept as is') });
      const list = unknownSettingsAt(base);
      expect(list).not.toBeNull();
      expect(list).toHaveTextContent(UNKNOWN_KEY);
      expect(list).toHaveTextContent('kept as is');
    },
  );
});
