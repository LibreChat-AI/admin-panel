import type * as t from '@/types';
import { DecorativeIcon } from '@/components/shared';
import { cn } from '@/utils';

const TONE_CLASSES: Record<t.SpecNoteProps['tone'], string> = {
  info: 'settings-banner',
  warning:
    'flex items-start gap-2.5 rounded-lg border border-solid border-(--settings-warn-mark) bg-(--settings-warn-bg) px-3 py-2.5 text-[0.8125rem] leading-5 text-(--settings-warn-fg)',
  preview:
    'flex items-start gap-2.5 rounded-lg border border-solid border-(--cui-color-stroke-default) bg-(--cui-color-background-muted) px-3 py-2.5 text-[0.8125rem] leading-5 text-(--cui-color-text-default)',
};

const TONE_ICONS: Record<t.SpecNoteProps['tone'], 'info-in-circle' | 'warning'> = {
  info: 'info-in-circle',
  warning: 'warning',
  preview: 'info-in-circle',
};

/**
 * A note between the specs section's rows: what a list or setting means, a
 * warning about a combination LibreChat handles badly, or what users will see,
 * with optional actions.
 */
export function SpecNote({ tone, icon, action, children }: t.SpecNoteProps) {
  return (
    <div className={cn(TONE_CLASSES[tone], 'my-1')} role={tone === 'warning' ? 'note' : undefined}>
      <span className="settings-banner-icon">
        {icon ?? <DecorativeIcon name={TONE_ICONS[tone]} size="sm" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <p className="m-0 min-w-0 flex-[1_1_15rem]">{children}</p>
        {action && <span className="flex shrink-0 flex-wrap gap-2">{action}</span>}
      </div>
    </div>
  );
}
