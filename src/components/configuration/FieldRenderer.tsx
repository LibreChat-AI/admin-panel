import { Icon } from '@clickhouse/click-ui';
import { Fragment, useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  coerceEnumValue,
  controlSortKey,
  countConfigured,
  getArrayItemType,
  getControlType,
  getEnumOptions,
  hasDescendant,
  hasPathOverlap,
  toKVPair,
  isStringLikeItemType,
  splitUnionTypes,
} from './utils';
import { SECRET_CONFIG_KEYS, isYamlManagedPath } from '@/constants';
import { cn, getSecretPreviewValue, MASKED_SECRET } from '@/utils';
import { useCollapsibleSection } from './useCollapsibleSection';
import { SwitchObjectField } from './fields/SwitchObjectField';
import { RecordObjectField } from './fields/RecordObjectField';
import { ArrayObjectField } from './fields/ArrayObjectField';
import { TextRecordField } from './fields/TextRecordField';
import { ListRecordField } from './fields/ListRecordField';
import { renderCollapsible } from './renderCollapsible';
import { TextareaField } from './fields/TextareaField';
import { KeyValueField } from './fields/KeyValueField';
import { UnknownSettings } from './UnknownSettings';
import { NumberField } from './fields/NumberField';
import { SecretField } from './fields/SecretField';
import { ToggleField } from './fields/ToggleField';
import { SelectField } from './fields/SelectField';
import { ManagedNotice } from './ManagedNotice';
import { TextField } from './fields/TextField';
import { ListField } from './fields/ListField';
import { CodeField } from './fields/CodeField';
import { ConfigRow } from './ConfigRow';
import { useLocalize } from '@/hooks';

function formatDefault(value: t.ConfigValue): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 37)}…` : value;
  return null;
}

/** Wrapper that wires a NestedGroup header "+ Add entry" button to
 *  ArrayObjectField's add handler via a ref. */
function ArrayObjectNestedGroup({
  fieldId,
  fieldLabel,
  path,
  currentValue,
  field,
  onChange,
  disabled,
  isSoleField,
  editSessionId,
}: {
  fieldId: string;
  fieldLabel: string;
  path: string;
  currentValue: t.ConfigValue;
  field: t.SchemaField;
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  isSoleField?: boolean;
  editSessionId?: number;
}) {
  const items = Array.isArray(currentValue) ? currentValue : [];
  const addTriggerRef = useRef<(() => void) | null>(null);
  const handleAdd = disabled ? undefined : () => addTriggerRef.current?.();

  const handleEntryChange = useCallback(
    (index: number, value: t.ConfigValue) => onChange(`${path}.${index}`, value),
    [onChange, path],
  );

  const arrayField = (
    <ArrayObjectField
      id={fieldId}
      value={currentValue}
      fields={field.children ?? []}
      onChange={(v) => onChange(path, v)}
      onEntryChange={handleEntryChange}
      disabled={disabled}
      hideAddButton
      addTriggerRef={addTriggerRef}
      renderFields={renderCollectionEntryFields}
      editSessionId={editSessionId}
    />
  );
  if (isSoleField) return arrayField;
  return (
    <NestedGroup
      label={fieldLabel}
      sectionId={`section-${path}`}
      configuredCount={items.length}
      totalCount={items.length}
      depth={field.depth}
      onAdd={handleAdd}
      disabled={disabled}
    >
      {arrayField}
    </NestedGroup>
  );
}

/** Wrapper that wires a NestedGroup header "+ Add entry" button to
 *  RecordObjectField's add-key input via a ref. */
function RecordObjectNestedGroup({
  fieldId,
  fieldLabel,
  path,
  currentValue,
  field,
  entries,
  onChange,
  disabled,
  isSoleField,
  editSessionId,
}: {
  fieldId: string;
  fieldLabel: string;
  path: string;
  currentValue: t.ConfigValue;
  field: t.SchemaField;
  entries: string[];
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  isSoleField?: boolean;
  editSessionId?: number;
}) {
  const addTriggerRef = useRef<(() => void) | null>(null);
  const handleAdd = disabled ? undefined : () => addTriggerRef.current?.();

  const recordField = (
    <RecordObjectField
      id={fieldId}
      value={currentValue}
      fields={field.children ?? []}
      onChange={(v) => onChange(path, v)}
      disabled={disabled}
      allowPrimitiveValues={field.recordValueAllowsPrimitive}
      addTriggerRef={addTriggerRef}
      renderFields={renderCollectionEntryFields}
      editSessionId={editSessionId}
    />
  );
  if (isSoleField) return recordField;
  return (
    <NestedGroup
      label={fieldLabel}
      sectionId={`section-${path}`}
      configuredCount={entries.length}
      totalCount={entries.length}
      depth={field.depth}
      onAdd={handleAdd}
      disabled={disabled}
    >
      {recordField}
    </NestedGroup>
  );
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

export function NestedGroup({
  label,
  sectionId,
  configuredCount = 0,
  totalCount = 0,
  depth = 0,
  onAdd,
  addLabel,
  disabled,
  children,
}: {
  label: string;
  sectionId?: string;
  configuredCount?: number;
  totalCount?: number;
  depth?: number;
  /** When provided, renders a "+ Add" button inline in the header. */
  onAdd?: () => void;
  addLabel?: string;
  /**
   * When true, the caret/collapse affordance is dropped and the group renders
   * flat with a static heading. Used in fully read-only sections where the
   * expand/collapse interaction would be misleading.
   */
  disabled?: boolean;
  children: ReactNode;
}) {
  const localize = useLocalize();
  const hasConfigured = configuredCount > 0;
  const indent = depth > 0 ? `${depth}rem` : undefined;

  const { isExpanded, hasEverExpanded, sectionRef, toggle, handleAddClick } = useCollapsibleSection(
    { defaultExpanded: hasConfigured, onAdd },
  );

  if (disabled) {
    return (
      <section
        ref={sectionRef}
        id={sectionId}
        aria-label={label}
        className={cn(depth > 0 ? 'mt-3' : 'mt-4', 'flex flex-col')}
        style={indent ? { paddingLeft: indent } : undefined}
      >
        <div
          data-section-id={sectionId}
          className="flex items-center gap-2 border-b border-(--cui-color-stroke-default) py-2 pl-1"
        >
          <span className="text-sm font-medium text-(--cui-color-text-default)">{label}</span>
          {totalCount > 0 && (
            <span
              className={cn(
                'config-count-badge',
                hasConfigured ? 'config-count-badge-active' : 'config-count-badge-muted',
              )}
            >
              {configuredCount}/{totalCount}
            </span>
          )}
        </div>
        {children}
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      id={sectionId}
      aria-label={label}
      className={cn(depth > 0 ? 'mt-3' : 'mt-4', 'flex flex-col')}
      style={indent ? { paddingLeft: indent } : undefined}
    >
      <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default)">
        <button
          type="button"
          aria-expanded={isExpanded}
          data-section-id={sectionId}
          onClick={toggle}
          className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border-none bg-transparent py-2 pr-0 pl-1 transition-colors outline-none select-none hover:bg-(--cui-color-background-hover) focus-visible:bg-(--cui-color-background-hover)"
        >
          <span
            className={cn(
              'flex shrink-0 items-center justify-center transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          >
            <Icon name="chevron-right" size="xs" />
          </span>
          <span className="text-sm font-medium text-(--cui-color-text-default)">{label}</span>
          {totalCount > 0 && (
            <span
              className={cn(
                'config-count-badge',
                hasConfigured ? 'config-count-badge-active' : 'config-count-badge-muted',
              )}
            >
              {configuredCount}/{totalCount}
            </span>
          )}
        </button>
        {onAdd && (
          <button type="button" onClick={handleAddClick} className="config-add-btn">
            <Icon name="plus" size="sm" />
            <span>
              {addLabel ?? localize('com_ui_add_item', { item: localize('com_ui_entry') })}
            </span>
          </button>
        )}
      </div>
      {renderCollapsible(isExpanded, hasEverExpanded, children)}
    </section>
  );
}

function CollectionRow({
  title,
  description,
  fieldId,
  children,
}: {
  title: string;
  description?: string;
  fieldId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      <div>
        <label htmlFor={fieldId} className="text-sm font-medium text-(--cui-color-text-default)">
          {title}
        </label>
        {description && <p className="text-xs text-(--cui-color-text-muted)">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function renderCollectionEntryFields(
  fields: t.SchemaField[],
  parentValue: t.ConfigValue,
  parentPath: string,
  onChange: (path: string, value: t.ConfigValue) => void,
  addFieldTriggerRef?: React.MutableRefObject<(() => void) | null>,
  editSessionId?: number,
  disabled?: boolean,
): ReactNode {
  return (
    <InlineFieldRenderer
      fields={fields}
      parentValue={parentValue}
      parentPath={parentPath}
      onChange={onChange}
      disabled={disabled}
      addFieldTriggerRef={addFieldTriggerRef}
      editSessionId={editSessionId}
    />
  );
}

/**
 * Lightweight field renderer for collection entry cards.
 * Renders fields without the full config-page context (no profiles, no preview, no configured tracking).
 * Changes propagate up through the collection's onChange, which stores the entire collection value.
 */
function hasValue(v: t.ConfigValue): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v !== '';
  if (typeof v === 'boolean' || typeof v === 'number') return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

function InlineFieldRenderer({
  fields,
  parentValue,
  parentPath,
  onChange,
  disabled,
  addFieldTriggerRef,
  onHiddenFieldsChange,
  editSessionId,
}: {
  fields: t.SchemaField[];
  parentValue: t.ConfigValue;
  parentPath: string;
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  addFieldTriggerRef?: React.MutableRefObject<(() => void) | null>;
  onHiddenFieldsChange?: (hasHidden: boolean) => void;
  editSessionId?: number;
}) {
  const localize = useLocalize();
  const [addedKeys, setAddedKeys] = useState<Set<string>>(() => new Set());
  const [showDropdown, setShowDropdown] = useState(false);
  const values =
    typeof parentValue === 'object' && parentValue !== null && !Array.isArray(parentValue)
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};

  // Derive the parent collection key from the schema field paths when available.
  // For array-object entries (e.g. endpoints.custom[*]), the first field's path
  // is like "endpoints.custom.name" — extract "custom" as the collection key.
  // Falls back to the last segment of parentPath.
  const parentKey = parentPath.split('.').pop() ?? '';
  const schemaParentKey = fields[0]?.path ? fields[0].path.split('.').slice(-2, -1)[0] : undefined;
  const lookupKey =
    schemaParentKey &&
    (PROGRESSIVE_DISCLOSURE_PATHS.has(schemaParentKey) || FIELD_ORDER[schemaParentKey])
      ? schemaParentKey
      : parentKey;
  const useProgressiveDisclosure = PROGRESSIVE_DISCLOSURE_PATHS.has(lookupKey);
  const order = FIELD_ORDER[lookupKey];

  // Apply field ordering: pinned fields first (in order), then remaining in schema order
  const orderedFields = order
    ? [
        ...order
          .map((k) => fields.find((f) => f.key === k))
          .filter((f): f is t.SchemaField => f != null),
        ...fields.filter((f) => !order.includes(f.key)),
      ]
    : fields;

  // Pinned fields are always visible even under progressive disclosure
  const pinnedKeys = order ? new Set(order) : null;
  const visibleFields = useProgressiveDisclosure
    ? orderedFields.filter(
        (f) => pinnedKeys?.has(f.key) || hasValue(values[f.key]) || addedKeys.has(f.key),
      )
    : orderedFields;
  const hiddenFields = useProgressiveDisclosure
    ? orderedFields.filter(
        (f) => !pinnedKeys?.has(f.key) && !hasValue(values[f.key]) && !addedKeys.has(f.key),
      )
    : [];

  const handleAddField = (key: string) => {
    setAddedKeys((prev) => new Set(prev).add(key));
    setShowDropdown(false);
    // Focus the newly visible field after render
    requestAnimationFrame(() => {
      const fieldId = `${parentPath}-${key}`.replace(/\./g, '-');
      const el = document.getElementById(fieldId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const focusable = el.querySelector<HTMLElement>('input, select, textarea, [role="switch"]');
        if (focusable) setTimeout(() => focusable.focus(), 150);
      }
    });
  };

  // Register the add-field trigger with parent ObjectEntryCard
  useEffect(() => {
    if (addFieldTriggerRef && hiddenFields.length > 0) {
      addFieldTriggerRef.current = () => setShowDropdown(true);
      return () => {
        addFieldTriggerRef.current = null;
      };
    } else if (addFieldTriggerRef) {
      addFieldTriggerRef.current = null;
    }
  }, [addFieldTriggerRef, hiddenFields.length]);

  // Notify parent about hidden fields availability (for NestedGroup header button)
  useEffect(() => {
    onHiddenFieldsChange?.(hiddenFields.length > 0);
  }, [hiddenFields.length, onHiddenFieldsChange]);

  return (
    <div className="flex flex-col gap-3">
      {visibleFields.map((field) =>
        renderInlineField(
          field,
          parentValue,
          parentPath,
          onChange,
          localize,
          disabled,
          undefined,
          undefined,
          editSessionId,
        ),
      )}
      {!disabled && hiddenFields.length > 0 && showDropdown && (
        <AddFieldDropdown
          fields={hiddenFields}
          onAdd={handleAddField}
          onCancel={() => setShowDropdown(false)}
        />
      )}
      {!disabled && hiddenFields.length > 0 && !showDropdown && !addFieldTriggerRef && (
        <button
          type="button"
          onClick={() => setShowDropdown(true)}
          className="config-add-btn self-start"
        >
          <Icon name="plus" size="sm" />
          {localize('com_config_add_field')}
        </button>
      )}
    </div>
  );
}

/** Wraps a NestedGroup + InlineFieldRenderer, wiring the add-field trigger to the group header. */
function NestedGroupWithAddField({
  label,
  fields,
  parentValue,
  parentPath,
  onChange,
  disabled,
  editSessionId,
}: {
  label: string;
  fields: t.SchemaField[];
  parentValue: t.ConfigValue;
  parentPath: string;
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  editSessionId?: number;
}) {
  const addFieldRef = useRef<(() => void) | null>(null);
  const localize = useLocalize();

  // Static initial value: compute from schema + values so the button shows
  // before children mount (NestedGroup defers rendering when collapsed).
  const parentKey = parentPath.split('.').pop() ?? '';
  const usesPD = PROGRESSIVE_DISCLOSURE_PATHS.has(parentKey);
  const pinnedOrder = FIELD_ORDER[parentKey];
  const pinnedSet = pinnedOrder ? new Set(pinnedOrder) : null;
  const values =
    typeof parentValue === 'object' && parentValue !== null && !Array.isArray(parentValue)
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};
  const initialHasHideable =
    usesPD && fields.some((f) => !pinnedSet?.has(f.key) && !hasValue(values[f.key]));

  // Reactive: child InlineFieldRenderer reports actual hidden field count
  // (accounts for addedKeys state that the static check can't see).
  const [hasHideable, setHasHideable] = useState(initialHasHideable);

  return (
    <NestedGroup
      label={label}
      onAdd={!disabled && hasHideable ? () => addFieldRef.current?.() : undefined}
      addLabel={localize('com_config_add_field')}
      disabled={disabled}
    >
      <InlineFieldRenderer
        fields={fields}
        parentValue={parentValue}
        parentPath={parentPath}
        onChange={onChange}
        disabled={disabled}
        addFieldTriggerRef={addFieldRef}
        onHiddenFieldsChange={setHasHideable}
        editSessionId={editSessionId}
      />
    </NestedGroup>
  );
}

function AddFieldDropdown({
  fields,
  onAdd,
  onCancel,
}: {
  fields: t.SchemaField[];
  onAdd: (key: string) => void;
  onCancel?: () => void;
}) {
  const localize = useLocalize();

  return (
    <div className="flex items-center gap-2">
      <select
        className="config-input max-w-60 text-sm"
        autoFocus
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
        }}
        onBlur={() => onCancel?.()}
      >
        <option value="" disabled>
          {localize('com_config_select_field')}
        </option>
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {localize(`com_config_field_${f.key}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Renders a single schema field as an inline label + control row.
 * Exported so custom collection renderers (e.g. grouped endpoint fields)
 * can render individual fields without going through InlineFieldRenderer's
 * progressive disclosure / ordering logic.
 */
export function renderInlineField(
  field: t.SchemaField,
  parentValue: t.ConfigValue,
  parentPath: string,
  onChange: (path: string, value: t.ConfigValue) => void,
  localize: (key: string, interpolation?: Record<string, string | number>) => string,
  disabled?: boolean,
  /** Optional per-field-key overrides for array-object / record-object renderFields. */
  collectionRenderOverrides?: Record<string, t.CollectionRenderFields>,
  /** When true, non-optional fields show a required indicator (*). */
  showRequired?: boolean,
  /** See `SingleFieldRendererProps.editSessionId`. */
  editSessionId?: number,
): ReactNode {
  const values =
    typeof parentValue === 'object' && parentValue !== null && !Array.isArray(parentValue)
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};
  const fieldValue = values[field.key];
  const controlType = getControlType(field);
  const fieldId = `${parentPath}-${field.key}`.replace(/\./g, '-');
  const fieldLabel = localize(`com_config_field_${field.key}`);
  const required = showRequired && !field.isOptional;

  if (field.children && field.children.length > 0 && !field.isArray && field.type !== 'record') {
    return (
      <NestedGroupWithAddField
        key={field.key}
        label={fieldLabel}
        fields={field.children}
        parentValue={fieldValue}
        parentPath={`${parentPath}.${field.key}`}
        onChange={(p, v) => {
          const segments = p.split('.');
          const leafKey = segments[segments.length - 1];
          const current =
            typeof fieldValue === 'object' && fieldValue !== null && !Array.isArray(fieldValue)
              ? (fieldValue as Record<string, t.ConfigValue>)
              : {};
          onChange(field.key, { ...current, [leafKey]: v });
        }}
        disabled={disabled}
        editSessionId={editSessionId}
      />
    );
  }

  if (controlType === 'toggle') {
    return (
      <InlineRow key={field.key} label={fieldLabel} fieldId={fieldId} required={required}>
        <ToggleField
          id={fieldId}
          checked={Boolean(fieldValue)}
          onChange={(checked) => onChange(field.key, checked)}
          disabled={disabled}
          aria-label={fieldLabel}
        />
      </InlineRow>
    );
  }

  if (controlType === 'select') {
    const options = getEnumOptions(field.type);
    return (
      <InlineRow key={field.key} label={fieldLabel} fieldId={fieldId} required={required}>
        <SelectField
          id={fieldId}
          value={fieldValue == null ? '' : String(fieldValue)}
          options={options}
          onChange={(v) => onChange(field.key, coerceEnumValue(v))}
          disabled={disabled}
          aria-label={fieldLabel}
        />
      </InlineRow>
    );
  }

  if (controlType === 'number') {
    return (
      <InlineRow key={field.key} label={fieldLabel} fieldId={fieldId} required={required}>
        <NumberField
          id={fieldId}
          value={typeof fieldValue === 'number' ? fieldValue : undefined}
          onChange={(v) => onChange(field.key, v)}
          disabled={disabled}
        />
      </InlineRow>
    );
  }

  if (controlType === 'text') {
    // A defined string (including '') means this field has a queued edit for
    // this entry; an absent/undefined value means it still matches baseline.
    // Distinguishing on the raw value (not just whether it's empty) keeps a
    // queued empty replacement visible across a remount, matching the
    // top-level SingleFieldRenderer fix.
    const hasPendingEdit = typeof fieldValue === 'string';
    const stringValue = hasPendingEdit ? fieldValue : '';
    if (disabled && stringValue !== '' && SECRET_CONFIG_KEYS.has(field.key)) {
      return (
        <InlineRow key={field.key} label={fieldLabel} fieldId={fieldId} required={required}>
          <TextField id={fieldId} value={MASKED_SECRET} onChange={() => undefined} disabled />
        </InlineRow>
      );
    }
    const secretPreviewValue = getSecretPreviewValue(values, field.key);
    const maskedSecret =
      secretPreviewValue != null && stringValue === '' ? secretPreviewValue : null;

    if (maskedSecret != null) {
      return (
        <InlineRow key={field.key} label={fieldLabel} fieldId={fieldId} required={required}>
          <SecretField
            key={`${fieldId}-${editSessionId ?? 0}`}
            id={fieldId}
            value={stringValue}
            maskedValue={maskedSecret}
            onChange={(v) => onChange(field.key, v)}
            onCancel={() => {
              if (hasPendingEdit) onChange(field.key, undefined);
            }}
            hasPendingEdit={hasPendingEdit}
            disabled={disabled}
            aria-label={fieldLabel}
          />
        </InlineRow>
      );
    }

    return (
      <InlineRow key={field.key} label={fieldLabel} fieldId={fieldId} required={required}>
        <TextField
          id={fieldId}
          value={stringValue}
          onChange={(v) => onChange(field.key, v)}
          disabled={disabled}
        />
      </InlineRow>
    );
  }

  if (controlType === 'array') {
    const arrayValue = Array.isArray(fieldValue) ? fieldValue : [];
    const itemType = getArrayItemType(field.type);
    if (isStringLikeItemType(itemType)) {
      return (
        <InlineRow key={field.key} label={fieldLabel} fieldId={fieldId} required={required}>
          <ListField
            id={fieldId}
            values={arrayValue.map(String)}
            onChange={(v) => onChange(field.key, v)}
            disabled={disabled}
            options={itemType.startsWith('enum(') ? getEnumOptions(itemType) : undefined}
            aria-label={fieldLabel}
          />
        </InlineRow>
      );
    }
    return (
      <InlineRow key={field.key} label={fieldLabel} fieldId={fieldId} required={required}>
        <CodeField
          id={fieldId}
          value={fieldValue}
          onChange={(v) => onChange(field.key, v)}
          disabled={disabled}
        />
      </InlineRow>
    );
  }

  if (controlType === 'array-object') {
    const renderFn = collectionRenderOverrides?.[field.key] ?? renderCollectionEntryFields;
    return (
      <CollectionRow key={field.key} title={fieldLabel} fieldId={fieldId}>
        <ArrayObjectField
          id={fieldId}
          value={fieldValue}
          fields={field.children ?? []}
          onChange={(v) => onChange(field.key, v)}
          disabled={disabled}
          renderFields={renderFn}
          editSessionId={editSessionId}
        />
      </CollectionRow>
    );
  }

  if (controlType === 'record-object') {
    const renderFn = collectionRenderOverrides?.[field.key] ?? renderCollectionEntryFields;
    return (
      <CollectionRow key={field.key} title={fieldLabel} fieldId={fieldId}>
        <RecordObjectField
          id={fieldId}
          value={fieldValue}
          fields={field.children ?? []}
          onChange={(v) => onChange(field.key, v)}
          disabled={disabled}
          allowPrimitiveValues={field.recordValueAllowsPrimitive}
          renderFields={renderFn}
          editSessionId={editSessionId}
        />
      </CollectionRow>
    );
  }

  if (controlType === 'record') {
    const pairs: t.KeyValuePair[] = Array.isArray(fieldValue)
      ? (fieldValue as t.KeyValuePair[])
      : Object.entries(
          typeof fieldValue === 'object' && fieldValue !== null
            ? (fieldValue as Record<string, t.ConfigValue>)
            : {},
        ).map(([k, v]) => toKVPair(k, v));
    return (
      <InlineRow key={field.key} label={fieldLabel} fieldId={fieldId} required={required}>
        <KeyValueField
          id={fieldId}
          pairs={pairs}
          onChange={(p) => onChange(field.key, p)}
          disabled={disabled}
          valueTypes={field.recordValueKVTypes}
          aria-label={fieldLabel}
        />
      </InlineRow>
    );
  }

  return (
    <InlineRow key={field.key} label={fieldLabel} fieldId={fieldId} required={required}>
      <CodeField
        id={fieldId}
        value={fieldValue}
        onChange={(v) => onChange(field.key, v)}
        disabled={disabled}
      />
    </InlineRow>
  );
}

function InlineRow({
  label,
  fieldId,
  required,
  children,
}: {
  label: string;
  fieldId: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <label
        htmlFor={fieldId}
        className="shrink-0 text-sm font-medium text-(--cui-color-text-default) sm:w-35"
      >
        {label}
        {required && <span className="ml-0.5 text-(--cui-color-text-danger)">*</span>}
      </label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

/** Parent keys whose InlineFieldRenderer hides empty fields behind an "Add field"
 *  dropdown. Add new keys here when an object has too many optional fields to
 *  show by default (e.g. modelSpecs.list[].preset has 20+ fields). */
const PROGRESSIVE_DISCLOSURE_PATHS = new Set(['preset', 'custom']);

/** Optional field ordering for InlineFieldRenderer.  Fields listed here are
 *  placed first (in the given order) and are always visible even when
 *  progressive disclosure is active.  Unlisted fields follow in schema order
 *  and may be hidden behind "Add field" if progressive disclosure applies. */
const FIELD_ORDER: Record<string, string[]> = {
  custom: ['name', 'apiKey', 'baseURL', 'iconURL', 'models', 'modelDisplayLabel'],
};

const NO_PATHS: ReadonlySet<string> = new Set();

export function FieldRenderer({
  fields,
  parentValue,
  parentPath,
  getValue,
  onChange,
  onResetField,
  onDiscardField,
  editedValues,
  disabled,
  profileMap,
  previewMode,
  previewScope,
  previewChangedPaths,
  resolvedValues,
  permissions,
  onProfileChange,
  showChangedOnly,
  configuredPaths,
  dbOverridePaths,
  touchedPaths,
  pendingResets,
  schemaDefaults,
  showConfiguredOnly,
  editSessionId,
}: t.FieldRendererProps) {
  const localize = useLocalize();
  const values =
    typeof parentValue === 'object' && parentValue !== null
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};

  const filtering = showChangedOnly && previewMode && previewChangedPaths;
  const isPathChanged = (p: string) =>
    previewChangedPaths?.some((op) => op === p || op.startsWith(`${p}.`)) ?? false;

  const sorted = [...fields].sort((a, b) => controlSortKey(a) - controlSortKey(b));

  const groups: Array<
    | { type: 'single'; field: t.SchemaField; value: t.ConfigValue; path: string }
    | { type: 'nested'; field: t.SchemaField; value: t.ConfigValue; path: string }
  > = [];

  for (const field of sorted) {
    const value = values[field.key];
    const path = `${parentPath}.${field.key}`;

    if (filtering && !isPathChanged(path)) continue;

    if (showConfiguredOnly && !previewMode) {
      const isLeafConfigured = configuredPaths?.has(path);
      if (!isLeafConfigured && !hasDescendant(path, configuredPaths)) continue;
    }

    if (field.children && field.children.length > 0 && !field.isArray && field.type !== 'record') {
      groups.push({ type: 'nested', field, value, path });
    } else {
      groups.push({ type: 'single', field, value, path });
    }
  }

  const managedNotice = (path: string): ReactNode => (
    <ManagedNotice
      hasOverride={hasPathOverlap(path, dbOverridePaths ?? NO_PATHS)}
      pendingRemoval={pendingResets?.has(path) ?? false}
      onRemoveOverride={disabled || !onResetField ? undefined : () => onResetField(path)}
    />
  );

  return (
    <>
      {groups.map((group) => {
        const managed = isYamlManagedPath(group.path);
        const groupDisabled = disabled || managed;
        if (group.type === 'nested') {
          const nestedValue =
            typeof group.value === 'object' && group.value !== null ? group.value : {};
          const nestedLabel = localize(`com_config_field_${group.field.key}`);
          const nestedCounts = countConfigured(group.field.children!, group.path, configuredPaths);
          return (
            <NestedGroup
              key={group.field.path}
              label={nestedLabel}
              sectionId={`section-${group.path}`}
              configuredCount={nestedCounts.configured}
              totalCount={nestedCounts.total}
              depth={group.field.depth}
              disabled={groupDisabled}
            >
              {managed && managedNotice(group.path)}
              <FieldRenderer
                fields={group.field.children!}
                parentValue={nestedValue}
                parentPath={group.path}
                getValue={getValue}
                onChange={onChange}
                onResetField={onResetField}
                onDiscardField={onDiscardField}
                editedValues={editedValues}
                disabled={groupDisabled}
                profileMap={profileMap}
                previewMode={previewMode}
                previewScope={previewScope}
                previewChangedPaths={previewChangedPaths}
                resolvedValues={resolvedValues}
                permissions={permissions}
                onProfileChange={onProfileChange}
                showChangedOnly={showChangedOnly}
                configuredPaths={configuredPaths}
                dbOverridePaths={dbOverridePaths}
                touchedPaths={touchedPaths}
                pendingResets={pendingResets}
                schemaDefaults={schemaDefaults}
                showConfiguredOnly={showConfiguredOnly}
                editSessionId={editSessionId}
              />
              <UnknownSettings
                fields={group.field.children!}
                value={nestedValue}
                path={group.path}
              />
            </NestedGroup>
          );
        }

        return (
          <Fragment key={group.field.path}>
            {managed && managedNotice(group.path)}
            <SingleFieldRenderer
              field={group.field}
              value={group.value}
              path={group.path}
              getValue={getValue}
              onChange={onChange}
              onResetField={onResetField}
              onDiscardField={onDiscardField}
              editedValues={editedValues}
              disabled={groupDisabled}
              permissions={permissions}
              onProfileChange={onProfileChange}
              previewMode={previewMode}
              previewScope={previewScope}
              previewChangedPaths={previewChangedPaths}
              resolvedValues={resolvedValues}
              configuredPaths={configuredPaths}
              dbOverridePaths={dbOverridePaths}
              touchedPaths={touchedPaths}
              pendingResets={pendingResets}
              schemaDefaults={schemaDefaults}
              showConfiguredOnly={showConfiguredOnly}
              isSoleField={false}
              secretPreviewValue={getSecretPreviewValue(values, group.field.key)}
              editSessionId={editSessionId}
            />
          </Fragment>
        );
      })}
    </>
  );
}
