import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { cn } from '@/utils';

/**
 * A click-ui Button that keeps focus while its action runs. click-ui's
 * `loading` disables the button, and a focused button that turns disabled
 * drops keyboard focus on `<body>`. Busy, this one shows a spinner, is
 * `aria-busy` and `aria-disabled`, and ignores presses instead.
 */
export function BusyButton({
  busy,
  disabled,
  iconLeft,
  onClick,
  className,
  ...props
}: t.BusyButtonProps) {
  return (
    <Button
      {...props}
      disabled={disabled}
      iconLeft={busy ? 'loading-animated' : iconLeft}
      aria-busy={busy || undefined}
      aria-disabled={busy || disabled || undefined}
      onClick={(event) => {
        if (!busy) onClick?.(event);
      }}
      className={cn(busy && 'cursor-progress', className)}
    />
  );
}
