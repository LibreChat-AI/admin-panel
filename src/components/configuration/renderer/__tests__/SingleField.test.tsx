import { describe, it, expect } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderSection } from '../../sections/features/__tests__/harness';
import { FieldRenderer } from '../FieldRenderer';
import '@/locales/i18n';

const YAML = { actions: { allowedDomains: ['a.com'] } };

describe('a domain allowlist the layer beneath sets', () => {
  it('drops a pending replacement list when its last domain is removed, so the lower list applies again', () => {
    const { onDiscardField } = renderSection(FieldRenderer, { section: 'actions', yaml: YAML });
    const input = screen.getByLabelText(/add a domain/);
    fireEvent.change(input, { target: { value: 'b.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.com' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Remove the restriction' });
    expect(confirm).toHaveTextContent('applies again');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove restriction' }));
    expect(onDiscardField).toHaveBeenCalledWith('actions.allowedDomains');
    expect(screen.getByRole('button', { name: 'Remove a.com' })).toBeInTheDocument();
    expect(screen.queryByText(/its last domain can't be removed here/)).not.toBeInTheDocument();
  });
});
