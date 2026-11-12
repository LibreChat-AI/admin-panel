import type { ReactNode } from 'react';
import type * as t from '@/types';
import { DecorativeIcon } from '@/components/shared';
import { cn } from '@/utils';

const ICONS: Readonly<Record<t.McpNoteTone, 'lock' | 'info-in-circle' | 'warning'>> = {
  lock: 'lock',
  info: 'info-in-circle',
  warning: 'warning',
};

/** The custom endpoint editor's banner colours, so both editors read alike. */
const TONE_CLASSES: Readonly<Record<t.McpNoteTone, string>> = {
  lock: 'border-(--cui-color-stroke-default) bg-(--settings-neutral-bg) text-(--cui-color-text-default)',
  info: 'border-(--settings-info-border) bg-(--settings-info-bg) text-(--settings-info-fg)',
  warning:
    'border-(--settings-warn-mark) bg-(--settings-warn-bg) text-(--settings-warn-fg) border-dashed',
};

/**
 * A note inside a server card or the create dialog: why something is
 * read-only (lock), what a choice or a profile override means (info), or
 * what a change will remove (warning), with optional actions on the right.
 */
export function McpNote({
  tone,
  children,
  actions,
  id,
}: {
  tone: t.McpNoteTone;
  children: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <div
      id={id}
      role={tone === 'warning' ? 'alert' : 'note'}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm',
        TONE_CLASSES[tone],
      )}
    >
      <span className="flex shrink-0 self-start pt-0.5 opacity-80">
        <DecorativeIcon name={ICONS[tone]} size="sm" />
      </span>
      <span className="min-w-0 flex-[1_1_14rem]">{children}</span>
      {actions && <span className="flex shrink-0 items-center gap-2">{actions}</span>}
    </div>
  );
}
