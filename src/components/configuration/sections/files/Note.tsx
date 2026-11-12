import type { ReactNode } from 'react';
import { DecorativeIcon } from '@/components/shared';
import { cn } from '@/utils';

/** A warning or error next to settings whose combination has a consequence (FX-6, FX-11). */
export function WarningNote({
  id,
  tone = 'warning',
  children,
}: {
  id?: string;
  tone?: 'warning' | 'danger';
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      role={tone === 'danger' ? 'alert' : 'note'}
      className={cn(
        'm-0 flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-5',
        tone === 'danger'
          ? 'bg-(--settings-danger-bg) text-(--settings-danger-fg)'
          : 'bg-(--settings-warn-bg) text-(--settings-warn-fg)',
      )}
    >
      <span className="mt-0.5 flex shrink-0">
        <DecorativeIcon name="warning" size="sm" />
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
