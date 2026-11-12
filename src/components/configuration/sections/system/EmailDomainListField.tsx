import { useState } from 'react';
import { Button, TextField as CUITextField } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { DecorativeIcon } from '@/components/shared';
import { EMAIL_DOMAIN_PATTERN } from '@/constants';
import { useLocalize } from '@/hooks';

/** `@Example.com ` → `example.com`: LibreChat compares the lowercased part after `@`. */
function normalizeDomain(text: string): string {
  return text.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Email domains as removable chips with a validated input (FX-9). Typing a
 * domain and pressing Enter (or a comma) adds it; a pasted list adds every
 * valid domain. Invalid and duplicate domains stay in the input with the
 * reason. Removing the last chip is the caller's to confirm (anyone can sign
 * up with an empty list).
 */
export function EmailDomainListField({
  id,
  domains,
  onChange,
  disabled,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: t.EmailDomainListFieldProps) {
  const localize = useLocalize();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id}-error`;
  const inputId = `${id}-input`;

  const add = (text: string): boolean => {
    const parts = text
      .split(/[\s,;]+/)
      .map(normalizeDomain)
      .filter((part) => part !== '');
    if (parts.length === 0) return true;
    const invalid = parts.filter((part) => !EMAIL_DOMAIN_PATTERN.test(part));
    if (invalid.length > 0) {
      setError(localize('com_config_registration_domain_invalid', { domain: invalid[0] }));
      return false;
    }
    const fresh = parts.filter((part, i) => !domains.includes(part) && parts.indexOf(part) === i);
    if (fresh.length === 0) {
      setError(localize('com_config_registration_domain_duplicate', { domain: parts[0] }));
      return false;
    }
    setError(null);
    onChange([...domains, ...fresh]);
    return true;
  };

  const submit = () => {
    if (add(draft)) setDraft('');
  };

  if (disabled) {
    return (
      <span id={id} className="static-value">
        {domains.length > 0 ? domains.join(', ') : localize('com_config_registration_anyone')}
      </span>
    );
  }

  return (
    <div id={id} className="flex w-full max-w-150 flex-col gap-2">
      {domains.length > 0 && (
        <ul className="settings-chip-list" aria-label={ariaLabel}>
          {domains.map((domain) => (
            <li key={domain} className="settings-chip font-mono">
              {domain}
              <button
                type="button"
                className="icon-btn icon-btn-xs"
                aria-label={localize('com_config_registration_domain_remove', { domain })}
                title={localize('com_config_registration_domain_remove', { domain })}
                onClick={() => {
                  onChange(domains.filter((item) => item !== domain));
                  requestAnimationFrame(() => document.getElementById(inputId)?.focus());
                }}
              >
                <DecorativeIcon name="cross" size="xs" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <div className="cui-field flex w-64 max-w-full flex-col">
          <CUITextField
            id={inputId}
            value={draft}
            placeholder={localize('com_config_registration_domain_placeholder')}
            aria-label={localize('com_config_registration_domain_add_label')}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              [ariaDescribedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined
            }
            onChange={(next) => {
              if (/[,;\n]/.test(next)) {
                if (add(next)) setDraft('');
                else setDraft(next);
                return;
              }
              setDraft(next);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              submit();
            }}
          />
        </div>
        <Button
          htmlType="button"
          type="secondary"
          iconLeft="plus"
          label={localize('com_config_registration_domain_add')}
          onClick={submit}
          disabled={draft.trim() === ''}
        />
      </div>
      {error && (
        <span id={errorId} role="alert" className="text-xs text-(--cui-color-text-danger)">
          {error}
        </span>
      )}
    </div>
  );
}
