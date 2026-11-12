import '@/locales/i18n';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type * as t from '@/types';
import { Preview } from '../Preview';

const note =
  "Role: USER hides Moonshot, so LibreChat leaves hidden endpoints out of the providers its members' agents may use.";

/** An import preview of one imported allow-list, with the notes on what the target's hides take from it. */
function previewOf(hiddenNotes?: string[]): t.ImportPreviewState {
  const fieldPath = 'endpoints.agents.allowedProviders';
  const row: t.ImportPreviewRow = {
    fieldPath,
    label: 'Allowed providers',
    rows: [
      {
        key: fieldPath,
        label: 'Allowed providers',
        item: { path: fieldPath, kind: 'added', before: undefined, after: ['Moonshot', 'groq'] },
      },
    ],
    unchanged: false,
    unknown: false,
    hiddenNotes,
  };
  return {
    groups: [{ key: 'endpoints:agents', title: 'Endpoints › Agents', rows: [row] }],
    skipped: [],
    entriesFor: () => [],
    issuesFor: () => [],
    loading: false,
  };
}

function renderPreview(
  preview: t.ImportPreviewState,
  unknownEnumValues: t.ImportEnumValue[] = [],
  included: ReadonlySet<string> = new Set(['endpoints.agents.allowedProviders']),
) {
  return render(
    <Preview
      preview={preview}
      targetLabel="Role: USER"
      isScope
      included={included}
      onToggle={() => undefined}
      unknownEnumValues={unknownEnumValues}
    />,
  );
}

/** A preview of one row per imported path, and the keys it leaves out. */
function rowsOf(paths: string[], skipped: t.ReviewSkippedRow[] = []): t.ImportPreviewState {
  const rows = paths.map((fieldPath): t.ImportPreviewRow => ({
    fieldPath,
    label: fieldPath,
    rows: [],
    unchanged: false,
    unknown: false,
  }));
  return { ...previewOf(), groups: [{ key: 'all', title: 'All', rows }], skipped };
}

const retentionMode: t.ImportEnumValue = {
  path: 'interface.retentionMode',
  value: 'someday',
  options: ['all', 'temporary'],
};
const capability: t.ImportEnumValue = {
  path: 'endpoints.agents.capabilities.2',
  value: 'teleport',
  options: ['tools', 'ocr'],
};
const noticeName = /this panel doesn't recognize/;

describe('the import preview', () => {
  it('says what the endpoints the target hides take from an imported value', () => {
    renderPreview(previewOf([note]));
    expect(screen.getByText(note)).toBeTruthy();
    expect(screen.getAllByText('Allowed providers')).toHaveLength(2);
  });

  it('shows a value without such notes as one row', () => {
    renderPreview(previewOf());
    expect(screen.queryByText(note)).toBeNull();
    expect(screen.getAllByText(/Allowed providers/)).toHaveLength(1);
  });

  it('names each enum value the import writes, with its path and the values this panel lists', () => {
    const paths = ['interface.retentionMode', 'endpoints.agents.capabilities'];
    renderPreview(rowsOf(paths), [retentionMode, capability], new Set(paths));
    const notice = screen.getByRole('region', { name: "2 values this panel doesn't recognize" });
    expect(
      within(notice).getByText(/LibreChat v0\.8\.8 and later check each one on save/),
    ).toBeTruthy();
    expect(within(notice).getByText(/Earlier releases store it without checking/)).toBeTruthy();
    const items = within(notice).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'interface.retentionMode: "someday" · this panel lists all, temporary',
      'endpoints.agents.capabilities.2: "teleport" · this panel lists tools, ocr',
    ]);
  });

  it('leaves out a value in a row left unchecked or in a key the import skips', () => {
    const effort = (index: number): t.ImportEnumValue => ({
      path: `modelSpecs.list.${index}.preset.reasoning_effort`,
      value: 'ultra',
      options: ['low', 'high'],
    });
    const skip = (path: string): t.ReviewSkippedRow => ({
      key: path,
      path,
      label: path,
      reason: '',
    });
    const preview = rowsOf(
      ['interface.retentionMode', 'endpoints.agents.capabilities', 'modelSpecs.list'],
      [skip('turnstile.options.size'), skip('modelSpecs.list.1')],
    );
    const turnstile = { path: 'turnstile.options.size', value: 'huge', options: ['normal'] };
    renderPreview(
      preview,
      [retentionMode, capability, turnstile, effort(0), effort(1)],
      new Set(['endpoints.agents.capabilities', 'modelSpecs.list']),
    );
    const notice = screen.getByRole('region', { name: "2 values this panel doesn't recognize" });
    expect(
      within(notice)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'endpoints.agents.capabilities.2: "teleport" · this panel lists tools, ocr',
      'modelSpecs.list.0.preset.reasoning_effort: "ultra" · this panel lists low, high',
    ]);
  });

  it('shows no such notice when the import writes none of them, or every enum value is known', () => {
    const { unmount } = renderPreview(
      rowsOf(['interface.retentionMode']),
      [retentionMode],
      new Set(),
    );
    expect(screen.queryByRole('region', { name: noticeName })).toBeNull();
    unmount();
    renderPreview(previewOf());
    expect(screen.queryByRole('region', { name: noticeName })).toBeNull();
  });
});
