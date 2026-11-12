import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';

/**
 * A click-ui `Icon` hidden from assistive technology. click-ui renders every
 * icon as `<svg role="img" aria-label={name}>`, which leaks names such as
 * "chevron-right" or "cross" into the accessible name of the surrounding
 * button or link; use this inside anything interactive.
 */
export function DecorativeIcon({ name, size, color, className }: t.DecorativeIconProps) {
  return (
    <Icon
      name={name}
      size={size}
      color={color}
      className={className}
      role={undefined}
      aria-label={undefined}
      aria-hidden="true"
      focusable="false"
    />
  );
}
