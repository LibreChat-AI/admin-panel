import { Button } from '@clickhouse/click-ui';
import { useContext, useId, useState } from 'react';
import type * as t from '@/types';
import { RestatesContext } from '@/contexts/RestatesContext';
import { cn, isFilledText, isEnvReference } from '@/utils';
import { INPUT_CLASSES, widthClass } from './display';
import { DecorativeIcon } from '@/components/shared';
import { useDraftValue, useLocalize } from '@/hooks';
import { SECRET_PREVIEW_MASK } from '@/constants';
import { FieldNotice } from './Notice';

const ACTION_BUTTON_CLASSES =
  'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-(--cui-color-stroke-default) bg-transparent px-1.5 py-1 text-xs text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default) focus-visible:outline-1 focus-visible:outline-(--cui-color-outline)';

/**
 * Password input with a reveal toggle. Commits like `TextField` (after a
 * pause, on blur or Enter); clearing calls `onClear` (remove the own value).
 */
export function SecretInput({
  id,
  value,
  onChange,
  onClear,
  required,
  hasRowError,
  placeholder,
  disabled,
  width,
  autoFocus,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: t.SecretInputProps) {
  const localize = useLocalize();
  const errorId = useId();
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { draft, setDraft, commit } = useDraftValue<string>({
    value,
    autoCommit: isFilledText,
    onCommit: (next) => {
      if (isFilledText(next)) {
        setError(null);
        onChange(next);
        return;
      }
      if (required) {
        setError(localize('com_config_ctl_required'));
        onChange('');
        return;
      }
      if (!onClear) {
        onChange('');
        return;
      }
      const cleared = onClear();
      setNotice(cleared === false ? localize('com_config_ctl_clear_unavailable') : null);
      return 'reset';
    },
  });
  const name = ariaLabel ?? id;
  const shownError = hasRowError ? null : error;
  const describedBy = [ariaDescribedBy, shownError ? errorId : undefined].filter(Boolean).join(' ');

  return (
    <div className={cn('flex w-full flex-col gap-1', widthClass(width))}>
      <div className="relative w-full">
        <input
          id={id}
          type={revealed || isEnvReference(draft) ? 'text' : 'password'}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setNotice(null);
            if (error && isFilledText(e.target.value)) setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          placeholder={placeholder ?? localize('com_ui_enter_value')}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(INPUT_CLASSES, 'pr-9')}
        />
        {draft !== '' && !isEnvReference(draft) && (
          <button
            type="button"
            onClick={() => setRevealed((prev) => !prev)}
            disabled={disabled}
            aria-pressed={revealed}
            aria-label={localize(
              revealed ? 'com_config_ctl_secret_hide' : 'com_config_ctl_secret_show',
              { name },
            )}
            className="icon-btn icon-btn-xs absolute top-1/2 right-1 -translate-y-1/2"
          >
            <DecorativeIcon name={revealed ? 'eye-closed' : 'eye'} size="sm" />
          </button>
        )}
      </div>
      {shownError && (
        <span id={errorId} role="alert" className="text-xs text-(--cui-color-text-danger)">
          {shownError}
        </span>
      )}
      {notice && !error && <FieldNotice>{notice}</FieldNotice>}
    </div>
  );
}

/**
 * A secret that is set but redacted by the backend: a read-only masked
 * display with explicit Replace (and, when the target owns it, Remove)
 * actions. The masked value is never editable and never emitted through
 * onChange, so it cannot enter a save payload. A fixed mask, which shows
 * nothing of the secret, reads as where it is set (`maskLabel`).
 */
export function SecretField({
  id,
  value,
  maskedValue,
  onChange,
  onCancel,
  onRemove,
  maskLabel,
  hasPendingEdit,
  disabled,
  width,
  ...ariaProps
}: t.SecretFieldProps) {
  const localize = useLocalize();
  const [replacing, setReplacing] = useState(false);
  const showInput = replacing || value !== '' || (hasPendingEdit ?? false);
  const fieldName = ariaProps['aria-label'] ?? id;
  const isMask = maskedValue === SECRET_PREVIEW_MASK;

  if (!showInput) {
    return (
      <div className={cn('flex w-full items-center gap-2', widthClass(width))}>
        <input
          id={id}
          value={isMask ? (maskLabel ?? localize('com_config_secret_hidden')) : maskedValue}
          readOnly
          disabled
          aria-label={localize('com_a11y_secret_configured', { name: fieldName })}
          className={cn(INPUT_CLASSES, 'flex-1', !isMask && 'font-mono')}
        />
        {!disabled && (
          <button
            type="button"
            onClick={() => setReplacing(true)}
            aria-label={localize('com_a11y_secret_replace', { name: fieldName })}
            className={ACTION_BUTTON_CLASSES}
          >
            <DecorativeIcon name="pencil" size="sm" />
            <span>{localize('com_config_secret_replace')}</span>
          </button>
        )}
        {!disabled && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={localize('com_config_ctl_secret_remove_a11y', { name: fieldName })}
            className={ACTION_BUTTON_CLASSES}
          >
            <DecorativeIcon name="trash" size="sm" />
            <span>{localize('com_config_ctl_secret_remove')}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex w-full items-start gap-2', widthClass(width))}>
      <SecretInput
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        autoFocus={replacing && value === ''}
        placeholder={localize('com_config_ctl_secret_new')}
        {...ariaProps}
      />
      {!disabled && (
        <button
          type="button"
          onClick={() => {
            setReplacing(false);
            onCancel();
          }}
          aria-label={localize('com_a11y_secret_cancel_replace', { name: fieldName })}
          className={cn(ACTION_BUTTON_CLASSES, 'mt-1')}
        >
          <DecorativeIcon name="cross" size="sm" />
          <span>{localize('com_ui_cancel')}</span>
        </button>
      )}
    </div>
  );
}

/**
 * Where a secret read back as the fixed mask is set, for `maskLabel`: the
 * target's own value, librechat.yaml, or the layer a profile inherits from.
 */
export function maskedSecretLabel(state: t.FieldState, localize: t.LocalizeFn): string {
  if (state.isOverride) return localize('com_config_secret_hidden');
  if (state.source === 'yaml') return localize('com_config_secret_hidden_yaml');
  if (state.source === 'inherited') return localize('com_config_secret_hidden_inherited');
  return localize('com_config_secret_hidden');
}

/**
 * Under an inherited credential LibreChat no longer sends (`secretRebinding`):
 * the target changed where it goes (`fields`) without entering one. A
 * readable one (a `${VAR}` reference) can be restated, so LibreChat sends it
 * there too; once restated, the notice says so, with Undo.
 */
export function SecretNotSentNotice({ credential, fields, disabled }: t.SecretNotSentNoticeProps) {
  const localize = useLocalize();
  const { onRestate } = useContext(RestatesContext);
  const { path, entry, secret, restated } = credential;
  /** The inherited value this page can restate: none where it can't be edited. */
  const value = onRestate && !disabled ? credential.restatable : undefined;
  const restate = (next: boolean) => onRestate?.({ path, entry, secret }, next);
  if (restated && credential.restatable !== undefined) {
    return (
      <span
        role="status"
        className="flex flex-col items-start gap-2 text-xs text-(--cui-color-text-muted)"
      >
        {localize('com_config_secret_restated', { value: credential.restatable })}
        {value !== undefined && (
          <Button
            htmlType="button"
            type="secondary"
            label={localize('com_config_secret_restate_undo')}
            onClick={() => restate(false)}
          />
        )}
      </span>
    );
  }
  return (
    <span
      role="status"
      className="flex flex-col items-start gap-2 text-xs text-(--settings-warn-fg)"
    >
      <span className="flex items-start gap-1">
        <span aria-hidden="true" className="mt-px flex shrink-0 text-(--settings-warn-mark)">
          <DecorativeIcon name="warning" size="xs" />
        </span>
        {value === undefined
          ? localize('com_config_secret_not_sent', { fields })
          : localize('com_config_secret_not_sent_restatable', { fields, value })}
      </span>
      {value !== undefined && (
        <Button
          htmlType="button"
          type="secondary"
          label={localize('com_config_secret_restate')}
          onClick={() => restate(true)}
        />
      )}
    </span>
  );
}
