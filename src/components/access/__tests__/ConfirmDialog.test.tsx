import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type * as t from '@/types';
import {
  DIALOG_CLOSERS,
  expectFocusBack,
  findFocusedDialog,
  pressEscape,
  renderWithOpener,
} from '@/test/focus';
import { ConfirmDialog } from '../ConfirmDialog';
import '@/locales/i18n';

const MESSAGE = 'Are you sure you want to delete "Support"?';

const PROPS: t.ConfirmDialogProps = {
  open: true,
  title: 'Delete role',
  description: MESSAGE,
  confirmLabel: 'Delete',
  saving: false,
  onConfirm: () => {},
  onCancel: () => {},
};

/** How the delete that Confirm starts goes. */
type DeleteOutcome = 'success' | 'failure' | 'saving';

/**
 * A row whose Delete opens the dialog, as on the Roles tab. Confirm runs the
 * delete: it succeeds and closes the dialog, fails and leaves it open, or is
 * still saving. The row goes once `removed` (the list's refetch, which lands
 * after the dialog has closed).
 */
function DeletableRow({ removed, outcome }: { removed: boolean; outcome: DeleteOutcome }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState<HTMLInputElement | null>(null);
  const confirm = () => {
    if (outcome === 'success') setOpen(false);
    if (outcome === 'saving') setSaving(true);
  };
  return (
    <>
      <input ref={setSearch} aria-label="Search roles" />
      {!removed && (
        <button type="button" onClick={() => setOpen(true)}>
          Delete Support
        </button>
      )}
      <ConfirmDialog
        {...PROPS}
        open={open}
        saving={saving}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
        returnFocusTo={() => search}
      />
    </>
  );
}

/** Opens the dialog from the row's Delete and presses its Delete. */
async function confirmDelete(): Promise<HTMLElement> {
  const opener = screen.getByRole('button', { name: 'Delete Support' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await findFocusedDialog();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  return opener;
}

const searchBox = () => screen.getByRole('textbox', { name: 'Search roles' });

describe('ConfirmDialog', () => {
  it('is described by its message and opens on Cancel', async () => {
    render(<ConfirmDialog {...PROPS} />);
    const dialog = await findFocusedDialog();
    expect(dialog).toHaveAccessibleName('Delete role');
    expect(dialog).toHaveAccessibleDescription(MESSAGE);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('stays open while the action saves, busy but still focusable, until the caller closes it', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog {...PROPS} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const dialog = await findFocusedDialog();
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    confirm.focus();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    rerender(<ConfirmDialog {...PROPS} saving onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows an error as an alert below its message', async () => {
    render(<ConfirmDialog {...PROPS} error="Role is in use" />);
    const dialog = await findFocusedDialog();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Role is in use');
    expect(dialog).toHaveAccessibleDescription(MESSAGE);
  });

  it.each([
    ...DIALOG_CLOSERS,
    [
      'Cancel',
      (dialog: HTMLElement) =>
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })),
    ] as const,
  ])('gives focus back to the Delete button that opened it on %s', async (_, close) => {
    const opener = renderWithOpener((open, onClose) => (
      <ConfirmDialog {...PROPS} open={open} onCancel={onClose} />
    ));
    opener.focus();
    fireEvent.click(opener);
    close(await findFocusedDialog());
    await expectFocusBack(opener);
  });

  it('gives focus to the fallback after a confirmed delete, before the refetch removes its opener', async () => {
    const { rerender } = render(<DeletableRow removed={false} outcome="success" />);
    await confirmDelete();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.body).not.toHaveFocus());

    rerender(<DeletableRow removed outcome="success" />);
    expect(screen.queryByRole('button', { name: 'Delete Support' })).toBeNull();
    expect(searchBox()).toHaveFocus();
  });

  it('gives focus to the fallback when the confirmed delete removed its opener first', async () => {
    const { rerender } = render(<DeletableRow removed={false} outcome="success" />);
    await confirmDelete();
    rerender(<DeletableRow removed outcome="success" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(searchBox()).toHaveFocus());
  });

  it('gives focus to the fallback when Escape closes it while the delete still saves', async () => {
    render(<DeletableRow removed={false} outcome="saving" />);
    await confirmDelete();
    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );
    pressEscape(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(searchBox()).toHaveFocus());
  });

  it('gives focus back to its opener on Cancel after a confirmed delete failed', async () => {
    render(<DeletableRow removed={false} outcome="failure" />);
    const opener = await confirmDelete();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await expectFocusBack(opener);
  });
});
