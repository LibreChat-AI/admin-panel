import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';

/**
 * A × button named by `label`: a native button, since click-ui `IconButton`
 * overwrites `aria-label` with its icon's name ("cross").
 */
export function CloseButton({ onClick, label, disabled }: t.CloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="icon-btn"
    >
      <span aria-hidden="true" className="flex">
        <Icon name="cross" size="sm" />
      </span>
    </button>
  );
}
