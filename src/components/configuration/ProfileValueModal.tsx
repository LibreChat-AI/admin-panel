import { useState } from 'react';
import { PrincipalType } from 'librechat-data-provider';
import { Icon, Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { getEnumOptions, getArrayItemType, toKVPair } from './utils';
import { KeyValueField } from './fields/KeyValueField';
import { TrashButton } from '@/components/shared';
import { getScopeTypeConfig } from '@/constants';
import { formatJson, cn } from '@/utils';
import { useLocalize } from '@/hooks';

export function ProfileValueModal({
  open,
  fieldSchema,
  controlType,
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  scopeName,
  scopeType,
  mode,
}: t.ProfileValueModalProps) {
  const localize = useLocalize();
  const scopeConfig = getScopeTypeConfig(scopeType as PrincipalType | 'BASE');

  const title =
    mode === 'edit'
      ? localize('com_scope_edit_value_title')
      : localize('com_scope_set_value_title');

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()} title={title} showClose onClose={onCancel} className="modal-frost">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            {scopeConfig && (
              <span aria-hidden="true" style={{ color: scopeConfig.color }}>
                <Icon name={scopeConfig.icon} size="sm" />
              </span>
            )}
            <span className="text-xs text-(--cui-color-text-muted)">{scopeName}</span>
          </div>

          <ModalValueControl
            fieldSchema={fieldSchema}
            controlType={controlType}
            value={value}
            onChange={onChange}
            onSubmit={onSave}
          />

          <div className="flex items-center justify-end gap-2">
            <Button
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={onCancel}
              disabled={saving}
            />
            <Button
              type="primary"
              label={localize('com_ui_save')}
              onClick={onSave}
              disabled={saving}
            />
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

function ModalValueControl({
  fieldSchema,
  controlType,
  value,
  onChange,
  onSubmit,
}: t.ModalValueControlProps) {
  const localize = useLocalize();

  if (controlType === 'toggle') {
    const boolVal = Boolean(value);
    return (
      <div className="flex justify-center">
        <div
          className="flex gap-1 rounded-lg border border-(--cui-color-stroke-default) p-0.5"
          role="radiogroup"
          aria-label={localize('com_ui_value')}
        >
          {([true, false] as const).map((opt) => (
            <button
              key={String(opt)}
              type="button"
              onClick={() => onChange(opt)}
              className={cn(
                'cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                boolVal === opt
                  ? 'bg-(--cui-color-background-active) text-(--cui-color-text-default)'
                  : 'text-(--cui-color-text-muted) hover:text-(--cui-color-text-default)',
              )}
              role="radio"
              aria-checked={boolVal === opt}
            >
              {opt ? localize('com_ui_true') : localize('com_ui_false')}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (controlType === 'select' && fieldSchema) {
    const options = getEnumOptions(fieldSchema.type);
    return (
      <div className="flex justify-center">
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="config-input w-full max-w-75"
          autoFocus
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (controlType === 'number') {
    return (
      <div className="flex justify-center">
        <input
          type="number"
          value={value === undefined || value === '' ? '' : Number(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          className="config-input w-full max-w-50"
          autoFocus
        />
      </div>
    );
  }

  if (controlType === 'array' && fieldSchema) {
    const itemType = getArrayItemType(fieldSchema.type);
    if (itemType === 'string') {
      const listValue = Array.isArray(value) ? value.map(String) : [];
      return (
        <div
          className="flex w-full flex-col gap-2"
          role="list"
          aria-label={localize('com_ui_value')}
        >
          {listValue.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2" role="listitem">
              <input
                type="text"
                value={item}
                onChange={(e) => {
                  const next = [...listValue];
                  next[idx] = e.target.value;
                  onChange(next);
                }}
                className="config-input flex-1"
                autoFocus={idx === listValue.length - 1}
              />
              <TrashButton
                onClick={() => onChange(listValue.filter((_, i) => i !== idx))}
                ariaLabel={`${localize('com_ui_delete')} ${idx + 1}`}
              />
            </div>
          ))}
          <Button
            type="secondary"
            label={localize('com_ui_add_item', { item: localize('com_ui_item') })}
            iconLeft="plus"
            onClick={() => onChange([...listValue, ''])}
          />
        </div>
      );
    }

    return <JsonEditor value={value} onChange={onChange} onSubmit={onSubmit} />;
  }

  if (controlType === 'record') {
    const pairs: t.KeyValuePair[] = Array.isArray(value)
      ? (value as t.KeyValuePair[])
      : Object.entries(
          typeof value === 'object' && value !== null
            ? (value as Record<string, t.ConfigValue>)
            : {},
        ).map(([k, v]) => toKVPair(k, v));

    return (
      <KeyValueField
        id="profile-kv"
        pairs={pairs}
        onChange={onChange}
        aria-label={localize('com_ui_value')}
      />
    );
  }

  if (controlType === 'text') {
    const strValue = typeof value === 'string' ? value : '';
    const isMultiline =
      strValue.includes('\n') || (fieldSchema?.key.toLowerCase().includes('content') ?? false);
    const isUrl =
      fieldSchema?.key.toLowerCase().includes('url') ||
      fieldSchema?.key.toLowerCase().includes('endpoint');

    if (isMultiline) {
      return (
        <textarea
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          className="config-input config-input-mono w-full resize-y"
          autoFocus
        />
      );
    }

    return (
      <input
        type={isUrl ? 'url' : 'text'}
        value={strValue}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
        placeholder={isUrl ? localize('com_ui_enter_url') : localize('com_ui_enter_value')}
        className="config-input w-full"
        autoFocus
      />
    );
  }

  return <JsonEditor value={value} onChange={onChange} onSubmit={onSubmit} />;
}

function JsonEditor({
  value,
  onChange,
  onSubmit,
}: {
  value: t.ConfigValue;
  onChange: (value: t.ConfigValue) => void;
  onSubmit: () => void;
}) {
  const localize = useLocalize();
  const [text, setText] = useState(() => formatJson(value));
  const [error, setError] = useState<string>();

  const handleBlur = (): boolean => {
    const trimmed = text.trim();
    if (trimmed === '') {
      setError(undefined);
      onChange(undefined);
      return true;
    }
    try {
      const parsed = JSON.parse(trimmed);
      setError(undefined);
      onChange(parsed);
      return true;
    } catch {
      setError(localize('com_ui_invalid_json'));
      return false;
    }
  };

  const rows = Math.max(3, Math.min(12, text.split('\n').length));

  return (
    <div className="flex w-full flex-col gap-1">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(undefined);
        }}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            if (handleBlur()) onSubmit();
          }
        }}
        placeholder={localize('com_ui_edit_json')}
        rows={rows}
        className="config-input config-input-mono w-full resize-y"
        spellCheck={false}
        autoFocus
      />
      {error && <span className="text-xs text-(--cui-color-text-danger)">{error}</span>}
    </div>
  );
}

export function getDefaultValue(controlType: string, fieldSchema?: t.SchemaField): t.ConfigValue {
  if (controlType === 'toggle') return false;
  if (controlType === 'number') return 0;
  if (controlType === 'select' && fieldSchema) {
    const opts = getEnumOptions(fieldSchema.type);
    return opts.length > 0 ? opts[0].value : '';
  }
  if (controlType === 'array') return [];
  if (controlType === 'record') return [];
  if (controlType === 'object' || controlType === 'code') return {};
  return '';
}
