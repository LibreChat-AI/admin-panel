import { Button } from '@clickhouse/click-ui';
import { useId, useRef, useState } from 'react';
import type * as t from '@/types';
import { cn, domainIssue, normalizeDomain, splitDomainEntries } from '@/utils';
import { DecorativeIcon } from '@/components/shared';
import { getDomainListPolicy } from '@/constants';
import { INPUT_CLASSES } from './display';
import { FieldNotice } from './Notice';
import { useLocalize } from '@/hooks';

/** Separators that make typed text a list of entries. */
const LIST_SEPARATOR = /[,;\n]/;

const ISSUE_KEYS: Record<t.DomainIssue, string> = {
  invalid: 'com_config_features_domains_invalid',
  wildcard: 'com_config_features_domains_wildcard',
  path: 'com_config_features_domains_path',
  protocol: 'com_config_features_domains_protocol',
  duplicate: 'com_config_features_domains_duplicate',
};

/**
 * An allowlist of domains (FX-16): each entry is a chip with Remove, new
 * entries are validated as LibreChat parses them (host, optional scheme,
 * port or leading `*.`) before they are added on Enter, comma or Add, and
 * pasting a list adds every valid entry. A status line says what the list does: nothing restricts while
 * it is empty, so removing the last entry asks first (focus moves to the
 * question's Cancel, and back to the input once answered), and removes the edit
 * target's own list (D3: an empty list is never written over the list the
 * layer beneath sets, which then applies again). The last entry of a list
 * only the layer beneath sets can't be removed here, and the field says so.
 */
export function DomainListField({
  id,
  path,
  values,
  onChange,
  onClear,
  lowerValues,
  hasOwnValue,
  lowerSource,
  disabled,
  'aria-label': ariaLabel,
}: t.DomainListFieldProps) {
  const localize = useLocalize();
  const statusId = useId();
  const errorId = useId();
  const confirmId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const policy = getDomainListPolicy(path);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmingLast, setConfirmingLast] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const name = ariaLabel ?? id;
  const lowerCount = lowerValues?.length ?? 0;
  const source = localize(
    lowerSource === 'inherited'
      ? 'com_config_features_source_base'
      : 'com_config_features_source_yaml',
  );

  /** Adds the valid entries; the rejected ones stay in the input with the first reason. */
  const addEntries = (entries: string[]) => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    let firstIssue: t.DomainIssue | null = null;
    for (const entry of entries) {
      const issue = domainIssue(entry, policy.protocols, [...values, ...accepted]);
      if (issue) {
        rejected.push(entry);
        firstIssue ??= issue;
        continue;
      }
      accepted.push(normalizeDomain(entry));
    }
    if (accepted.length > 0) onChange([...values, ...accepted]);
    setDraft(rejected.join(', '));
    setError(firstIssue ? localize(ISSUE_KEYS[firstIssue], { value: rejected[0] ?? '' }) : null);
  };

  /** A typed entry is one domain; commas or semicolons separate several. */
  const commitDraft = () => {
    if (draft.trim() === '') {
      setDraft('');
      setError(null);
      return;
    }
    addEntries(LIST_SEPARATOR.test(draft) ? splitDomainEntries(draft) : [draft.trim()]);
  };

  /** Closes the confirmation strip; its buttons go with it, so focus goes back to the input. */
  const closeConfirm = () => {
    setConfirmingLast(false);
    inputRef.current?.focus();
  };

  const clearList = () => {
    closeConfirm();
    if (onClear() === false) {
      setNotice(localize('com_config_features_domains_keep_one', { source }));
    }
  };

  const remove = (index: number) => {
    setNotice(null);
    if (values.length > 1) {
      onChange(values.filter((_, i) => i !== index));
      inputRef.current?.focus();
      return;
    }
    if (!hasOwnValue && lowerCount > 0) {
      setNotice(localize('com_config_features_domains_keep_one', { source }));
      return;
    }
    setConfirmingLast(true);
  };

  const confirmText =
    lowerCount > 0
      ? localize('com_config_features_domains_confirm_restore', { count: lowerCount, source })
      : localize(policy.confirmKey);

  const status = localize(values.length === 0 ? policy.emptyKey : policy.activeKey, {
    count: values.length,
  });
  const describedBy = [statusId, error ? errorId : undefined].filter(Boolean).join(' ');

  return (
    <div className="flex w-full max-w-150 flex-col gap-2" id={disabled ? id : undefined}>
      <p
        id={statusId}
        className={cn(
          'm-0 flex items-start gap-1.5 text-xs',
          values.length === 0 ? 'text-(--settings-muted-fg)' : 'text-(--settings-info-fg)',
        )}
      >
        <span className="mt-px flex shrink-0">
          <DecorativeIcon name={values.length === 0 ? 'globe' : 'lock'} size="xs" />
        </span>
        <span>{status}</span>
      </p>
      {values.length > 0 && (
        <ul className="settings-chip-list" aria-label={name}>
          {values.map((value, index) => (
            <li key={value} className="settings-chip font-mono">
              <span className="truncate">{value}</span>
              {!disabled && (
                <button
                  type="button"
                  className="icon-btn icon-btn-xs rounded-full"
                  onClick={() => remove(index)}
                  aria-label={localize('com_config_features_domains_remove', { value })}
                >
                  <DecorativeIcon name="cross" size="xs" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirmingLast && (
        <div
          role="alertdialog"
          aria-label={localize('com_config_features_domains_confirm_title')}
          aria-describedby={confirmId}
          className="flex flex-wrap items-center gap-2 rounded-md border border-(--settings-warn-mark) bg-(--settings-warn-bg) px-3 py-2 text-xs text-(--settings-warn-fg)"
        >
          <span id={confirmId} className="min-w-0 flex-[1_1_14rem]">
            {confirmText}
          </span>
          <Button
            htmlType="button"
            type="danger"
            label={localize('com_config_features_domains_confirm_remove')}
            onClick={clearList}
          />
          <Button
            htmlType="button"
            type="secondary"
            label={localize('com_ui_cancel')}
            autoFocus
            onClick={closeConfirm}
          />
        </div>
      )}
      {!disabled && (
        <div className="flex items-start gap-2">
          <input
            ref={inputRef}
            id={id}
            type="text"
            value={draft}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={localize('com_config_features_domains_placeholder')}
            aria-label={localize('com_config_features_domains_add_a11y', { name })}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(INPUT_CLASSES, 'max-w-75 font-mono')}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text');
              const entries = splitDomainEntries(pasted);
              if (entries.length < 2 || draft.trim() !== '') return;
              event.preventDefault();
              addEntries(entries);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && draft !== '') {
                event.preventDefault();
                setDraft('');
                setError(null);
                return;
              }
              if (event.key !== 'Enter' && event.key !== ',') return;
              event.preventDefault();
              commitDraft();
            }}
            onBlur={() => {
              if (draft.trim() !== '') commitDraft();
            }}
          />
          <Button
            htmlType="button"
            type="secondary"
            iconLeft="plus"
            label={localize('com_config_features_domains_add')}
            disabled={draft.trim() === ''}
            onClick={() => {
              commitDraft();
              inputRef.current?.focus();
            }}
          />
        </div>
      )}
      {error && (
        <span id={errorId} role="alert" className="text-xs text-(--cui-color-text-danger)">
          {error}
        </span>
      )}
      {notice && <FieldNotice>{notice}</FieldNotice>}
    </div>
  );
}
