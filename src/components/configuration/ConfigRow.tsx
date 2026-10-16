import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { SettingsRow } from './SettingsRow';
import { useLocalize } from '@/hooks';

export function ConfigRow({
  title,
  description,
  learnMoreUrl,
  badge,
  children,
  disabled,
  hidden,
  fieldId,
  fieldPath,
  previewChangedPaths,
  permissions,
  onResetField,
  isConfigured,
  isDbOverride,
  isTouched,
  isPendingReset,
  defaultHint,
}: t.ConfigRowProps) {
  const localize = useLocalize();
  if (hidden) return null;

  const isChanged = fieldPath && previewChangedPaths?.includes(fieldPath);
  const showReset =
    !isPendingReset &&
    (isDbOverride || isChanged) &&
    fieldPath &&
    !disabled &&
    permissions?.canEdit &&
    onResetField;

  const resetAction = showReset ? (
    <button
      type="button"
      onClick={() => onResetField(fieldPath)}
      aria-label={
        isChanged
          ? localize('com_a11y_remove_override', { name: title })
          : localize('com_a11y_reset_to_default', { name: title })
      }
      className="inline-flex items-center gap-0.5 text-[11px] text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-default)"
    >
      <Icon name="refresh" size="sm" />
      <span>{localize('com_ui_reset')}</span>
    </button>
  ) : null;

  const pendingResetHint = isPendingReset ? (
    <span className="text-[11px] font-medium text-(--cui-color-accent-danger)">
      {localize('com_config_pending_reset')}
    </span>
  ) : null;

  const configuredDot =
    isConfigured && !isPendingReset ? (
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-(--cui-color-accent)"
        aria-hidden="true"
      />
    ) : null;

  const defaultHintEl =
    defaultHint != null ? (
      <span className="text-[11px] text-(--cui-color-text-muted)">
        {localize('com_config_default_hint', { value: String(defaultHint) })}
      </span>
    ) : null;

  const actions =
    resetAction || pendingResetHint || badge ? (
      <>
        {resetAction}
        {pendingResetHint}
        {badge}
      </>
    ) : undefined;

  return (
    <SettingsRow
      label={title}
      htmlFor={fieldId}
      description={description}
      learnMoreUrl={learnMoreUrl}
      control={children}
      chips={configuredDot}
      hint={defaultHintEl}
      actions={actions}
      dimmed={isPendingReset || (!isConfigured && !isTouched)}
    />
  );
}
