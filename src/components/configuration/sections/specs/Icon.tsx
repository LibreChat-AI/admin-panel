import { useState } from 'react';
import type * as t from '@/types';
import { cn } from '@/utils';

const IMAGE_URL = /^(https?:\/\/|data:image\/)/i;

/** An absolute image URL the panel can load (a relative path resolves against LibreChat, not here). */
function isImageUrl(value: t.ConfigValue): value is string {
  return typeof value === 'string' && IMAGE_URL.test(value.trim());
}

/**
 * A spec's icon as the model menu shows it: the image at `iconURL`, else the
 * first letter of its label (an endpoint name, a relative path or a broken
 * image falls back to the letter too). Decorative: the label names the spec.
 */
export function SpecIcon({ iconURL, label, size = 'sm' }: t.SpecIconProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = isImageUrl(iconURL) ? iconURL.trim() : null;
  const box = size === 'sm' ? 'size-5 text-[0.6875rem]' : 'size-8 text-sm';
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className={cn(box, 'shrink-0 rounded-md object-cover')}
      />
    );
  }
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        'inline-flex shrink-0 items-center justify-center rounded-md bg-(--settings-neutral-bg) font-semibold text-(--settings-neutral-fg)',
      )}
    >
      {initial}
    </span>
  );
}
