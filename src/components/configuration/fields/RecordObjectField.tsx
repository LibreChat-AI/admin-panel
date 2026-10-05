import { Button } from '@clickhouse/click-ui';
import { useId, useState, useCallback, useEffect, memo } from 'react';
import type * as t from '@/types';
import { BLOCK_UNSAFE_CONFIG_KEYS } from '@/constants';
import { AddItemButton } from '@/components/shared';
import { ObjectEntryCard } from './ObjectEntryCard';
import { isUnsafeConfigKey } from '@/utils';
import { useLocalize } from '@/hooks';

export function RecordObjectField({
  id,
  value,
  fields,
  onChange,
  disabled,
  allowPrimitiveValues,
  addTriggerRef,
  renderFields,
  editSessionId,
}: t.RecordObjectFieldProps) {
  const localize = useLocalize();
  const [showAddInput, setShowAddInput] = useState(false);
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  // Expose add trigger to parent (e.g. NestedGroup header button)
  useEffect(() => {
    if (addTriggerRef) {
      addTriggerRef.current = () => setShowAddInput(true);
      return () => {
        addTriggerRef.current = null;
      };
    }
  }, [addTriggerRef]);

  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, t.ConfigValue>)
      : {};
  const entries = Object.entries(record);

  const handleAdd = useCallback(
    (key: string) => {
      if (key in record) return;
      // Prepend: new key first, then existing entries
      const next: Record<string, t.ConfigValue> = {
        [key]: allowPrimitiveValues ? true : {},
      };
      for (const [k, v] of Object.entries(record)) {
        next[k] = v;
      }
      onChange(next);
      setJustAddedKey(key);
      setShowAddInput(false);
    },
    [record, onChange, allowPrimitiveValues],
  );

  const handleRemove = useCallback(
    (key: string) => {
      const next = { ...record };
      delete next[key];
      onChange(next);
    },
    [record, onChange],
  );

  const handleEntryChange = useCallback(
    (key: string, newValue: t.ConfigValue) => {
      onChange({ ...record, [key]: newValue });
    },
    [record, onChange],
  );

  const handleRename = useCallback(
    (oldKey: string, renamed: string) => {
      if (renamed === oldKey || renamed in record) return;
      if (BLOCK_UNSAFE_CONFIG_KEYS && isUnsafeConfigKey(renamed)) return;
      const next: Record<string, t.ConfigValue> = {};
      for (const [k, v] of Object.entries(record)) {
        next[k === oldKey ? renamed : k] = v;
      }
      onChange(next);
    },
    [record, onChange],
  );

  return (
    <div id={id} className="flex w-full flex-col gap-2">
      {!disabled && showAddInput && (
        <AddKeyInput
          existingKeys={record}
          onAdd={handleAdd}
          onCancel={() => setShowAddInput(false)}
        />
      )}
      {entries.map(([key, entryValue]) => (
        <ObjectEntryCard
          key={key}
          entryKey={key}
          fields={fields}
          value={entryValue}
          onValueChange={(v) => handleEntryChange(key, v)}
          onRemove={disabled ? undefined : () => handleRemove(key)}
          onRename={disabled ? undefined : (renamed) => handleRename(key, renamed)}
          disabled={disabled}
          defaultExpanded={key === justAddedKey}
          renderFields={renderFields}
          editSessionId={editSessionId}
        />
      ))}
      {entries.length === 0 && !showAddInput && (
        <p className="py-2 text-sm text-(--cui-color-text-muted)">
          {localize('com_config_no_entries')}
        </p>
      )}
      {!disabled && !addTriggerRef && !showAddInput && (
        <AddItemButton
          label={localize('com_ui_add_item', { item: localize('com_ui_entry') })}
          onClick={() => setShowAddInput(true)}
        />
      )}
    </div>
  );
}

/** Isolated input so keystrokes don't re-render sibling ObjectEntryCards. */
const AddKeyInput = memo(function AddKeyInput({
  existingKeys,
  onAdd,
  onCancel,
}: {
  existingKeys: Record<string, t.ConfigValue>;
  onAdd: (key: string) => void;
  onCancel: () => void;
}) {
  const localize = useLocalize();
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const handleAdd = () => {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed in existingKeys) return;
    if (BLOCK_UNSAFE_CONFIG_KEYS && isUnsafeConfigKey(trimmed)) {
      setError(localize('com_config_unsafe_key_error'));
      return;
    }
    // Blur before unmount so the browser doesn't move focus to the next
    // focusable element in DOM order while React removes this component.
    (document.activeElement as HTMLElement)?.blur();
    onAdd(trimmed);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newKey}
          aria-label={localize('com_ui_key')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setNewKey(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
            if (e.key === 'Escape') {
              setNewKey('');
              onCancel();
            }
          }}
          placeholder={localize('com_ui_key')}
          className="config-input max-w-50 px-2 py-1 text-sm"
          autoFocus
        />
        <Button
          htmlType="button"
          type="primary"
          label={localize('com_ui_add')}
          onClick={handleAdd}
        />
        <Button
          htmlType="button"
          type="secondary"
          label={localize('com_ui_cancel')}
          onClick={() => {
            setNewKey('');
            onCancel();
          }}
        />
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="m-0 text-xs text-(--cui-color-text-danger)"
        >
          {error}
        </p>
      )}
    </div>
  );
});
