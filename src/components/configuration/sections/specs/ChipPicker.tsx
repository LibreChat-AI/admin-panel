import { useState } from 'react';
import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { INPUT_CLASSES, widthClass } from '../../fields/display';
import { DecorativeIcon } from '@/components/shared';
import { FieldNotice } from '../../fields/Notice';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

const PLACEHOLDER = '\u0000add';

/**
 * A set of values picked from known choices: each as a chip with Remove, and
 * a select of the choices not picked yet. Nothing can be typed, so a blank
 * or unknown value can't be added; one already stored stays visible (marked
 * as not configured) until it is removed. With `matchValue`, a value spelled
 * another way than its choice (`Ollama` for `ollama`) is that choice.
 */
export function ChipPicker({
  id,
  values,
  groups,
  onChange,
  onClear,
  disabled,
  addLabel,
  unknownLabel,
  matchValue,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: t.ChipPickerProps) {
  const localize = useLocalize();
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const labels = new Map(
    groups.flatMap((group) => group.options.map((option) => [option.value, option.label])),
  );
  const choiceOf = (value: string): string => (matchValue ? matchValue(value) : value);
  const picked = new Set(values.map(choiceOf));
  const remaining = groups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => !picked.has(option.value)),
    }))
    .filter((group) => group.options.length > 0);

  const add = (value: string) => {
    setNotice(null);
    setAnnouncement(localize('com_config_specs_chip_added', { name: labels.get(value) ?? value }));
    onChange([...values, value]);
  };
  const remove = (value: string) => {
    const next = values.filter((item) => item !== value);
    setAnnouncement(
      localize('com_config_specs_chip_removed', { name: labels.get(value) ?? value }),
    );
    if (next.length > 0 || !onClear) {
      setNotice(null);
      onChange(next);
      return;
    }
    setNotice(onClear() === false ? localize('com_config_ctl_clear_unavailable') : null);
  };

  return (
    <div id={id} className="flex w-full flex-col gap-2">
      {values.length > 0 && (
        <ul aria-label={ariaLabel} className="settings-chip-list">
          {values.map((value) => {
            const label = labels.get(choiceOf(value));
            const known = label !== undefined;
            return (
              <li
                key={value}
                title={known ? value : unknownLabel(value)}
                className={cn(
                  'settings-chip',
                  !known &&
                    'border-(--settings-warn-mark) bg-(--settings-warn-bg) text-(--settings-warn-fg)',
                )}
              >
                {!known && <DecorativeIcon name="warning" size="xs" />}
                <span className="truncate">{known ? label : unknownLabel(value)}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => remove(value)}
                    aria-label={localize('com_config_specs_chip_remove', { name: label ?? value })}
                    title={localize('com_config_specs_chip_remove', { name: label ?? value })}
                    className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 text-inherit hover:bg-(--cui-color-background-hover) focus-visible:outline-2 focus-visible:outline-(--cui-color-outline)"
                  >
                    <DecorativeIcon name="cross" size="xs" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!disabled && remaining.length > 0 && (
        <div className={cn('relative w-full', widthClass('M'))}>
          <select
            id={`${id}-add`}
            value={PLACEHOLDER}
            aria-label={`${ariaLabel}: ${addLabel}`}
            aria-describedby={ariaDescribedBy}
            onChange={(event) => {
              if (event.target.value !== PLACEHOLDER) add(event.target.value);
            }}
            className={cn(INPUT_CLASSES, 'cursor-pointer appearance-none pr-8')}
          >
            <option value={PLACEHOLDER} disabled>
              {addLabel}
            </option>
            {remaining.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 text-(--cui-color-text-muted)"
          >
            <Icon name="plus" size="sm" />
          </span>
        </div>
      )}
      {disabled && values.length === 0 && (
        <span className="static-value static-value-unset">
          {localize('com_config_specs_chip_none')}
        </span>
      )}
      {notice && <FieldNotice>{notice}</FieldNotice>}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
