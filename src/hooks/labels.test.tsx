import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ClickUIProvider, createToast } from '@clickhouse/click-ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SearchInput } from '@/components/shared';
import { useToastCloseLabels } from './dialogs';
import '@/locales/i18n';

function Toasts() {
  useToastCloseLabels('Close');
  return null;
}

describe('useToastCloseLabels', () => {
  it('names each toast close button "Close" instead of its icon', async () => {
    render(
      <ClickUIProvider theme="light">
        <Toasts />
      </ClickUIProvider>,
    );
    act(() => createToast({ type: 'default', title: 'Changes discarded' }));
    expect(await screen.findByText('Changes discarded')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'cross' })).toBeNull();
  });
});

function Search() {
  const [value, setValue] = useState('tools');
  return (
    <SearchInput value={value} onChange={setValue} placeholder="Search…" ariaLabel="Search tools" />
  );
}

describe('useClearButtonLabel', () => {
  it("names a search field's clear button in the panel's language, each time it comes back", async () => {
    render(<Search />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tools' }), {
      target: { value: 'mcp' },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear' })).toBeVisible());
    expect(screen.queryByRole('button', { name: 'clear input' })).toBeNull();
  });
});
