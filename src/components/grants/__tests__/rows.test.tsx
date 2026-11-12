import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { PrincipalType } from 'librechat-data-provider';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { AuditLogTableRow } from '../AuditLogTableRow';
import { GrantTableRow } from '../GrantTableRow';

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}(${Object.values(options).join(',')})` : key,
}));

const PRINCIPAL: t.PrincipalRow = {
  principalType: PrincipalType.ROLE,
  principalId: 'r1',
  name: 'EDITORS',
  grantCount: 2,
  isActive: true,
};

const ENTRY: t.AuditLogEntryWithDiff = {
  id: '0123456789abcdef01234567',
  schemaVersion: 1,
  category: 'grant',
  action: 'grant.assigned',
  outcome: 'success',
  severity: 'info',
  actor: { type: 'user', id: 'u-admin', name: 'Admin' },
  target: { type: PrincipalType.ROLE, id: 'r1', name: 'EDITORS' },
  metadata: { capability: 'read:configs' },
  integrity: { seq: 1, hash: 'hash', prevHash: 'prev' },
  timestamp: '2026-10-01T12:00:00.000Z',
};

function renderRow(row: ReactNode) {
  render(
    <table>
      <tbody>{row}</tbody>
    </table>,
  );
}

const ROWS: ReadonlyArray<[string, (onOpen: () => void) => ReactNode, string]> = [
  [
    'a grants row',
    (onOpen) => <GrantTableRow row={PRINCIPAL} isLast onOpen={onOpen} buttonRef={() => {}} />,
    'com_cap_edit_title(EDITORS)',
  ],
  [
    'an audit log row',
    (onOpen) => <AuditLogTableRow entry={ENTRY} isLast onOpen={onOpen} />,
    'com_a11y_audit_row_open(EDITORS)',
  ],
];

describe.each(ROWS)('%s', (_, row, name) => {
  it('stays a table row and opens from a button in its cell named after what it shows', () => {
    renderRow(row(vi.fn()));

    const button = within(screen.getByRole('row')).getByRole('button', { name });
    expect(button.closest('td')).not.toBeNull();
    expect(button).toHaveTextContent(/^EDITORS$/);
    expect(button).toHaveAccessibleName(expect.stringContaining('EDITORS'));
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it.each([
    [
      'a click',
      (user: ReturnType<typeof userEvent.setup>, button: HTMLElement) => user.click(button),
    ],
    ['Enter', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Enter}')],
    ['Space', (user: ReturnType<typeof userEvent.setup>) => user.keyboard(' ')],
  ])('opens on %s', async (__, press) => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderRow(row(onOpen));
    const button = screen.getByRole('button', { name });
    button.focus();

    await press(user, button);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

it('hands the grants row button to the tab, which gives it focus back when the dialog closes', () => {
  const buttonRef = vi.fn<(el: HTMLButtonElement | null) => void>();
  renderRow(<GrantTableRow row={PRINCIPAL} isLast onOpen={vi.fn()} buttonRef={buttonRef} />);

  expect(buttonRef).toHaveBeenCalledWith(
    screen.getByRole('button', { name: 'com_cap_edit_title(EDITORS)' }),
  );
});
