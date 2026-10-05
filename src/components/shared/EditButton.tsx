import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { cn } from '@/utils';

/** Native button for the same reasons as `TrashButton`. */
export function EditButton({ onClick, ariaLabel, size = 'sm', disabled }: t.EditButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      className={cn('icon-btn', size === 'xs' && 'icon-btn-xs')}
    >
      <span aria-hidden="true" className="flex">
        <Icon name="pencil" size={size} />
      </span>
    </button>
  );
}
