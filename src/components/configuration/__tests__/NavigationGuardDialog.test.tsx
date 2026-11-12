import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NavigationGuardDialog } from '../NavigationGuardDialog';
import { pressEscape, findFocusedDialog } from '@/test/focus';

vi.mock('@/hooks', async () => {
  const { useReturnFocus } =
    await vi.importActual<typeof import('@/hooks/dialogs')>('@/hooks/dialogs');
  return { useLocalize: () => (key: string) => key, useReturnFocus };
});

/**
 * The configuration page with unsaved edits: picking a profile closes the
 * picker it was in, so the guard opens with nothing left to give focus back to.
 */
function PageWithEdits() {
  const [picked, setPicked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const pick = () => {
    setPicked(true);
    setBlocked(true);
  };
  return (
    <>
      <div role="tablist">
        <button type="button" role="tab" data-state="active">
          General
        </button>
      </div>
      {!picked && (
        <button type="button" onClick={pick}>
          USER
        </button>
      )}
      <NavigationGuardDialog
        open={blocked}
        intent={{ kind: 'scope', name: 'USER' }}
        changeCount={1}
        onSave={vi.fn()}
        onDiscard={() => setBlocked(false)}
        onCancel={() => setBlocked(false)}
      />
    </>
  );
}

function clickButton(name: string): (dialog: HTMLElement) => void {
  return (dialog) => fireEvent.click(within(dialog).getByRole('button', { name }));
}

const CLOSERS: ReadonlyArray<[string, (dialog: HTMLElement) => void]> = [
  ['Escape', pressEscape],
  ['Cancel', clickButton('com_ui_cancel')],
  ['Discard', clickButton('com_config_shell_guard_discard')],
];

describe('NavigationGuardDialog focus', () => {
  it.each(CLOSERS)(
    'puts focus on the open tab on %s once the control that asked is gone',
    async (_, close) => {
      render(<PageWithEdits />);
      const pickButton = screen.getByRole('button', { name: 'USER' });
      pickButton.focus();
      fireEvent.click(pickButton);
      close(await findFocusedDialog());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus());
    },
  );
});
