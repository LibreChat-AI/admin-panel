import { useRef } from 'react';
import { Badge, Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { Avatar, LoadingState, Pagination, TrashButton } from '@/components/shared';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

/**
 * The members of a role or group in its Edit dialog. A member staged for
 * removal stays at full contrast, struck through and tagged "Will be removed",
 * and its Remove button turns into Undo in place. Focus follows that swap,
 * so it never falls out of the dialog.
 */
export function MemberList({
  members,
  loading,
  error,
  fetching,
  removalIds,
  onRemove,
  onUndoRemove,
  canManage,
  total,
  currentPage,
  totalPages,
  onPageChange,
}: t.MemberListProps) {
  const localize = useLocalize();
  const focusUserId = useRef<string | null>(null);

  const focusIfSwapped = (userId: string) => (button: HTMLButtonElement | null) => {
    if (!button || focusUserId.current !== userId) return;
    focusUserId.current = null;
    button.focus();
  };

  if (loading) {
    return (
      <LoadingState className="flex items-center justify-center gap-2 py-6 text-sm text-(--cui-color-text-muted)" />
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center justify-center py-6 text-sm text-(--cui-color-text-danger)"
      >
        {localize('com_error_load_members')}
      </div>
    );
  }

  if (members.length === 0 && total === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-(--cui-color-text-muted)">
        {localize('com_access_no_members')}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <span className="mb-2 text-xs font-medium text-(--cui-color-text-muted)">
        {localize('com_access_member_count', { count: total })}
      </span>
      <div
        className={cn(
          'max-h-64 overflow-auto rounded-lg border border-(--cui-color-stroke-default)',
          fetching && 'opacity-60 transition-opacity',
        )}
      >
        {members.map((member, i) => {
          const staged = removalIds.has(member.userId);
          return (
            <div
              key={member.userId}
              className={cn(
                'flex items-center justify-between gap-3 px-3 py-2',
                i < members.length - 1 && 'border-b border-(--cui-color-stroke-default)',
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={member.name} />
                <div className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'text-sm font-medium text-(--cui-color-text-default)',
                        staged && 'line-through',
                      )}
                    >
                      {member.name}
                    </span>
                    {staged && (
                      <Badge
                        size="sm"
                        state="danger"
                        text={localize('com_access_will_be_removed')}
                      />
                    )}
                  </span>
                  <span className="text-xs break-all text-(--cui-color-text-muted)">
                    {member.email}
                  </span>
                </div>
              </div>
              {canManage && staged && (
                <Button
                  ref={focusIfSwapped(member.userId)}
                  htmlType="button"
                  type="secondary"
                  label={localize('com_ui_undo')}
                  aria-label={localize('com_access_undo_remove_member', { name: member.name })}
                  onClick={() => {
                    focusUserId.current = member.userId;
                    onUndoRemove(member.userId);
                  }}
                />
              )}
              {canManage && !staged && (
                <TrashButton
                  buttonRef={focusIfSwapped(member.userId)}
                  onClick={() => {
                    focusUserId.current = member.userId;
                    onRemove(member);
                  }}
                  ariaLabel={`${localize('com_access_remove_member')} ${member.name}`}
                />
              )}
            </div>
          );
        })}
      </div>
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}
