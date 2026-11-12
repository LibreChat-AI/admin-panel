import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
import { renderTab, PAGE_TREE, RAW_TREE } from '@/test/page';
import { getValueAtPath, setValueAtPath } from '@/utils';
import { createServerContract } from '@/test/fixtures';
import { YAML_MANAGED_FIELDS } from '@/constants';
import { AzureGroupsTable } from '../AzureGroups';

vi.setConfig({ testTimeout: COVERAGE_TEST_TIMEOUT_MS });

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

const ENDPOINTS = findSchemaField(RAW_TREE, 'endpoints')!;
/** The AI providers tab's part of `endpoints`: everything but the custom endpoints list. */
const PROVIDERS: t.SchemaField = {
  ...ENDPOINTS,
  children: (ENDPOINTS.children ?? []).filter((child) => child.key !== 'custom'),
};
const SAMPLE = sampleValue(PROVIDERS) as t.ConfigRecord;
const SAMPLE_DATA: t.ConfigRecord = { endpoints: SAMPLE };
/** Azure groups are read-only (D13): a table, and each group's details drawer. */
const AZURE_GROUPS = 'endpoints.azureOpenAI.groups';
const isAzureGroups = (path: string) =>
  path === AZURE_GROUPS || path.startsWith(`${AZURE_GROUPS}.`);

const HIDDEN: HiddenFields = {};

/** `tree` with only the providers `keep` names under `endpoints`, so a render stays small. */
function withProviders(tree: t.SchemaField[], keep: (key: string) => boolean): t.SchemaField[] {
  return tree.map((section) =>
    section.key === 'endpoints'
      ? { ...section, children: section.children?.filter((child) => keep(child.key)) }
      : section,
  );
}

/** The provider a schema path is under (`endpoints.agents.fileSharing` → `agents`). */
const providerOf = (path: string) => path.split('.')[1];

function renderProvider(field: t.SchemaField, tree: t.SchemaField[], yaml: t.ConfigRecord) {
  const provider = providerOf(field.path);
  return renderTab({
    tab: 'providers',
    expandAll: true,
    tree: provider ? withProviders(tree, (key) => key === provider) : tree,
    yaml,
  });
}

/** The sample of one provider (or none for `endpoints` itself). */
function sampleOf(field: t.SchemaField): t.ConfigRecord {
  const provider = providerOf(field.path);
  return provider ? { endpoints: { [provider]: SAMPLE[provider] } } : {};
}

/** The Azure groups table with the details drawer of its first group open. */
function renderAzureDetails(groups: t.SchemaField | undefined, value: t.ConfigValue) {
  const view = render(<AzureGroupsTable path={AZURE_GROUPS} value={value} field={groups} />);
  fireEvent.click(screen.getAllByRole('button', { name: /^Details of Azure group/ })[0]);
  return view;
}

describe('AI providers tab: every schema field is reachable', () => {
  it('renders every leaf of every provider, Global included, and every Azure group setting', () => {
    const tab = renderTab({ tab: 'providers', expandAll: true, yaml: SAMPLE_DATA });
    const shown = new Set(renderedLeaves(PROVIDERS, SAMPLE_DATA));
    tab.unmount();
    renderAzureDetails(
      findSchemaField(RAW_TREE, AZURE_GROUPS),
      getValueAtPath(SAMPLE_DATA, AZURE_GROUPS),
    );
    for (const leaf of renderedLeaves(PROVIDERS, SAMPLE_DATA)) shown.add(leaf);
    expect(missingLeaves(PROVIDERS, shown, HIDDEN)).toEqual([]);
  });

  it('names no hidden field the schema no longer has', () => {
    expect(staleHidden([PROVIDERS], HIDDEN)).toEqual([]);
  });
});

const OBJECTS = objectFields(PROVIDERS).filter((field) => !isAzureGroups(field.path));
/** Objects LibreChat reads only from librechat.yaml (Vertex, D13): shown read-only. */
const isManaged = (path: string) =>
  [...YAML_MANAGED_FIELDS].some((managed) => path === managed || path.startsWith(`${managed}.`));
const EDITABLE = OBJECTS.filter((field) => !isManaged(field.path));
const MANAGED = OBJECTS.filter((field) => isManaged(field.path));

describe('AI providers tab: settings a newer schema adds', () => {
  it.each(EDITABLE.map((field) => [field.path, field] as const))(
    'under %s: get a control, and an edit is saved at their path',
    (_path, field) => {
      const yaml = sampleOf(field);
      const view = renderProvider(field, withSyntheticFields(PAGE_TREE, field.path), yaml);
      expect(editSynthetic(objectDataPath(field, yaml), view.plan)).toEqual([]);
    },
  );

  it.each(MANAGED.map((field) => [field.path, field] as const))(
    'under %s (read-only): are shown without a control to edit them',
    (_path, field) => {
      const yaml = sampleOf(field);
      renderProvider(field, withSyntheticFields(PAGE_TREE, field.path), yaml);
      const base = objectDataPath(field, yaml);
      for (const path of [
        `${base}.${SYNTHETIC_TEXT}`,
        `${base}.${SYNTHETIC_GROUP}.${SYNTHETIC_FLAG}`,
      ]) {
        const control = controlAt(path);
        expect(control.querySelector('input:not([disabled]), textarea:not([disabled])')).toBeNull();
      }
    },
  );

  it('a new provider gets its own card', () => {
    const tree = withProviders(
      withSyntheticFields(PAGE_TREE, 'endpoints'),
      (key) => key === SYNTHETIC_GROUP,
    );
    renderTab({ tab: 'providers', expandAll: true, tree });
    expect(screen.getByRole('heading', { name: new RegExp(SYNTHETIC_GROUP) })).toBeVisible();
  });

  it.each([AZURE_GROUPS, `${AZURE_GROUPS}.[].models`])(
    'under %s (read-only): are listed in the group details',
    (parent) => {
      const tree = withSyntheticFields(RAW_TREE, parent);
      const base = objectDataPath(findSchemaField(tree, parent)!, SAMPLE_DATA);
      const data = setValueAtPath(
        setValueAtPath(SAMPLE_DATA, `${base}.${SYNTHETIC_TEXT}`, 'set in librechat.yaml'),
        `${base}.${SYNTHETIC_GROUP}.${SYNTHETIC_FLAG}`,
        true,
      );
      renderAzureDetails(findSchemaField(tree, AZURE_GROUPS), getValueAtPath(data, AZURE_GROUPS));
      expect(controlAt(`${base}.${SYNTHETIC_TEXT}`)).toHaveTextContent('set in librechat.yaml');
      expect(controlAt(`${base}.${SYNTHETIC_GROUP}.${SYNTHETIC_FLAG}`)).toHaveTextContent('On');
    },
  );
});

describe('AI providers tab: keys the schema does not know', () => {
  it.each(OBJECTS.map((field) => [field.path, field] as const))(
    'under %s: are listed read-only',
    (_path, field) => {
      const sample = sampleOf(field);
      const base = objectDataPath(field, sample);
      const yaml = setValueAtPath(sample, `${base}.${UNKNOWN_KEY}`, 'kept as is');
      renderProvider(field, PAGE_TREE, yaml);
      const list = unknownSettingsAt(base);
      expect(list).not.toBeNull();
      expect(list).toHaveTextContent(UNKNOWN_KEY);
      expect(list).toHaveTextContent('kept as is');
    },
  );

  it('in an Azure group: are listed in its details', () => {
    const data = setValueAtPath(SAMPLE_DATA, `${AZURE_GROUPS}.0.${UNKNOWN_KEY}`, 'kept as is');
    renderAzureDetails(findSchemaField(RAW_TREE, AZURE_GROUPS), getValueAtPath(data, AZURE_GROUPS));
    expect(controlAt(`${AZURE_GROUPS}.0.${UNKNOWN_KEY}`)).toHaveTextContent('kept as is');
  });
});

/** A server that derives Azure groups and Vertex AI from overrides again: both are edited in the panel. */
const REDERIVE = createServerContract({
  endpointRederive: true,
  azureGroupMergeKey: true,
  azureGroupSecrets: true,
});

/** The providers tab on such a server, with the editor of the first Azure group open. */
function renderGroupEditor(tree: t.SchemaField[], yaml: t.ConfigRecord) {
  const view = renderTab({
    tab: 'providers',
    expandAll: true,
    tree: withProviders(tree, (key) => key === 'azureOpenAI'),
    yaml,
    contract: REDERIVE,
  });
  fireEvent.click(screen.getAllByRole('button', { name: /^Edit Azure group/ })[0]);
  return view;
}

describe('AI providers tab, LibreChat deriving groups again (endpointRederive)', () => {
  it('renders every setting of an Azure group in its editor', () => {
    renderGroupEditor(PAGE_TREE, SAMPLE_DATA);
    const groups = findSchemaField(RAW_TREE, AZURE_GROUPS)!;
    const shown = renderedLeaves(groups, SAMPLE_DATA);
    expect(missingLeaves(groups, shown, HIDDEN)).toEqual([]);
  });

  it.each([AZURE_GROUPS, `${AZURE_GROUPS}.[].models`])(
    'under %s: a newer schema setting gets a control, and an edit is saved with its group',
    (parent) => {
      const tree = withSyntheticFields(PAGE_TREE, parent);
      const field = findSchemaField(tree, parent)!;
      const view = renderGroupEditor(tree, SAMPLE_DATA);
      expect(editSynthetic(objectDataPath(field, SAMPLE_DATA), view.plan)).toEqual([]);
    },
  );

  it('lists keys the schema does not know in the group editor', () => {
    const data = setValueAtPath(SAMPLE_DATA, `${AZURE_GROUPS}.0.${UNKNOWN_KEY}`, 'kept as is');
    renderGroupEditor(PAGE_TREE, data);
    const list = unknownSettingsAt(`${AZURE_GROUPS}.0`);
    expect(list).toHaveTextContent(UNKNOWN_KEY);
    expect(list).toHaveTextContent('kept as is');
  });

  it('edits Vertex AI settings a newer schema adds, saved at their path', () => {
    const vertex = OBJECTS.find((field) => field.path === 'endpoints.anthropic.vertex')!;
    const yaml = sampleOf(vertex);
    const view = renderTab({
      tab: 'providers',
      expandAll: true,
      tree: withProviders(
        withSyntheticFields(PAGE_TREE, vertex.path),
        (key) => key === 'anthropic',
      ),
      yaml,
      contract: REDERIVE,
    });
    expect(editSynthetic(objectDataPath(vertex, yaml), view.plan)).toEqual([]);
  });
});
