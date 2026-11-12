import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { HiddenFields } from '@/test/coverage';
import type * as t from '@/types';
import {
  COVERAGE_TEST_TIMEOUT_MS,
  UNKNOWN_KEY,
  SYNTHETIC_FLAG,
  SYNTHETIC_TEXT,
  SYNTHETIC_GROUP,
  controlAt,
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
import { READ_ONLY_CONFIG_SECTIONS, YAML_MANAGED_FIELDS } from '@/constants';
import { SECTION_META } from '@/components/configuration/configMeta';
import { renderTab, PAGE_TREE, RAW_TREE } from '@/test/page';
import { createServerContract } from '@/test/fixtures';
import { setValueAtPath } from '@/utils';

vi.setConfig({ testTimeout: COVERAGE_TEST_TIMEOUT_MS });

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

/** The Files and System tabs: storage, MIME lists, file config, registration, credits, limits, skill sync. */
const TABS = ['files', 'system'] as const;

/** The schema sections a tab shows, by SECTION_META. */
function rootsOf(tab: string): t.SchemaField[] {
  return Object.entries(SECTION_META)
    .filter(([, meta]) => meta.tab === tab)
    .flatMap(([id, meta]) => findSchemaField(RAW_TREE, meta.schemaKey ?? id) ?? []);
}

/** librechat.yaml with every setting of `roots` set. */
function sampleOf(roots: t.SchemaField[]): t.ConfigRecord {
  return Object.fromEntries(roots.map((root) => [root.key, sampleValue(root)]));
}

/** LibreChat reads these only from librechat.yaml (D5): they are shown, never edited. */
function isReadOnly(path: string): boolean {
  const section = path.split('.')[0];
  if (READ_ONLY_CONFIG_SECTIONS.has(section)) return true;
  return [...YAML_MANAGED_FIELDS].some(
    (managed) => path === managed || path.startsWith(`${managed}.`),
  );
}

const HIDDEN: HiddenFields = {};

/** A server that applies Base overrides before sign-in: the social sign-in buttons are edited in Base. */
const PRE_AUTH_SERVER = createServerContract({ preAuthBaseOverrides: true });

describe('social sign-in buttons, by the server', () => {
  const yaml = { registration: { socialLogins: ['openid', 'google'] } };
  const addOption = () => screen.queryByRole('combobox', { name: /Add sign-in option/ });

  it('are read-only on a server without pre-auth Base overrides', () => {
    renderTab({ tab: 'system', expandAll: true, yaml });
    expect(controlAt('registration.socialLogins')).toHaveTextContent(/OpenID Connect.*Google/);
    expect(addOption()).toBeNull();
  });

  it('are edited in Base, and saved, on a server with pre-auth Base overrides', () => {
    const view = renderTab({ tab: 'system', expandAll: true, yaml, contract: PRE_AUTH_SERVER });
    fireEvent.change(addOption()!, { target: { value: 'github' } });
    const plan = view.plan();
    expect(plan.sets).toEqual([
      { fieldPath: 'registration.socialLogins', value: ['openid', 'google', 'github'] },
    ]);
    expect(plan.skipped).toEqual([]);
  });
});

describe.each(TABS)('%s tab', (tab) => {
  const roots = rootsOf(tab);
  const sample = sampleOf(roots);
  const objects = roots.flatMap(objectFields);
  const editable = objects.filter((field) => !isReadOnly(field.path));
  const readOnly = objects.filter((field) => isReadOnly(field.path));
  /** The sample of the section a field is in, so a render stays small. */
  const sampleFor = (field: t.SchemaField): t.ConfigRecord => {
    const section = field.path.split('.')[0];
    return { [section]: sample[section] };
  };
  const renderIt = (options: Omit<Parameters<typeof renderTab>[0], 'tab'>) =>
    renderTab({ tab, expandAll: true, ...options });

  it('renders every leaf of its sections', () => {
    renderIt({ yaml: sample });
    const shown = roots.flatMap((root) => renderedLeaves(root, sample));
    expect(roots.flatMap((root) => missingLeaves(root, shown, HIDDEN))).toEqual([]);
  });

  it('names no hidden field the schema no longer has', () => {
    expect(staleHidden(roots, HIDDEN)).toEqual([]);
  });

  it("renders every leaf of its sections under a server's write rules (pre-auth Base overrides)", () => {
    renderIt({ yaml: sample, contract: PRE_AUTH_SERVER });
    const shown = roots.flatMap((root) => renderedLeaves(root, sample));
    expect(roots.flatMap((root) => missingLeaves(root, shown, HIDDEN))).toEqual([]);
  });

  it.each(editable.map((field) => [field.path, field] as const))(
    'settings a newer schema adds under %s get a control, and an edit is saved at their path',
    (_path, field) => {
      const yaml = sampleFor(field);
      const view = renderIt({ tree: withSyntheticFields(PAGE_TREE, field.path), yaml });
      expect(editSynthetic(objectDataPath(field, yaml), view.plan)).toEqual([]);
    },
  );

  it.each(readOnly.map((field) => [field.path, field] as const))(
    'settings a newer schema adds under %s (read-only) are shown with their value',
    (_path, field) => {
      const sampled = sampleFor(field);
      const base = objectDataPath(field, sampled);
      const yaml = setValueAtPath(
        setValueAtPath(sampled, `${base}.${SYNTHETIC_TEXT}`, 'set in librechat.yaml'),
        `${base}.${SYNTHETIC_GROUP}.${SYNTHETIC_FLAG}`,
        true,
      );
      renderIt({ tree: withSyntheticFields(PAGE_TREE, field.path), yaml });
      const text = controlAt(`${base}.${SYNTHETIC_TEXT}`);
      expect(text.textContent || (text as HTMLInputElement).value).toContain(
        'set in librechat.yaml',
      );
      controlAt(`${base}.${SYNTHETIC_GROUP}.${SYNTHETIC_FLAG}`);
    },
  );

  it.each(objects.map((field) => [field.path, field] as const))(
    'keys the schema does not know under %s are listed read-only',
    (_path, field) => {
      const sampled = sampleFor(field);
      const base = objectDataPath(field, sampled);
      renderIt({ yaml: setValueAtPath(sampled, `${base}.${UNKNOWN_KEY}`, 'kept as is') });
      const list = unknownSettingsAt(base);
      expect(list).not.toBeNull();
      expect(list).toHaveTextContent(UNKNOWN_KEY);
      expect(list).toHaveTextContent('kept as is');
    },
  );
});
