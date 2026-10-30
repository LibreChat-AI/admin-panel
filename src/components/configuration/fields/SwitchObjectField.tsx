import { useRef, useCallback } from 'react';
import { Switch } from '@clickhouse/click-ui';
import type * as t from '@/types';

export function SwitchObjectField({
  id,
  value,
  onChange,
  disabled,
  children,
  'aria-label': ariaLabel,
}: t.SwitchObjectFieldProps) {
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  const isEnabled = isObject || value === true;
  const prevObjectRef = useRef<Record<string, t.ConfigValue> | null>(null);

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        onChange(prevObjectRef.current ?? true);
      } else {
        if (isObject) prevObjectRef.current = value as Record<string, t.ConfigValue>;
        onChange(false);
      }
    },
    [isObject, value, onChange],
  );

  return (
    <div id={id}>
      <Switch
        checked={isEnabled}
        onCheckedChange={handleToggle}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      {isEnabled && (
        <div className="mt-3 border-s-2 border-(--cui-color-stroke-default) ps-4">{children}</div>
      )}
    </div>
  );
}
