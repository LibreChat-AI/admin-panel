import '@/locales/i18n';
import { Dialog } from '@clickhouse/click-ui';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminUserSearchResult } from '@librechat/data-schemas';
import { UserSearchInline } from '../UserSearchInline';
import { searchUsersFn } from '@/server';

const USERS: AdminUserSearchResult[] = [
  { id: 'u1', name: 'Alice Chen', email: 'alice@example.com' },
  { id: 'u2', name: 'Alan Kay', email: 'alan@example.com' },
];

vi.mock('@/server', () => ({
  searchUsersFn: vi.fn(async ({ data }: { data: { query: string } }) => ({
    users: USERS.filter((user) => user.name.toLowerCase().includes(data.query.toLowerCase())),
  })),
}));

/** The field in a dialog, as the Edit role, Edit group and Create group dialogs hold it. */
function renderInDialog() {
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open onOpenChange={onOpenChange}>
        <Dialog.Content title="Edit role">
          <UserSearchInline existingIds={[]} onAdd={vi.fn()} listboxId="members" />
        </Dialog.Content>
      </Dialog>
    </QueryClientProvider>,
  );
  return { input: screen.getByRole('combobox'), onOpenChange };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('UserSearchInline', () => {
  it('points the field at the highlighted suggestion', async () => {
    const { input } = renderInDialog();
    fireEvent.change(input, { target: { value: 'al' } });
    const options = await screen.findAllByRole('option');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    expect(new Set(options.map((option) => option.id)).size).toBe(USERS.length);
  });

  it('closes only the suggestions on Escape, then the dialog on a second Escape', async () => {
    const { input, onOpenChange } = renderInDialog();
    fireEvent.change(input, { target: { value: 'al' } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('announces when no user matches, and Escape closes that message first', async () => {
    const { input, onOpenChange } = renderInDialog();
    fireEvent.change(input, { target: { value: 'zz' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No users found'));
    expect(vi.mocked(searchUsersFn)).toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement());
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
