import type * as t from '@/types';
import {
  coerceEnumValue,
  getArrayItemType,
  getControlType,
  getEnumOptions,
  isStringLikeItemType,
  splitUnionTypes,
} from '../controls';
import { ArrayObjectNestedGroup, RecordObjectNestedGroup } from './Collections';
import { SwitchObjectField } from '../fields/SwitchObjectField';
import { TextRecordField } from '../fields/TextRecordField';
import { ListRecordField } from '../fields/ListRecordField';
import { TextareaField } from '../fields/TextareaField';
import { KeyValueField } from '../fields/KeyValueField';
import { NumberField } from '../fields/NumberField';
import { SecretField } from '../fields/SecretField';
import { ToggleField } from '../fields/ToggleField';
import { SelectField } from '../fields/SelectField';
import { InlineFieldRenderer } from './InlineField';
import { TextField } from '../fields/TextField';
import { ListField } from '../fields/ListField';
import { CodeField } from '../fields/CodeField';
import { hasDescendant } from '../counts';
import { ConfigRow } from '../ConfigRow';
import { toKVPair } from '../fields/kv';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

function formatDefault(value: t.ConfigValue): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 37)}…` : value;
  return null;
}

export function SingleFieldRenderer({
  field,
  value,
  path,
  getValue,
  onChange,
  onResetField,
  onDiscardField,
  editedValues,
  disabled,
  permissions,
  onProfileChange,
  previewMode,
  previewScope,
  previewChangedPaths,
  resolvedValues,
  configuredPaths,
  dbOverridePaths,
  touchedPaths,
  pendingResets,
  schemaDefaults,
  showConfiguredOnly,
  isSoleField,
  secretPreviewValue,
  editSessionId,
}: t.SingleFieldRendererProps) {
  const localize = useLocalize();
  const controlType = getControlType(field);
  const description = field.description || undefined;
  const currentValue = getValue(path, value);
  const fieldId = path.replace(/\./g, '-');
  const fieldLabel = localize(`com_config_field_${field.key}`);
  const isConfigured = configuredPaths?.has(path);
  const isDbOverride = dbOverridePaths?.has(path);
  const isTouched = touchedPaths?.has(path);
  const isPendingReset = pendingResets?.has(path) ?? false;
  const hasPendingEdit = editedValues ? path in editedValues : false;
  const defaultHint = schemaDefaults ? formatDefault(schemaDefaults[path]) : null;

  if (showConfiguredOnly && !isConfigured && !hasDescendant(path, configuredPaths)) return null;

  const rowProps = {
    fieldPath: path,
    permissions,
    onProfileChange,
    onResetField,
    previewMode,
    previewScope,
    previewChangedPaths,
    resolvedValues,
    isConfigured,
    isDbOverride,
    isTouched,
    isPendingReset,
    defaultHint,
  };

  if (controlType === 'toggle') {
    const control = disabled ? (
      <BooleanChip value={Boolean(currentValue)} />
    ) : (
      <ToggleField
        id={fieldId}
        checked={Boolean(currentValue)}
        onChange={(checked) => onChange(path, checked)}
        aria-label={fieldLabel}
      />
    );
    if (isSoleField) return control;
    return (
      <ConfigRow
        title={fieldLabel}
        description={description}
        disabled={disabled}
        fieldId={fieldId}
        {...rowProps}
      >
        {control}
      </ConfigRow>
    );
  }

  if (controlType === 'select') {
    const options = getEnumOptions(field.type);
    const control = (
      <SelectField
        id={fieldId}
        value={currentValue == null ? '' : String(currentValue)}
        options={options}
        onChange={(v) => onChange(path, coerceEnumValue(v))}
        disabled={disabled}
        aria-label={fieldLabel}
      />
    );
    if (isSoleField) return control;
    return (
      <ConfigRow
        title={fieldLabel}
        description={description}
        disabled={disabled}
        fieldId={fieldId}
        {...rowProps}
      >
        {control}
      </ConfigRow>
    );
  }

  if (controlType === 'number') {
    const control = (
      <NumberField
        id={fieldId}
        value={typeof currentValue === 'number' ? currentValue : undefined}
        onChange={(v) => onChange(path, v)}
        disabled={disabled}
      />
    );
    if (isSoleField) return control;
    return (
      <ConfigRow
        title={fieldLabel}
        description={description}
        disabled={disabled}
        fieldId={fieldId}
        {...rowProps}
      >
        {control}
      </ConfigRow>
    );
  }

  if (controlType === 'array-object') {
    return (
      <ArrayObjectNestedGroup
        fieldId={fieldId}
        fieldLabel={fieldLabel}
        path={path}
        currentValue={currentValue}
        field={field}
        onChange={onChange}
        disabled={disabled}
        isSoleField={isSoleField}
        editSessionId={editSessionId}
      />
    );
  }

  if (controlType === 'record-object') {
    const entries =
      currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
        ? Object.keys(currentValue as Record<string, t.ConfigValue>)
        : [];
    return (
      <RecordObjectNestedGroup
        fieldId={fieldId}
        fieldLabel={fieldLabel}
        path={path}
        currentValue={currentValue}
        field={field}
        entries={entries}
        onChange={onChange}
        disabled={disabled}
        isSoleField={isSoleField}
        editSessionId={editSessionId}
      />
    );
  }

  if (controlType === 'array') {
    const arrayValue = Array.isArray(currentValue) ? currentValue : [];
    const itemType = getArrayItemType(field.type);

    if (isStringLikeItemType(itemType)) {
      return (
        <ConfigRow
          title={fieldLabel}
          description={description}
          disabled={disabled}
          fieldId={fieldId}
          {...rowProps}
        >
          <ListField
            id={fieldId}
            values={arrayValue.map(String)}
            onChange={(v) => onChange(path, v)}
            itemLabel={localize(`com_config_field_${field.key}_item`)}
            disabled={disabled}
            options={itemType.startsWith('enum(') ? getEnumOptions(itemType) : undefined}
            aria-label={fieldLabel}
          />
        </ConfigRow>
      );
    }

    return (
      <ConfigRow
        title={fieldLabel}
        description={description}
        disabled={disabled}
        fieldId={fieldId}
        {...rowProps}
      >
        <CodeField
          id={fieldId}
          value={currentValue}
          onChange={(v) => onChange(path, v)}
          disabled={disabled}
        />
      </ConfigRow>
    );
  }

  if (controlType === 'text') {
    const stringValue = typeof currentValue === 'string' ? currentValue : '';
    const baselineEmpty = typeof value !== 'string' || value === '';
    const maskedSecret =
      secretPreviewValue != null && baselineEmpty && !isPendingReset ? secretPreviewValue : null;

    if (maskedSecret != null) {
      const control = (
        <SecretField
          key={`${fieldId}-${editSessionId ?? 0}`}
          id={fieldId}
          value={stringValue}
          maskedValue={maskedSecret}
          onChange={(v) => onChange(path, v)}
          onCancel={() => onDiscardField?.(path)}
          hasPendingEdit={hasPendingEdit}
          disabled={disabled}
          aria-label={fieldLabel}
        />
      );
      if (isSoleField) return control;
      return (
        <ConfigRow
          title={fieldLabel}
          description={description}
          disabled={disabled}
          fieldId={fieldId}
          {...rowProps}
        >
          {control}
        </ConfigRow>
      );
    }

    const isMultiline = stringValue.includes('\n') || field.key.toLowerCase().includes('content');

    if (isMultiline) {
      const control = (
        <TextareaField
          id={fieldId}
          value={stringValue}
          onChange={(v) => onChange(path, v)}
          rows={5}
          disabled={disabled}
        />
      );
      if (isSoleField) return control;
      return (
        <ConfigRow
          title={fieldLabel}
          description={description}
          disabled={disabled}
          fieldId={fieldId}
          {...rowProps}
        >
          {control}
        </ConfigRow>
      );
    }

    const control = (
      <TextField
        id={fieldId}
        value={stringValue}
        onChange={(v) => onChange(path, v)}
        type="text"
        disabled={disabled}
      />
    );
    if (isSoleField) return control;
    return (
      <ConfigRow
        title={fieldLabel}
        description={description}
        disabled={disabled}
        fieldId={fieldId}
        {...rowProps}
      >
        {control}
      </ConfigRow>
    );
  }

  if (controlType === 'record') {
    const isEditedPairs = Array.isArray(currentValue);
    const pairs: t.KeyValuePair[] = isEditedPairs
      ? (currentValue as t.KeyValuePair[])
      : Object.entries(
          typeof currentValue === 'object' && currentValue !== null
            ? (currentValue as Record<string, t.ConfigValue>)
            : {},
        ).map(([k, v]) => toKVPair(k, v));

    return (
      <ConfigRow
        title={fieldLabel}
        description={description}
        disabled={disabled}
        fieldId={fieldId}
        {...rowProps}
      >
        <KeyValueField
          id={fieldId}
          pairs={pairs}
          onChange={(newPairs) => onChange(path, newPairs)}
          disabled={disabled}
          valueTypes={field.recordValueKVTypes}
          aria-label={fieldLabel}
        />
      </ConfigRow>
    );
  }

  if (controlType === 'switch-object') {
    const isObj =
      typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue);
    const isEnabled = isObj || currentValue === true;
    const subFields = field.children ?? [];
    const control = (
      <SwitchObjectField
        id={fieldId}
        value={currentValue}
        onChange={(v) => onChange(path, v)}
        disabled={disabled}
        aria-label={fieldLabel}
      >
        {isEnabled && subFields.length > 0 && (
          <InlineFieldRenderer
            fields={subFields}
            parentValue={isObj ? currentValue : {}}
            parentPath={path}
            onChange={onChange}
            disabled={disabled}
          />
        )}
      </SwitchObjectField>
    );
    if (isSoleField) return control;
    return (
      <ConfigRow
        title={fieldLabel}
        description={description}
        disabled={disabled}
        fieldId={fieldId}
        {...rowProps}
      >
        {control}
      </ConfigRow>
    );
  }

  if (controlType === 'text-record') {
    const types = splitUnionTypes(field.type);
    const variant = types.some((u) => u.startsWith('array')) ? 'array' : 'record';
    const control = (
      <TextRecordField
        id={fieldId}
        value={currentValue}
        onChange={(v) => onChange(path, v)}
        disabled={disabled}
        variant={variant as 'record' | 'array'}
        aria-label={fieldLabel}
      />
    );
    if (isSoleField) return control;
    return (
      <ConfigRow
        title={fieldLabel}
        description={description}
        disabled={disabled}
        fieldId={fieldId}
        {...rowProps}
      >
        {control}
      </ConfigRow>
    );
  }

  if (controlType === 'list-record') {
    const control = (
      <ListRecordField
        id={fieldId}
        value={currentValue}
        onChange={(v) => onChange(path, v)}
        disabled={disabled}
        aria-label={fieldLabel}
      />
    );
    if (isSoleField) return control;
    return (
      <ConfigRow
        title={fieldLabel}
        description={description}
        disabled={disabled}
        fieldId={fieldId}
        {...rowProps}
      >
        {control}
      </ConfigRow>
    );
  }

  return (
    <ConfigRow
      title={fieldLabel}
      description={description}
      disabled={disabled}
      fieldId={fieldId}
      {...rowProps}
    >
      <CodeField
        id={fieldId}
        value={currentValue}
        onChange={(v) => onChange(path, v)}
        disabled={disabled}
      />
    </ConfigRow>
  );
}

function BooleanChip({ value }: { value: boolean }) {
  const localize = useLocalize();
  return (
    <span
      className={cn('boolean-chip self-start', value ? 'boolean-chip-true' : 'boolean-chip-false')}
      aria-label={localize(value ? 'com_ui_true' : 'com_ui_false')}
    >
      {localize(value ? 'com_ui_true' : 'com_ui_false')}
    </span>
  );
}
