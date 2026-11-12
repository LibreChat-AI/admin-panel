import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavigationGuardDialog } from '../NavigationGuardDialog';
import { ResetBaseConfigDialog } from '../ResetBaseConfigDialog';
import { ConfirmChoiceDialog } from '../fields/ConfirmChoice';
import '@/locales/i18n';

/**
 * Exactly `text`. Radix adds click-ui's empty hidden description after the
 * one a dialog names, which leaves a space at the end of the computed text.
 */
function only(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
}

/**
 * A confirmation dialog is described by its body text, so a screen reader
 * reads what the choice does as the dialog opens, not only its title.
 */
describe('configuration confirmation dialogs', () => {
  it('describes the unsaved-changes prompt by its body text', () => {
    render(
      <NavigationGuardDialog
        open
        intent={{ kind: 'leave' }}
        changeCount={2}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      only('You have 2 unsaved changes. Save them first, or discard them to continue.'),
    );
  });

  it('describes Revert all admin overrides by its body text', () => {
    render(<ResetBaseConfigDialog open resetting={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      /^Removes every base override saved in the admin panel\. .*This can't be undone\.\s*$/,
    );
  });

  it('describes a choice with consequences by its body', () => {
    render(
      <ConfirmChoiceDialog
        open
        title="Switch file storage?"
        actions={[{ label: 'Switch', onSelect: vi.fn() }]}
        onCancel={vi.fn()}
      >
        <p>Files already uploaded stay where they are.</p>
        <p>New uploads go to Amazon S3.</p>
      </ConfirmChoiceDialog>,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      only('Files already uploaded stay where they are. New uploads go to Amazon S3.'),
    );
  });
});
