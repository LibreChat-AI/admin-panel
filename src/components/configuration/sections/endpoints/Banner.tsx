import type { ReactNode } from 'react';
import type * as t from '@/types';
import { DecorativeIcon } from '@/components/shared';
import { cn } from '@/utils';

const TONE_CLASSES: Record<t.EndpointBannerTone, string> = {
  info: 'border-(--settings-info-border) bg-(--settings-info-bg) text-(--settings-info-fg)',
  warning:
    'border-(--settings-warn-mark) bg-(--settings-warn-bg) text-(--settings-warn-fg) border-dashed',
  danger: 'border-(--settings-danger-mark) bg-(--settings-danger-bg) text-(--settings-danger-fg)',
  neutral:
    'border-(--cui-color-stroke-default) bg-(--settings-neutral-bg) text-(--cui-color-text-default)',
};

const TONE_ICONS: Record<t.EndpointBannerTone, t.DecorativeIconProps['name']> = {
  info: 'info-in-circle',
  warning: 'warning',
  danger: 'warning',
  neutral: 'lock',
};

/** A short notice in the endpoint editor: where an endpoint comes from, a warning, an action. */
export function Banner({
  tone,
  children,
  action,
  role,
}: {
  tone: t.EndpointBannerTone;
  children: ReactNode;
  action?: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div
      role={role}
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm',
        TONE_CLASSES[tone],
      )}
    >
      <span className="mt-0.5 flex shrink-0">
        <DecorativeIcon name={TONE_ICONS[tone]} size="sm" />
      </span>
      <div className="min-w-0 flex-1 basis-56 leading-5">{children}</div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
