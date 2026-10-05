import { Select } from '@clickhouse/click-ui';
import TextareaAutosize from 'react-textarea-autosize';
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import type * as t from '@/types';
import { AddItemButton, TrashButton } from '@/components/shared';
import { BLOCK_UNSAFE_CONFIG_KEYS } from '@/constants';
import { isUnsafeConfigKey } from '@/utils';
import { useLocalize } from '@/hooks';

const DEFAULT_TYPES: t.KVValueType[] = ['string', 'number', 'boolean'];
const TYPE_LABEL_KEYS: Record<t.KVValueType, string> = {
  string: 'com_kv_type_string',
  number: 'com_kv_type_number',
  boolean: 'com_kv_type_boolean',
  json: 'com_kv_type_json',
};

function LocalInput({
  value,
  onCommit,
  type = 'text',
  placeholder,
  disabled,
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: {
  value: string;
  onCommit: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const [local, setLocal] = useState(value);
  const externalRef = useRef(value);

  useEffect(() => {
    if (value !== externalRef.current) {
      externalRef.current = value;
      setLocal(value);
    }
  }, [value]);

  const commit = () => {
    if (local !== externalRef.current) {
      externalRef.current = local;
      onCommit(local);
    }
  };

  return (
    <input
      type={type}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedBy}
      className={className}
    />
  );
}

function LocalTextarea({
  value,
  onCommit,
  placeholder,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const [local, setLocal] = useState(value);
  const externalRef = useRef(value);

  useEffect(() => {
    if (value !== externalRef.current) {
      externalRef.current = value;
      setLocal(value);
    }
  }, [value]);

  const commit = () => {
    if (local !== externalRef.current) {
      externalRef.current = local;
      onCommit(local);
    }
  };

  return (
    <TextareaAutosize
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      minRows={1}
      className="config-input w-full resize-none font-mono text-xs"
    />
  );
}

export function KeyValueField({
  id,
  pairs,
  onChange,
  disabled,
  valueTypes,
  keyPlaceholder,
  valuePlaceholder,
  'aria-label': ariaLabel,
}: t.KeyValueFieldProps) {
  const localize = useLocalize();
  const availableTypes = valueTypes ?? DEFAULT_TYPES;
  const listRef = useRef<HTMLDivElement>(null);
  const focusLastKeyRef = useRef(false);

  useLayoutEffect(() => {
    if (focusLastKeyRef.current) {
      focusLastKeyRef.current = false;
      const rows = listRef.current?.querySelectorAll<HTMLElement>('[role="listitem"]');
      const lastRow = rows?.[rows.length - 1];
      lastRow?.querySelector<HTMLInputElement>('input')?.focus();
    }
  });

  const handleAdd = () => {
    onChange([...pairs, { key: '', value: '', valueType: availableTypes[0] }]);
    focusLastKeyRef.current = true;
  };
  const handleRemove = (index: number) => onChange(pairs.filter((_, i) => i !== index));
  const handleChange = (index: number, field: 'key' | 'value', newValue: string) => {
    const next = [...pairs];
    next[index] = { ...next[index], [field]: newValue };
    onChange(next);
  };
  const handleTypeChange = (index: number, newType: t.KVValueType) => {
    const next = [...pairs];
    const pair = next[index];
    let coerced = pair.value;
    if (newType === 'boolean') {
      coerced = pair.value === 'true' || pair.value === '1' ? 'true' : 'false';
    }
    next[index] = { ...pair, value: coerced, valueType: newType };
    onChange(next);
  };

  const keyErrorId = (index: number) => `${id.replace(/[^\w-]/g, '-')}-key-${index}-error`;
  const hasKeyError = (pair: t.KeyValuePair) =>
    BLOCK_UNSAFE_CONFIG_KEYS && isUnsafeConfigKey(pair.key);
  const deleteLabel = (pair: t.KeyValuePair, index: number) =>
    `${localize('com_ui_delete')} ${pair.key || `${localize('com_ui_entry')} ${index + 1}`}`;
  const keyError = (pair: t.KeyValuePair, index: number) =>
    hasKeyError(pair) ? (
      <p id={keyErrorId(index)} role="alert" className="m-0 text-xs text-(--cui-color-text-danger)">
        {localize('com_config_unsafe_key_error')}
      </p>
    ) : null;

  const renderPrimitiveRow = (vType: t.KVValueType, pair: t.KeyValuePair, index: number) => {
    const valueLabel = `${localize('com_ui_value')} ${index + 1}`;
    const invalid = hasKeyError(pair);
    return (
      <div className="flex flex-col gap-1" role="listitem">
        <div className="flex items-center gap-2">
          <LocalInput
            value={pair.key}
            onCommit={(v) => handleChange(index, 'key', v)}
            placeholder={keyPlaceholder ?? localize('com_ui_key')}
            disabled={disabled}
            aria-label={`${localize('com_ui_key')} ${index + 1}`}
            aria-invalid={invalid}
            aria-describedby={invalid ? keyErrorId(index) : undefined}
            className="config-input max-w-37.5 flex-1"
          />
          {vType === 'boolean' ? (
            <div className="select-field-a11y flex-2">
              <Select
                value={pair.value === 'true' ? 'true' : 'false'}
                onSelect={(v) => handleChange(index, 'value', v)}
                disabled={disabled}
                aria-label={valueLabel}
              >
                <Select.Item value="true">{localize('com_ui_true')}</Select.Item>
                <Select.Item value="false">{localize('com_ui_false')}</Select.Item>
              </Select>
            </div>
          ) : (
            <LocalInput
              type={vType === 'number' ? 'number' : 'text'}
              value={pair.value}
              onCommit={(v) => handleChange(index, 'value', v)}
              placeholder={valuePlaceholder ?? localize('com_ui_value')}
              disabled={disabled}
              aria-label={valueLabel}
              className="config-input flex-2"
            />
          )}
          {!disabled && availableTypes.length > 1 && (
            <div className="select-field-a11y w-20 shrink-0">
              <Select
                value={vType}
                onSelect={(v) => handleTypeChange(index, v as t.KVValueType)}
                aria-label={`${localize('com_config_field_type')} ${index + 1}`}
              >
                {availableTypes.map((vt) => (
                  <Select.Item key={vt} value={vt}>
                    {localize(TYPE_LABEL_KEYS[vt])}
                  </Select.Item>
                ))}
              </Select>
            </div>
          )}
          {!disabled && (
            <TrashButton onClick={() => handleRemove(index)} ariaLabel={deleteLabel(pair, index)} />
          )}
        </div>
        {keyError(pair, index)}
      </div>
    );
  };

  const renderJsonRow = (pair: t.KeyValuePair, index: number) => (
    <div className="flex flex-col gap-1" role="listitem">
      <div className="flex items-center gap-2">
        <LocalInput
          value={pair.key}
          onCommit={(v) => handleChange(index, 'key', v)}
          placeholder={keyPlaceholder ?? localize('com_ui_key')}
          disabled={disabled}
          aria-label={`${localize('com_ui_key')} ${index + 1}`}
          aria-invalid={hasKeyError(pair)}
          aria-describedby={hasKeyError(pair) ? keyErrorId(index) : undefined}
          className="config-input min-w-0 flex-1"
        />
        {!disabled && availableTypes.length > 1 && (
          <div className="select-field-a11y w-20 shrink-0">
            <Select
              value="json"
              onSelect={(v) => handleTypeChange(index, v as t.KVValueType)}
              aria-label={`${localize('com_config_field_type')} ${index + 1}`}
            >
              {availableTypes.map((vt) => (
                <Select.Item key={vt} value={vt}>
                  {localize(TYPE_LABEL_KEYS[vt])}
                </Select.Item>
              ))}
            </Select>
          </div>
        )}
        {!disabled && (
          <TrashButton onClick={() => handleRemove(index)} ariaLabel={deleteLabel(pair, index)} />
        )}
      </div>
      {keyError(pair, index)}
      <LocalTextarea
        value={pair.value}
        onCommit={(v) => handleChange(index, 'value', v)}
        placeholder='{"key": "value"}'
        disabled={disabled}
        aria-label={`${localize('com_ui_value')} ${index + 1}`}
      />
    </div>
  );

  return (
    <div
      ref={listRef}
      id={id}
      className="flex w-full max-w-150 flex-col gap-2"
      role="list"
      aria-label={ariaLabel}
    >
      {pairs.map((pair, index) => {
        const vType = pair.valueType ?? 'string';
        return vType === 'json'
          ? renderJsonRow(pair, index)
          : renderPrimitiveRow(vType, pair, index);
      })}

      {!disabled && (
        <AddItemButton
          label={localize('com_ui_add_item', { item: localize('com_ui_entry') })}
          onClick={handleAdd}
        />
      )}
    </div>
  );
}
