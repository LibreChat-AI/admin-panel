import { IconButton } from '@clickhouse/click-ui';
import type { MouseEvent } from 'react';
import type * as t from '@/types';

export function TrashButton({ onClick, ariaLabel, size = 'sm', disabled }: t.TrashButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onClick();
  };

  return (
    <IconButton
      icon="trash"
      type="danger"
      size={size}
      onClick={handleClick}
      aria-label={ariaLabel}
      disabled={disabled}
    />
  );
}
