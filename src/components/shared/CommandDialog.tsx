import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import type * as t from '@/types';

/**
 * cmdk's `Command.Dialog`, with the dialog content's `onCloseAutoFocus` that
 * cmdk does not pass on. These dialogs open without a Radix trigger, so
 * closing one drops focus on `<body>` unless that handler (`useReturnFocus`)
 * gives it back to whatever opened the dialog.
 */
export function CommandDialog({
  open,
  onOpenChange,
  overlayClassName,
  contentClassName,
  container,
  onCloseAutoFocus,
  ...props
}: t.CommandDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay cmdk-overlay="" className={overlayClassName} />
        <Dialog.Content
          aria-label={props.label}
          cmdk-dialog=""
          className={contentClassName}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Command {...props} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
