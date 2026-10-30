import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { INPUT_CLASSES, widthClass } from '../../fields/display';
import { cn } from '@/utils';

const PLACEHOLDER = '\u0000placeholder';

/**
 * A native select with option groups (Providers, Custom endpoints), so the
 * label targets the control and the OS list keeps type-ahead. A value that
 * matches no option is kept, selected and labelled as unknown.
 */
export function GroupedSelect({
  id,
  value,
  groups,
  onChange,
  placeholder,
  unknownLabel,
  required,
  disabled,
  'aria-describedby': ariaDescribedBy,
}: t.GroupedSelectProps) {
  const isUnset = value == null || value === '';
  const isKnown =
    isUnset || groups.some((group) => group.options.some((option) => option.value === value));
  return (
    <div className={cn('relative w-full', widthClass('M'))}>
      <select
        id={id}
        value={isUnset ? PLACEHOLDER : value}
        disabled={disabled}
        aria-required={required || undefined}
        aria-describedby={ariaDescribedBy}
        onChange={(event) => {
          if (event.target.value !== PLACEHOLDER) onChange(event.target.value);
        }}
        className={cn(INPUT_CLASSES, 'cursor-pointer appearance-none pe-8')}
      >
        {isUnset && (
          <option value={PLACEHOLDER} disabled>
            {placeholder}
          </option>
        )}
        {!isKnown && <option value={value}>{unknownLabel(value)}</option>}
        {groups
          .filter((group) => group.options.length > 0)
          .map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 inset-e-2.5 flex -translate-y-1/2 text-(--cui-color-text-muted)"
      >
        <Icon name="chevron-down" size="sm" />
      </span>
    </div>
  );
}
