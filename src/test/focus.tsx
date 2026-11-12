import { useState } from 'react';
import { expect } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

type DialogSlot = (open: boolean, close: () => void) => ReactNode;

const OPENER = 'open-dialog';

function Opener({ dialog }: { dialog: DialogSlot }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {OPENER}
      </button>
      {dialog(open, () => setOpen(false))}
    </>
  );
}

/**
 * Renders a controlled dialog beside the page button that opens it, the way
 * the app does (no Radix trigger), and returns that button. The dialog gets a
 * query client; `wrap` adds any other providers it needs.
 */
export function renderWithOpener(
  dialog: DialogSlot,
  wrap: (node: ReactNode) => ReactNode = (node) => node,
): HTMLElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {wrap(<Opener dialog={dialog} />)}
    </QueryClientProvider>,
  );
  return screen.getByRole('button', { name: OPENER });
}

/** Waits for the open dialog and for focus to have moved into it. */
export async function findFocusedDialog(): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  return dialog;
}

/** Opens a dialog from its focused opener and waits until focus has moved into it. */
export async function openFrom(opener: HTMLElement): Promise<HTMLElement> {
  opener.focus();
  fireEvent.click(opener);
  return findFocusedDialog();
}

export function pressEscape(dialog: HTMLElement): void {
  fireEvent.keyDown(dialog, { key: 'Escape' });
}

/** click-ui's close button, named only by its icon in tests (the app labels it "Close"). */
export function clickClose(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByRole('button', { name: 'cross' }));
}

/** Waits for every dialog to close, then for focus to be back on `opener` rather than `<body>`. */
export async function expectFocusBack(opener: HTMLElement): Promise<void> {
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(opener).toHaveFocus());
}

/** The ways an admin closes a click-ui dialog, for `it.each`. */
export const DIALOG_CLOSERS: ReadonlyArray<[string, (dialog: HTMLElement) => void]> = [
  ['Escape', pressEscape],
  ['its close button', clickClose],
];
