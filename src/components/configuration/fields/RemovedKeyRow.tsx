import type * as t from '@/types';
import { DecorativeIcon } from '@/components/shared';
import { useLocalize } from '@/hooks';

const STATUS_KEYS: Readonly<Record<t.RemovedRecordKey['state'], string>> = {
  saved: 'com_config_ctl_kv_removed',
  pending: 'com_config_ctl_kv_removed_pending',
  restoring: 'com_config_ctl_kv_restoring',
};

const ACTION_KEYS: Readonly<Record<t.RemovedRecordKey['state'], t.ToggleButtonKeys>> = {
  saved: { label: 'com_config_ctl_kv_restore', aria: 'com_config_ctl_kv_restore_a11y' },
  pending: { label: 'com_config_ctl_entry_undo', aria: 'com_config_ctl_kv_remove_undo_a11y' },
  restoring: { label: 'com_config_ctl_entry_undo', aria: 'com_config_ctl_kv_restore_undo_a11y' },
};

/**
 * An inherited key the edit target removes by key (`keyedTombstones`):
 * struck through with its inherited value, what Save does with it, and
 * Restore (a saved removal) or Undo (a pending removal or restore).
 */
export function RemovedKeyRow({ name, value, state, disabled, onToggle }: t.RemovedKeyRowProps) {
  const localize = useLocalize();
  const action = ACTION_KEYS[state];
  const text = value === '' ? name : `${name}: ${value}`;
  return (
    <div
      role="listitem"
      data-kv-removed={name}
      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-(--cui-color-stroke-default) px-2 py-1.5"
    >
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-(--cui-color-text-muted) line-through"
        title={text}
      >
        {text}
      </span>
      <span className="text-xs text-(--cui-color-text-muted)">{localize(STATUS_KEYS[state])}</span>
      {onToggle && !disabled && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={localize(action.aria, { key: name })}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-solid border-(--cui-color-stroke-default) bg-transparent px-2 py-1 text-xs text-(--cui-color-text-default) hover:bg-(--cui-color-background-hover)"
        >
          <DecorativeIcon name={state === 'saved' ? 'eye' : 'history'} size="sm" />
          {localize(action.label)}
        </button>
      )}
    </div>
  );
}
