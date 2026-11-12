import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormDialog } from '../FormDialog';
import { KebabMenu } from '../KebabMenu';

vi.mock('@/hooks/useLocalize', () => ({
  useLocalize: () => (key: string) => key,
}));

function Harness({ onDelete = vi.fn() }: { onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <KebabMenu
        ariaLabel="Actions for Shadow"
        items={[
          { label: 'Edit', onClick: () => setOpen(true) },
          {
            label: 'Delete',
            disabled: true,
            title: 'Defined in librechat.yaml',
            onClick: onDelete,
          },
        ]}
      />
      <FormDialog
        open={open}
        title="Edit Shadow"
        submitLabel="Save"
        onSubmit={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <label htmlFor="name">Name</label>
        <input id="name" />
      </FormDialog>
    </>
  );
}

function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Actions for Shadow' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return trigger;
}

describe('KebabMenu', () => {
  it('leaves focus in the dialog an action opens, and gets it back when the dialog closes', async () => {
    render(<Harness />);
    const trigger = openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    });
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps an unavailable item reachable, with its reason as its description', () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);
    openMenu();
    const item = screen.getByRole('menuitem', { name: 'Delete' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription('Defined in librechat.yaml');
    fireEvent.click(item);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
