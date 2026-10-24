import '@/locales/i18n';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function renderPreview(preview: t.ImportPreviewState) {
  return render(
    <Preview
      preview={preview}
      targetLabel="Role: USER"
      isScope
      included={new Set(['endpoints.agents.allowedProviders'])}
      onToggle={() => undefined}
    />,
  );
}

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
});
