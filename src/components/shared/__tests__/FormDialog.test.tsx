import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FormDialog } from '../FormDialog';

vi.mock('@/hooks/useLocalize', () => ({
  useLocalize: () => (key: string) => key,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate: vi.fn() }),
}));

describe('FormDialog', () => {
  const renderDialog = (props: Partial<React.ComponentProps<typeof FormDialog>> = {}) =>
    render(
      <FormDialog
        open
        title="Create MCP server"
        submitLabel="Create"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        {...props}
      >
        <label htmlFor="name">Name</label>
        <input id="name" />
      </FormDialog>,
    );

  it('scrolls only the fields: the footer with the actions sits outside the scroll body', () => {
    renderDialog({ error: 'Name is required' });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('form-dialog-content');
    const body = dialog.querySelector('.form-dialog-body') as HTMLElement;
    const footer = dialog.querySelector('.form-dialog-footer') as HTMLElement;
    expect(body.contains(screen.getByLabelText('Name'))).toBe(true);
    expect(body.contains(screen.getByRole('button', { name: 'Create' }))).toBe(false);
    expect(footer.contains(screen.getByRole('button', { name: 'Create' }))).toBe(true);
    expect(footer.contains(screen.getByRole('alert'))).toBe(true);
  });

  it('submits on Enter in a field and cancels through the footer', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onSubmit, onClose });
    fireEvent.submit(screen.getByLabelText('Name'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('asks before discarding typed input, and discards on the second request', () => {
    const onClose = vi.fn();
    renderDialog({ onClose, discardPrompt: 'Discard this new server?' });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Discard this new server?');
    expect(screen.getByRole('button', { name: 'com_ui_keep_editing' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_keep_editing' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Enter in a text field from submitting when asked to', () => {
    renderDialog({ submitOnEnter: false });
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    screen.getByLabelText('Name').dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  });

  it('keeps input mounted during recovery and still permits an explicit discard', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    renderDialog({
      onSubmit,
      onClose,
      discardPrompt: 'Discard this new server?',
      recovery: {
        blocked: true,
        sessionError: 'OPENID_SESSION_ENDED',
        recoveryError: null,
        retrySession: vi.fn(async () => undefined),
      },
    });
    const input = screen.getByLabelText('Name');
    expect(input).toBeInTheDocument();
    expect(input).not.toBeVisible();
    fireEvent.submit(input);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'cross' }));
    expect(screen.getByText('Discard this new server?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
