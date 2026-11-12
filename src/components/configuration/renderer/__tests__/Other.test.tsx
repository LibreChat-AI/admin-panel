import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type * as t from '@/types';
import { OtherSettings } from '../Other';

const field = (key: string, type: string): t.SchemaField => ({
  key,
  path: `balance.${key}`,
  type,
  isOptional: true,
  depth: 1,
});

describe('OtherSettings', () => {
  it('renders the schema fields a custom renderer does not place, then unknown keys', () => {
    render(
      <OtherSettings
        fields={[field('enabled', 'boolean'), field('refillCap', 'number')]}
        placed={new Set(['enabled'])}
        parentPath="balance"
        parentValue={{ enabled: true, refillCap: 5, futureKey: 'x' }}
        getValue={(_path, fallback) => fallback}
        onChange={vi.fn()}
      />,
    );
    expect(document.getElementById('balance-refillCap')).toBeInTheDocument();
    expect(document.getElementById('balance-enabled')).toBeNull();
    expect(screen.getByText('futureKey')).toBeInTheDocument();
  });
});
