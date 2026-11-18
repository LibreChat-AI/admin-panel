import yaml from 'js-yaml';
import { useState, useEffect, useRef } from 'react';
import type * as t from '@/types';
import { useLocalize, useSessionDraft } from '@/hooks';
import { cn, isConfigValueEqual } from '@/utils';

function toYaml(value: t.ConfigValue): string {
  if (value === undefined || value === null) return '';
  return yaml.dump(value, { lineWidth: -1 }).trimEnd();
}

export function CodeField({
  id,
  value,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: t.CodeFieldProps) {
  const localize = useLocalize();
  const [text, setText] = useState(() => toYaml(value));
  const [error, setError] = useState<string>();
  const externalValue = useRef(value);
  const recovery = useSessionDraft(!disabled && text !== toYaml(value));
  const sessionRef = useRef(recovery?.editSessionId);
  const preserveRef = useRef(false);
  if (recovery?.blocked && text !== toYaml(externalValue.current)) preserveRef.current = true;

  useEffect(() => {
    const reset = sessionRef.current !== recovery?.editSessionId;
    sessionRef.current = recovery?.editSessionId;
    const preserve = preserveRef.current && !reset;
    if (reset) preserveRef.current = false;
    if (!reset && value === externalValue.current) return;
    externalValue.current = value;
    if (preserve) return;
    setText(toYaml(value));
    setError(undefined);
  }, [value, recovery?.editSessionId, recovery?.blocked]);

  /** Leaving the field writes only a change: focusing a default or saved value and tabbing on pins nothing. */
  const handleBlur = () => {
    if (recovery?.blocked) return;
    const trimmed = text.trim();
    if (trimmed === toYaml(value)) {
      preserveRef.current = false;
      setError(undefined);
      return;
    }
    if (trimmed === '') {
      preserveRef.current = false;
      setError(undefined);
      onChange(undefined);
      return;
    }
    try {
      const parsed = yaml.load(trimmed, { schema: yaml.JSON_SCHEMA }) as t.ConfigValue;
      preserveRef.current = false;
      setError(undefined);
      if (isConfigValueEqual(parsed, value)) return;
      externalValue.current = parsed;
      onChange(parsed);
    } catch {
      setError(localize('com_ui_invalid_yaml'));
    }
  };

  const rows = Math.max(2, Math.min(12, text.split('\n').length));

  return (
    <div className="flex w-full max-w-100 flex-col gap-1">
      <textarea
        id={id}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(undefined);
        }}
        onBlur={handleBlur}
        placeholder={localize('com_ui_edit_yaml')}
        disabled={disabled}
        rows={rows}
        aria-label={ariaLabel}
        className={cn(
          'config-input config-input-mono w-full resize-y tabular-nums',
          error && 'config-input-error',
        )}
        spellCheck={false}
      />
      {error && <span className="text-xs text-(--cui-color-text-danger)">{error}</span>}
    </div>
  );
}
