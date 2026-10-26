import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';
import { Avatar } from './Avatar';
import { cn } from '@/utils';

export function SelectedMemberList({ users, onRemove, disabled }: t.SelectedMemberListProps) {
  const localize = useLocalize();

  if (users.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted">{localize('com_access_no_members')}</p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="max-h-48 overflow-auto rounded-inner border border-line">
        {users.map((user, i) => (
          <div
            key={user.id}
            className={cn(
              'flex items-center justify-between gap-3 px-3.5 py-2',
              i < users.length - 1 && 'border-b border-line2',
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={user.name} size="sm" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-ink">{user.name}</span>
                <span className="truncate text-xs text-muted">{user.email}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRemove(user.id)}
              disabled={disabled}
              aria-label={localize('com_ui_remove_item', { name: user.name })}
              className="aimo-icon-btn aimo-icon-btn-danger"
            >
              <Icon name="cross" size="sm" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
