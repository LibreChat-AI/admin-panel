import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AdminMember } from '@librechat/data-schemas';
import type * as t from '@/types';
import { MemberList } from '../MemberList';
import '@/locales/i18n';

const MEMBERS: AdminMember[] = [
  { userId: 'u1', name: 'Alice Chen', email: 'alice@example.com' },
  { userId: 'u2', name: 'Bob Martinez', email: 'bob@example.com' },
];

const BASE: t.MemberListProps = {
  members: MEMBERS,
  loading: false,
  error: false,
  fetching: false,
  removalIds: new Set(),
  onRemove: () => {},
  onUndoRemove: () => {},
  canManage: true,
  total: MEMBERS.length,
  currentPage: 1,
  totalPages: 1,
  onPageChange: () => {},
};

/** The list as an Edit dialog drives it: removals are staged in the dialog's state. */
function StagedMemberList() {
  const [removalIds, setRemovalIds] = useState<ReadonlySet<string>>(new Set());
  return (
    <MemberList
      {...BASE}
      removalIds={removalIds}
      onRemove={(member) => setRemovalIds((prev) => new Set(prev).add(member.userId))}
      onUndoRemove={(userId) =>
        setRemovalIds((prev) => new Set([...prev].filter((id) => id !== userId)))
      }
    />
  );
}

describe('MemberList', () => {
  it('counts members in the singular and the plural', () => {
    const { rerender } = render(<MemberList {...BASE} />);
    expect(screen.getByText('2 members')).toBeInTheDocument();
    rerender(<MemberList {...BASE} members={MEMBERS.slice(0, 1)} total={1} />);
    expect(screen.getByText('1 member')).toBeInTheDocument();
  });

  it('marks a staged member "Will be removed" at full contrast and swaps Remove for a focused Undo', () => {
    render(<StagedMemberList />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice Chen' }));

    const undo = screen.getByRole('button', { name: 'Undo removing Alice Chen' });
    expect(undo).toHaveTextContent('Undo');
    expect(undo).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Remove Alice Chen' })).toBeNull();
    expect(screen.getByText('Will be removed')).toBeVisible();
    expect(screen.getByText('Alice Chen')).toHaveClass('line-through');
    expect(screen.getByText('Alice Chen').closest('.opacity-40')).toBeNull();

    fireEvent.click(undo);
    expect(screen.getByRole('button', { name: 'Remove Alice Chen' })).toHaveFocus();
    expect(screen.queryByText('Will be removed')).toBeNull();
  });

  it('leaves the other rows alone', () => {
    render(<StagedMemberList />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice Chen' }));
    expect(screen.getByRole('button', { name: 'Remove Bob Martinez' })).toBeEnabled();
    expect(screen.getByText('Bob Martinez')).not.toHaveClass('line-through');
  });

  it('reports a failed load as an alert', () => {
    render(<MemberList {...BASE} error />);
    expect(screen.getByRole('alert')).toHaveTextContent(/members/i);
  });

  it('offers no Remove or Undo without the manage capability', () => {
    render(<MemberList {...BASE} canManage={false} removalIds={new Set(['u1'])} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Will be removed')).toBeVisible();
  });
});
