import { PrincipalType } from 'librechat-data-provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type * as t from '@/types';
import { expectFocusBack, openFrom, pressEscape, renderWithOpener } from '@/test/focus';
import { AuditLogDetailDrawer } from '../AuditLogDetailDrawer';
import { localizeEn } from '@/test/coverage';

type DrawerProps = ComponentProps<typeof AuditLogDetailDrawer>;

const ENTRY: t.AuditLogEntryWithDiff = {
  id: '0123456789abcdef01234567',
  schemaVersion: 1,
  category: 'grant',
  action: 'grant.assigned',
  outcome: 'success',
  severity: 'info',
  actor: { type: 'user', id: 'u-admin', name: 'Admin' },
  target: { type: PrincipalType.ROLE, id: 'EDITORS', name: 'EDITORS' },
  metadata: { capability: 'read:configs' },
  integrity: { seq: 1, hash: 'hash', prevHash: 'prev' },
  timestamp: '2026-10-01T12:00:00.000Z',
};

/** What the drawer shows while open: the entry, or the shell for a deep link still loading, missing or failed. */
const BRANCHES: ReadonlyArray<[string, (open: boolean) => Partial<DrawerProps>]> = [
  ['an entry', (open) => ({ entry: open ? ENTRY : null })],
  ['a loading deep link', (open) => ({ loading: open })],
  ['a missing entry', (open) => ({ notFound: open })],
  ['an entry that failed to load', (open) => ({ loadError: open })],
];

const CLOSERS: ReadonlyArray<[string, (drawer: HTMLElement) => void]> = [
  ['Escape', pressEscape],
  [
    'its close button',
    (drawer) =>
      fireEvent.click(
        within(drawer).getAllByRole('button', { name: localizeEn('com_audit_detail_close') })[0],
      ),
  ],
];

describe('AuditLogDetailDrawer focus', () => {
  describe.each(BRANCHES)('showing %s', (_, branch) => {
    it.each(CLOSERS)('gives focus back to the row that opened it on %s', async (__, close) => {
      const opener = renderWithOpener((open, onClose) => (
        <AuditLogDetailDrawer
          entry={null}
          {...branch(open)}
          open={open}
          onClose={onClose}
          onCopyPermalink={vi.fn()}
        />
      ));
      close(await openFrom(opener));
      await expectFocusBack(opener);
    });
  });
});

/** Each copy button's value and the field it names. */
const COPYABLE: ReadonlyArray<[string, string]> = [
  [ENTRY.timestamp, 'timestamp'],
  ['u-admin', 'actor ID'],
  ['EDITORS', 'target ID'],
  ['read:configs', 'capability'],
  [ENTRY.id, 'entry ID'],
];

function renderEntry(props: Partial<DrawerProps> = {}) {
  render(
    <AuditLogDetailDrawer
      entry={ENTRY}
      open
      onClose={vi.fn()}
      onCopyPermalink={vi.fn()}
      {...props}
    />,
  );
  return screen.getByRole('dialog');
}

describe('AuditLogDetailDrawer copy buttons', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(COPYABLE)(
    'names the %s button by its value, then what pressing it does',
    (value, field) => {
      const drawer = renderEntry();
      const button = within(drawer).getByRole('button', { name: `${value}, copy ${field}` });
      expect(button).toHaveTextContent(value);
      expect(button).not.toHaveAttribute('aria-live');
    },
  );

  it('reports each copy with the field it copied', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const onCopied = vi.fn();
    const drawer = renderEntry({ onCopied });
    fireEvent.click(within(drawer).getByRole('button', { name: 'u-admin, copy actor ID' }));
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith('actor ID'));
    expect(writeText).toHaveBeenCalledWith('u-admin');
  });

  it('reports a failed copy instead', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    const onCopied = vi.fn();
    const onCopyFailed = vi.fn();
    const drawer = renderEntry({ onCopied, onCopyFailed });
    fireEvent.click(within(drawer).getByRole('button', { name: 'EDITORS, copy target ID' }));
    await waitFor(() => expect(onCopyFailed).toHaveBeenCalled());
    expect(onCopied).not.toHaveBeenCalled();
  });

  it("keeps the target badge's icon out of the drawer's text", () => {
    const drawer = renderEntry();
    expect(within(drawer).queryAllByRole('img')).toEqual([]);
  });
});

describe('AuditLogDetailDrawer for an action the tab does not name', () => {
  /** A newer LibreChat's entry: an action, category and target type the panel doesn't mirror, and no capability. */
  const NEWER: t.AuditLogEntryWithDiff = {
    ...ENTRY,
    category: 'workflow',
    action: 'workflow.started',
    target: { type: 'workflow', id: 'w-1', name: 'Nightly' },
    metadata: {},
  };

  it('names the action and the target type by their own names', () => {
    const drawer = renderEntry({ entry: NEWER });
    expect(within(drawer).getAllByText('workflow.started').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('workflow')).toBeInTheDocument();
    expect(within(drawer).queryByText('Base configuration')).not.toBeInTheDocument();
  });

  it('leaves out the capability row when the entry concerns no capability', () => {
    const drawer = renderEntry({ entry: NEWER });
    expect(within(drawer).queryByText('Capability')).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /copy capability$/ })).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'w-1, copy target ID' })).toBeInTheDocument();
  });

  it('keeps the capability row of a grant', () => {
    const drawer = renderEntry();
    expect(within(drawer).getByText('Capability')).toBeInTheDocument();
  });
});
