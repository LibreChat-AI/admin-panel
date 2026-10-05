import yaml from 'js-yaml';
import { Badge, Button, Dialog } from '@clickhouse/click-ui';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { SKIP_REASON_KEYS } from '@/constants';
import { maskSecretValues } from '@/utils';
import { useLocalize } from '@/hooks';

export function ConfirmSaveDialog({
  open,
  title,
  editedValues,
  originalValues,
  revertValues = {},
  skipped = [],
  unsafeKeys = [],
  saving,
  error,
  onConfirm,
  onCancel,
}: t.ConfirmSaveDialogProps) {
  const localize = useLocalize();
  const entries = Object.entries(editedValues).sort(([a], [b]) => a.localeCompare(b));
  const count = entries.length;
  const blocked = unsafeKeys.length > 0;
  const countLabel = (() => {
    if (count === 0 && skipped.length > 0) return localize('com_config_review_nothing_stored');
    if (count === 0) return localize('com_config_nothing_to_save_detail');
    if (count === 1) return localize('com_config_field_change_count', { count });
    return localize('com_config_field_change_count_plural', { count });
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <Dialog.Content title={title} showClose onClose={onCancel} className="modal-frost">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-(--cui-color-text-muted)">{countLabel}</p>

          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
            {entries.map(([path, newValue]) => {
              const leafKey = path.slice(path.lastIndexOf('.') + 1);
              return (
                <ChangeCard
                  key={path}
                  path={path}
                  oldValue={maskSecretValues(originalValues?.[path], leafKey)}
                  newValue={maskSecretValues(newValue, leafKey)}
                  isReset={path in revertValues}
                  revertValue={maskSecretValues(revertValues[path], leafKey)}
                />
              );
            })}
          </div>

          {skipped.length > 0 && (
            <div className="rounded-lg border border-(--cui-color-stroke-default) px-3 py-2 text-xs text-(--cui-color-text-muted)">
              <p className="m-0 mb-1 font-medium text-(--cui-color-text-default)">
                {localize('com_config_review_skipped', { count: skipped.length })}
              </p>
              <ul className="m-0 list-none p-0">
                {skipped.map((item) => (
                  <li key={item.fieldPath} className="wrap-anywhere">
                    <code>{item.fieldPath}</code>: {localize(SKIP_REASON_KEYS[item.reason])}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blocked && (
            <div role="alert" className="rounded-lg bg-[rgba(220,38,38,0.1)] px-3 py-2 text-xs">
              <p className="m-0 mb-1 text-sm font-medium text-(--cui-color-text-danger)">
                {localize('com_config_unsafe_keys_blocked')}
              </p>
              <ul className="m-0 list-none p-0 text-(--cui-color-text-danger)">
                {unsafeKeys.map(({ path, key }) => (
                  <li key={`${path}:${key}`}>
                    <code>{path}</code> → <code>{key}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-(--cui-color-text-danger)">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              htmlType="button"
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={onCancel}
              disabled={saving}
            />
            <Button
              htmlType="button"
              type="primary"
              label={saving ? localize('com_ui_loading') : localize('com_config_save')}
              onClick={onConfirm}
              disabled={saving || blocked}
            />
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

function resolvePathLabel(path: string, newValue: t.ConfigValue, oldValue: t.ConfigValue): string {
  const match = /^(.+)\.(\d+)$/.exec(path);
  if (!match) return path;
  const val = (newValue ?? oldValue) as Record<string, t.ConfigValue> | undefined;
  const name =
    val && typeof val === 'object' && !Array.isArray(val)
      ? (val as Record<string, string>).name
      : undefined;
  return name ? `${match[1]}[${match[2]}] (${name})` : `${match[1]}[${match[2]}]`;
}

function ChangeRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 px-3 py-2">
      <span className="w-16 shrink-0 text-[10px] font-medium tracking-wide text-(--cui-color-text-muted) uppercase">
        {label}
      </span>
      <div className="min-w-0 flex-1 overflow-x-auto">{children}</div>
    </div>
  );
}

/**
 * One reviewed change. A reset (`isReset`) removes the target's own override:
 * BEFORE is that override and REVERTS TO is the value that applies afterwards.
 */
function ChangeCard({
  path,
  oldValue,
  newValue,
  isReset,
  revertValue,
}: {
  path: string;
  oldValue: t.ConfigValue;
  newValue: t.ConfigValue;
  isReset: boolean;
  revertValue: t.ConfigValue;
}) {
  const localize = useLocalize();
  const notSet = localize('com_config_field_not_set');
  const isRemoval = newValue === undefined || newValue === null;
  const isAddition = !isReset && (oldValue === undefined || oldValue === null);
  const displayPath = resolvePathLabel(path, newValue, oldValue);

  return (
    <div className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-muted)">
      <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default) px-3 py-2">
        <span className="font-mono text-xs font-medium text-(--cui-color-text-default)">
          {displayPath}
        </span>
        {isAddition && (
          <Badge text={localize('com_config_field_added')} state="success" size="sm" />
        )}
        {isRemoval && (
          <Badge
            text={localize(
              isReset ? 'com_config_field_override_removed' : 'com_config_field_removed',
            )}
            state="danger"
            size="sm"
          />
        )}
      </div>

      <div className="flex flex-col gap-0 divide-y divide-(--cui-color-stroke-default)">
        {!isAddition && (
          <ChangeRow label={localize('com_config_field_before')}>
            <ValueDisplay value={oldValue} notSet={notSet} variant="old" />
          </ChangeRow>
        )}
        {isReset && (
          <ChangeRow label={localize('com_config_field_reverts_to')}>
            <ValueDisplay value={revertValue} notSet={notSet} variant="new" />
          </ChangeRow>
        )}
        {!isRemoval && (
          <ChangeRow label={localize('com_config_field_after')}>
            <ValueDisplay value={newValue} notSet={notSet} variant="new" />
          </ChangeRow>
        )}
      </div>
    </div>
  );
}

function isPrimitive(v: t.ConfigValue): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function ValueDisplay({
  value,
  notSet,
  variant,
}: {
  value: t.ConfigValue;
  notSet: string;
  variant: 'old' | 'new';
}) {
  const formatted = formatValue(value, notSet);
  const isBlock = typeof formatted === 'string' && formatted.includes('\n');

  if (isBlock) {
    return (
      <code
        className={`block font-mono text-[11px] leading-snug whitespace-pre ${
          variant === 'new' ? 'text-(--cui-color-text-default)' : 'text-(--cui-color-text-muted)'
        }`}
      >
        {formatted}
      </code>
    );
  }

  return (
    <span
      className={`text-xs ${
        variant === 'new'
          ? 'font-medium text-(--cui-color-text-default)'
          : 'text-(--cui-color-text-muted)'
      }`}
    >
      {formatted}
    </span>
  );
}

function formatValue(value: t.ConfigValue, notSetLabel: string): ReactNode {
  if (value === undefined || value === null) return notSetLabel;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.length <= 5 && value.every(isPrimitive)) {
      return value.map(String).join(', ');
    }
    return yaml.dump(value, { lineWidth: -1 }).trimEnd();
  }

  if (typeof value === 'object') {
    if (Object.keys(value).length === 0) return '{}';
    return yaml.dump(value, { lineWidth: -1 }).trimEnd();
  }

  try {
    return yaml.dump(value, { lineWidth: -1 }).trimEnd();
  } catch {
    return String(value);
  }
}
