import { Switch } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { DecorativeIcon } from './DecorativeIcon';
import { cn } from '@/utils';

/**
 * The header of a collapsible group of switches. The disclosure button
 * (chevron, label, description) and the group's "Select all" switch sit side
 * by side: a switch inside the button would be an interactive control nested
 * in another, which assistive technology cannot reach on its own.
 */
export function SelectAllHeader({
  open,
  onToggle,
  controls,
  label,
  description,
  summary,
  switchId,
  switchLabel,
  checked,
  onCheckedChange,
  disabled,
}: t.SelectAllHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 pe-4 transition-colors hover:bg-(--cui-color-background-hover)',
        open ? 'rounded-t-lg' : 'rounded-lg',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? controls : undefined}
        onClick={onToggle}
        className={cn(
          'select-all-toggle flex flex-1 cursor-pointer items-center gap-2 self-stretch border-none bg-transparent py-3 ps-4 text-start',
          open ? 'rounded-ss-lg' : 'rounded-s-lg',
        )}
      >
        <DecorativeIcon
          name="chevron-right"
          size="sm"
          className={cn('text-(--cui-color-text-muted) transition-transform', open && 'rotate-90')}
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium text-(--cui-color-text-default)">{label}</span>
          {description && (
            <span className="text-xs text-(--cui-color-text-muted)">{description}</span>
          )}
        </span>
      </button>
      <span className="text-xs text-(--cui-color-text-muted)">{summary}</span>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={switchLabel}
      />
    </div>
  );
}
