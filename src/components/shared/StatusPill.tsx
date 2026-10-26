import type * as t from '@/types';
import { cn } from '@/utils';

const TONE_CLASSES: Record<t.StatusTone, string> = {
  success: 'bg-green-soft text-green-ink',
  danger: 'bg-red-soft text-red-ink',
};

export function StatusPill({ tone, label }: t.StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.25 py-0.75 text-xs leading-4 font-semibold whitespace-nowrap',
        TONE_CLASSES[tone],
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
