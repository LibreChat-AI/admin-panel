import { useId, useState } from 'react';
import { TextField as CUITextField } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useDraftValue, useLocalize } from '@/hooks';
import { FieldNotice } from '../../fields/Notice';

const numberFormat = new Intl.NumberFormat();

function toText(value: number | undefined): string {
  return value == null ? '' : numberFormat.format(value);
}

/** Digits of what was typed, so `1,000,000`, `1 000 000` and `1000000` all read as one million. */
function parseCredits(text: string): number | null {
  const digits = text.replace(/[\s,._'’]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

/**
 * A whole number of credits shown with thousands separators (FX-11), with a
 * "credits" suffix. Typing commits after a pause, on blur or Enter; clearing
 * removes the own value (back to the placeholder's value).
 */
export function CreditsInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  min = 0,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: t.CreditsInputProps) {
  const localize = useLocalize();
  const errorId = useId();
  const unitId = useId();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { draft, setDraft, commit } = useDraftValue<string>({
    value: toText(value),
    autoCommit: (next) => next === '' || parseCredits(next) != null,
    onCommit: (next) => {
      if (next.trim() === '') {
        setError(null);
        const cleared = onChange(undefined);
        setNotice(cleared === false ? localize('com_config_ctl_clear_unavailable') : null);
        return 'reset';
      }
      const parsed = parseCredits(next);
      if (parsed == null) {
        setError(localize('com_config_credits_invalid'));
        return false;
      }
      if (parsed < min) {
        setError(localize('com_config_ctl_number_min', { min }));
        return false;
      }
      setError(null);
      onChange(parsed);
    },
  });
  const describedBy = [ariaDescribedBy, unitId, error ? errorId : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="cui-field flex w-40 max-w-full flex-col gap-1">
      <CUITextField
        id={id}
        value={draft}
        inputMode="numeric"
        autoComplete="off"
        onChange={(next) => {
          setDraft(next);
          setNotice(null);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        placeholder={placeholder != null ? numberFormat.format(placeholder) : undefined}
        disabled={disabled}
        endContent={
          <span id={unitId} className="pe-1 text-xs text-(--cui-color-text-muted)">
            {localize('com_config_ctl_unit_credits')}
          </span>
        }
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {error && (
        <span id={errorId} role="alert" className="text-xs text-(--cui-color-text-danger)">
          {error}
        </span>
      )}
      {notice && !error && <FieldNotice>{notice}</FieldNotice>}
    </div>
  );
}
