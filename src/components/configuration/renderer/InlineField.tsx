import { Icon } from '@clickhouse/click-ui';
import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  coerceEnumValue,
  getArrayItemType,
  getControlType,
  getEnumOptions,
  isStringLikeItemType,
} from '../controls';
import { RecordObjectField } from '../fields/RecordObjectField';
import { getSecretPreviewValue, MASKED_SECRET } from '@/utils';
import { ArrayObjectField } from '../fields/ArrayObjectField';
import { KeyValueField } from '../fields/KeyValueField';
import { NumberField } from '../fields/NumberField';
import { SecretField } from '../fields/SecretField';
import { ToggleField } from '../fields/ToggleField';
import { SelectField } from '../fields/SelectField';
import { SECRET_CONFIG_KEYS } from '@/constants';
import { TextField } from '../fields/TextField';
import { ListField } from '../fields/ListField';
import { CodeField } from '../fields/CodeField';
import { NestedGroup } from './NestedGroup';
import { toKVPair } from '../fields/kv';
import { useLocalize } from '@/hooks';

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

function hasValue(v: t.ConfigValue): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v !== '';
  if (typeof v === 'boolean' || typeof v === 'number') return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

/**
 * Lightweight field renderer for collection entry cards.
 * Renders fields without the full config-page context (no profiles, no preview, no configured tracking).
 * Changes propagate up through the collection's onChange, which stores the entire collection value.
 */
export function InlineFieldRenderer({
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
