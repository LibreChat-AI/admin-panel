import { Select } from '@clickhouse/click-ui';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  isRowVisible,
  isEnvReference,
  holdsFilterMatch,
  isConfigValueEqual,
  getSecretPreviewValue,
  MASKED_SECRET,
  asConfigRecord,
  hasConfigValue,
} from '@/utils';
import { lowerLayerKeys, lowerLayerValue, entryFieldDefault, layerValueBeneath } from './defaults';
import { EntryFieldChipsContext } from '@/contexts/EntryFieldChipsContext';
import { ConfiguredOnlyContext } from '@/contexts/ConfiguredOnlyContext';
import { fieldMetaFor, fieldVariants, resolveControl } from './kinds';
import { RevealTargetContext } from '@/contexts/RevealTargetContext';
import { useFieldState, useLocalize, useValuesScope, useRecordKeyRemoval } from '@/hooks';
import { RecordObjectField } from '../fields/RecordObjectField';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { ArrayObjectField } from '../fields/ArrayObjectField';
import { ShadowBadge, shadowedSourceLabel } from '../values';
import { BooleanChip, FieldControl } from './FieldControl';
import { maskedSecretLabel } from '../fields/SecretField';
import { TriStateField } from '../fields/TriStateField';
import { fieldDescription, toFieldId } from './paths';
import { VariantField } from '../fields/VariantField';
import { UnknownSettings } from '../UnknownSettings';
import { DecorativeIcon } from '@/components/shared';
import { getFieldMeta, labelForPath } from '../meta';
import { SECRET_CONFIG_KEYS } from '@/constants';
import { identityKeyFor } from '../review/diff';
import { SettingsRow } from '../SettingsRow';
import { NestedGroup } from './NestedGroup';
import { orderFields } from '../controls';

type EntryChange = (path: string, value: t.ConfigValue) => void;

function isPlainRecord(value: t.ConfigValue): value is t.ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** On/off reading of a `boolean | object` value: an object means enabled. */
function asEnabled(value: t.ConfigValue): boolean | undefined {
  if (value === true || isPlainRecord(value)) return true;
  return value === false ? false : undefined;
}

function lowerRecordKeys(value: t.ConfigValue): ReadonlySet<string> | undefined {
  return isPlainRecord(value) ? new Set(Object.keys(value)) : undefined;
}

/**
 * Entries of a nested list the layer beneath defines (a librechat.yaml
 * parameter definition): their fields can change, but they cannot be
 * deleted (D1/D3; LibreChat would bring them back), so they get no Delete.
 */
function lowerEntryLock(
  path: string,
  lowerList: t.ConfigValue,
  items: t.ConfigValue,
): ((item: t.ConfigValue) => boolean) | undefined {
  if (!Array.isArray(lowerList) || lowerList.length === 0) return undefined;
  const key = identityKeyFor(path, [...lowerList, ...(Array.isArray(items) ? items : [])]);
  if (!key) return undefined;
  const identityOf = (item: t.ConfigValue) => (isPlainRecord(item) ? item[key] : undefined);
  const lowerIds = new Set(lowerList.map(identityOf).filter((id) => typeof id === 'string'));
  return (item) => {
    const id = identityOf(item);
    return typeof id === 'string' && lowerIds.has(id);
  };
}

function isNestedObject(field: t.SchemaField): boolean {
  return Boolean(field.children?.length) && !field.isArray && field.type !== 'record';
}

/**
 * Key of the object that owns `fields`, taken from the schema path with
 * `[]`/`{}` markers stripped (`modelSpecs.list.[].preset.model` → `preset`),
 * never from an entry's display name.
 */
export function collectionKeyOf(fields: t.SchemaField[], parentPath: string): string {
  const schemaPath = fields[0]?.path;
  if (schemaPath) {
    const segments = schemaPath.split('.').slice(0, -1);
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i] !== '[]' && segments[i] !== '{}') return segments[i];
    }
  }
  return parentPath.split('.').pop() ?? '';
}

/** Focuses the control with `id`: the element itself when focusable, else its first focusable child. */
function focusControl(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  const selector = 'input, select, textarea, button, [role="switch"]';
  const target = el.matches(selector) ? el : el.querySelector<HTMLElement>(selector);
  target?.focus();
}

export function renderCollectionEntryFields(
  fields: t.SchemaField[],
  parentValue: t.ConfigValue,
  parentPath: string,
  onChange: EntryChange,
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
      showRequired
    />
  );
}

/**
 * Lightweight field renderer for collection entry cards: label + control rows
 * that write into the entry through `onChange(key, value)`. Parent keys in
 * `PROGRESSIVE_DISCLOSURE_PATHS` hide empty fields behind an "Add field"
 * picker; a field that had a value (or was added) stays visible for the rest
 * of the session even after it is cleared.
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
  showRequired,
  knownFields,
}: t.InlineFieldRendererProps) {
  const configuredOnly = useContext(ConfiguredOnlyContext);
  const rowFilter = useContext(RowFilterContext);
  const revealTarget = useContext(RevealTargetContext);
  const values = asConfigRecord(parentValue);
  const lookupKey = collectionKeyOf(fields, parentPath);
  const useProgressiveDisclosure = PROGRESSIVE_DISCLOSURE_PATHS.has(lookupKey);
  const order = FIELD_ORDER[lookupKey];
  const [shownKeys, setShownKeys] = useState<ReadonlySet<string>>(
    () => new Set(fields.filter((f) => hasConfigValue(values[f.key])).map((f) => f.key)),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const focusKeyRef = useRef<string | null>(null);

  /** Fields with a value, and the one a search result reveals, stay shown for the session. */
  const toShow = fields.filter(
    (f) =>
      !shownKeys.has(f.key) &&
      (hasConfigValue(values[f.key]) || isRevealing(revealTarget, `${parentPath}.${f.key}`)),
  );
  if (toShow.length > 0) {
    setShownKeys((prev) => new Set([...prev, ...toShow.map((f) => f.key)]));
  }

  const schemaOrder = orderFields(fields);
  const orderedFields = order
    ? [
        ...order
          .map((k) => fields.find((f) => f.key === k))
          .filter((f): f is t.SchemaField => f != null),
        ...schemaOrder.filter((f) => !order.includes(f.key)),
      ]
    : schemaOrder;
  const pinnedKeys = new Set(order ?? []);
  const isVisible = (f: t.SchemaField) =>
    !useProgressiveDisclosure ||
    pinnedKeys.has(f.key) ||
    shownKeys.has(f.key) ||
    hasConfigValue(values[f.key]) ||
    holdsFilterMatch(rowFilter, `${parentPath}.${f.key}`);
  const visibleFields = orderedFields.filter(
    (f) => isVisible(f) && (!configuredOnly || hasConfigValue(values[f.key])),
  );
  const hiddenFields = useProgressiveDisclosure
    ? orderedFields.filter(
        (f) => !isVisible(f) && !fieldMetaFor(f, `${parentPath}.${f.key}`)?.hidden,
      )
    : [];

  useEffect(() => {
    const key = focusKeyRef.current;
    if (!key) return;
    focusKeyRef.current = null;
    requestAnimationFrame(() => focusControl(toFieldId(`${parentPath}.${key}`)));
  });

  const handleAddField = (key: string) => {
    setShownKeys((prev) => new Set(prev).add(key));
    setPickerOpen(false);
    focusKeyRef.current = key;
  };

  useEffect(() => {
    if (!addFieldTriggerRef) return;
    if (hiddenFields.length === 0) {
      addFieldTriggerRef.current = null;
      return;
    }
    addFieldTriggerRef.current = () => setPickerOpen(true);
    return () => {
      addFieldTriggerRef.current = null;
    };
  }, [addFieldTriggerRef, hiddenFields.length]);

  useEffect(() => {
    onHiddenFieldsChange?.(hiddenFields.length > 0);
  }, [hiddenFields.length, onHiddenFieldsChange]);

  return (
    <div className="flex flex-col gap-1">
      {visibleFields.map((field) => (
        <InlineField
          key={field.key}
          field={field}
          parentValue={parentValue}
          parentPath={parentPath}
          onChange={onChange}
          disabled={disabled}
          showRequired={showRequired}
          editSessionId={editSessionId}
        />
      ))}
      {!disabled && hiddenFields.length > 0 && (pickerOpen || !addFieldTriggerRef) && (
        <AddFieldPicker
          key={hiddenFields.length}
          fields={hiddenFields}
          parentPath={parentPath}
          lookupKey={lookupKey}
          autoOpen={pickerOpen}
          onAdd={handleAddField}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {!rowFilter && (
        <UnknownSettings fields={knownFields ?? fields} value={parentValue} path={parentPath} />
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
  showRequired,
  required,
}: {
  label: string;
  fields: t.SchemaField[];
  parentValue: t.ConfigValue;
  parentPath: string;
  onChange: EntryChange;
  disabled?: boolean;
  editSessionId?: number;
  showRequired?: boolean;
  required?: boolean;
}) {
  const addFieldRef = useRef<(() => void) | null>(null);
  const localize = useLocalize();
  const lookupKey = collectionKeyOf(fields, parentPath);
  const usesPD = PROGRESSIVE_DISCLOSURE_PATHS.has(lookupKey);
  const pinnedSet = new Set(FIELD_ORDER[lookupKey] ?? []);
  const values = asConfigRecord(parentValue);
  const configuredCount = fields.filter((f) => hasConfigValue(values[f.key])).length;
  const [hasHideable, setHasHideable] = useState(
    () => usesPD && fields.some((f) => !pinnedSet.has(f.key) && !hasConfigValue(values[f.key])),
  );

  return (
    <NestedGroup
      label={label}
      sectionId={`section-${toFieldId(parentPath)}`}
      configuredCount={configuredCount}
      totalCount={fields.length}
      onAdd={!disabled && hasHideable ? () => addFieldRef.current?.() : undefined}
      addLabel={localize('com_config_add_field')}
      disabled={disabled}
      defaultExpanded={required ? true : undefined}
      revealPaths={[parentPath]}
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
        showRequired={showRequired}
      />
    </NestedGroup>
  );
}

/** Searchable picker of the fields hidden by progressive disclosure, grouped by `FieldMeta.groups`. */
function AddFieldPicker({
  fields,
  parentPath,
  lookupKey,
  autoOpen,
  onAdd,
  onClose,
}: {
  fields: t.SchemaField[];
  parentPath: string;
  lookupKey: string;
  autoOpen: boolean;
  onAdd: (key: string) => void;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const pickerId = useId();
  const labelled = fields
    .map((f) => ({ value: f.key, label: labelForPath(`${parentPath}.${f.key}`, localize) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const groups = getFieldMeta(
    fields[0]?.path.split('.').slice(0, -1).join('.') ?? lookupKey,
  )?.groups;
  const byKey = new Map(labelled.map((option) => [option.value, option]));
  const grouped = groups?.length
    ? [
        ...groups
          .map((group) => ({
            heading: localize(`com_config_group_${group.key}`),
            options: group.fields
              .map((key) => byKey.get(key))
              .filter((option): option is { value: string; label: string } => option != null),
          }))
          .filter((group) => group.options.length > 0),
        {
          heading: localize('com_config_group_advanced'),
          options: labelled.filter(
            (option) => !groups.some((g) => g.fields.includes(option.value)),
          ),
        },
      ].filter((group) => group.options.length > 0)
    : null;

  useEffect(() => {
    if (!autoOpen) return;
    const trigger = document.getElementById(pickerId);
    trigger?.focus();
    trigger?.click();
  }, [autoOpen, pickerId]);

  return (
    <div className="flex items-center gap-2 px-2.5 pt-1">
      <span aria-hidden="true" className="flex text-(--cui-color-text-muted)">
        <DecorativeIcon name="plus" size="sm" />
      </span>
      <div className="w-60">
        <Select
          id={pickerId}
          showSearch
          onOpenChange={(next) => {
            if (!next) onClose();
          }}
          placeholder={localize('com_config_ctl_add_field_placeholder')}
          aria-label={localize('com_config_add_field')}
          onSelect={(key) => {
            if (key) onAdd(key);
          }}
          options={grouped ?? labelled}
        />
      </div>
    </div>
  );
}

/**
 * Renders one schema field of a collection entry as an inline row. Exported
 * so custom collection renderers (grouped endpoint fields, MCP servers) can
 * render individual fields without InlineFieldRenderer's progressive
 * disclosure. `parentPath` should be the entry's data path
 * (`endpoints.custom.3`); field ids are derived from it.
 */
export function renderInlineField(
  field: t.SchemaField,
  parentValue: t.ConfigValue,
  parentPath: string,
  onChange: EntryChange,
  _localize: t.LocalizeFn,
  disabled?: boolean,
  /** Optional per-field-key overrides for array-object / record-object renderFields. */
  collectionRenderOverrides?: Record<string, t.CollectionRenderFields>,
  /** When true, non-optional fields show a required indicator (*). */
  showRequired?: boolean,
  /** See `SingleFieldRendererProps.editSessionId`. */
  editSessionId?: number,
): ReactNode {
  return (
    <InlineField
      key={field.key}
      field={field}
      parentValue={parentValue}
      parentPath={parentPath}
      onChange={onChange}
      disabled={disabled}
      collectionRenderOverrides={collectionRenderOverrides}
      showRequired={showRequired}
      editSessionId={editSessionId}
    />
  );
}

/** Whether the setting being revealed is `path` or inside it. */
function isRevealing(target: string | null, path: string): boolean {
  return target != null && (target === path || target.startsWith(`${path}.`));
}

/** One entry field; hidden while the tab filter matches neither it nor anything around or inside it. */
function InlineField(props: t.InlineFieldProps) {
  const rowFilter = useContext(RowFilterContext);
  if (!isRowVisible(rowFilter, `${props.parentPath}.${props.field.key}`)) return null;
  return <InlineFieldBody {...props} />;
}

function InlineFieldBody({
  field,
  parentValue,
  parentPath,
  onChange,
  disabled,
  collectionRenderOverrides,
  showRequired,
  editSessionId,
}: t.InlineFieldProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const values = asConfigRecord(parentValue);
  const fieldValue = values[field.key];
  const latestRef = useRef(fieldValue);
  latestRef.current = fieldValue;
  const lastObjectRef = useRef<t.ConfigRecord | null>(null);
  if (isPlainRecord(fieldValue)) lastObjectRef.current = fieldValue;
  const dataPath = `${parentPath}.${field.key}`;
  const fieldId = toFieldId(dataPath);
  const label = labelForPath(dataPath, localize);
  const meta = fieldMetaFor(field, dataPath);
  const required = Boolean(showRequired) && !field.isOptional;
  const { kind, width: controlWidth } = resolveControl({
    field,
    path: dataPath,
    value: fieldValue,
  });
  const state = useFieldState(dataPath);
  const { error } = state;
  const fieldDefault = entryFieldDefault(fieldValue, meta, state);
  const lower = lowerLayerValue(state);
  const secretPreview = getSecretPreviewValue(values, field.key);
  /** What clearing goes back to: the value the layer beneath sets (librechat.yaml, or Base in a profile). */
  const revertTo = layerValueBeneath(state);
  /**
   * Whether going back to the layer beneath changes anything: a secret the
   * target stores can't be removed where that layer holds none it can
   * restate (one it hides), and a value equal to that layer's (a `${VAR}` a
   * save restated in place of a stored key) stays until the entry's own
   * revert, since a save that leaves it out keeps it.
   */
  const restorable =
    secretPreview != null && state.isOverride
      ? revertTo?.value !== undefined
      : revertTo === undefined || !isConfigValueEqual(fieldValue, revertTo.value);

  /**
   * "Default" in an entry: remove the target's own value, so the entry reads
   * the layer beneath again (a required Base URL goes back to the
   * librechat.yaml one). A stored secret reads back only as its preview, so
   * removing it writes the lower layer's key in its place (or none). A value
   * only the layer beneath sets cannot be removed (D3; a merge brings it
   * back), so a pending change of it goes back to that value, and with none
   * there is nothing to clear.
   */
  const clearField = (): boolean => {
    if (!revertTo || (secretPreview != null && state.isOverride)) {
      onChange(field.key, revertTo?.value);
      return true;
    }
    if (isConfigValueEqual(fieldValue, revertTo.value)) return false;
    /** A list only the layer beneath sets can't be emptied: its earlier pending removals stay. */
    if (!state.isOverride && Array.isArray(fieldValue)) return false;
    onChange(field.key, revertTo.value);
    return true;
  };
  /** Keys of a record the layer beneath sets: their values can change, but they cannot be removed. */
  const lockedKeys = lowerRecordKeys(state.isOverride ? state.revertTarget?.value : lower?.value);
  /** …except one by one, by key, where the entry's editor offers it (`keyedTombstones`). */
  const keyRemoval = useRecordKeyRemoval(dataPath);
  const renderEntryChips = useContext(EntryFieldChipsContext);
  const entryChips = renderEntryChips?.({
    path: dataPath,
    label,
    value: fieldValue,
    onChange: (next) => onChange(field.key, next),
    onRevert: clearField,
    revertable: restorable,
    disabled,
  });

  /** Writes one key of this field's object value, merging into its latest value. */
  const changeChild: EntryChange = (childPath, childValue) => {
    const leafKey = childPath.split('.').pop() ?? childPath;
    const next = { ...asConfigRecord(latestRef.current), [leafKey]: childValue };
    if (childValue === undefined) delete next[leafKey];
    latestRef.current = next;
    onChange(field.key, next);
  };

  if (kind === 'switch-object') {
    const enabled = fieldValue === true || isPlainRecord(fieldValue);
    const own = fieldDefault.hasOwnValue ? enabled : undefined;
    const defaultEnabled = asEnabled(fieldDefault.value);
    return (
      <div className="flex flex-col">
        <InlineRow
          label={label}
          fieldId={fieldId}
          required={required}
          description={fieldDescription(field, meta, localize)}
          error={error}
          extraChips={entryChips}
          control={
            disabled ? (
              <BooleanChip value={own ?? defaultEnabled ?? false} />
            ) : (
              <TriStateField
                id={fieldId}
                value={own}
                defaultValue={defaultEnabled}
                defaultSource={fieldDefault.source}
                defaultFromGlobal={fieldDefault.fromGlobal}
                unsetLabel={meta?.defaultLabelKey ? localize(meta.defaultLabelKey) : undefined}
                onChange={(next) => {
                  if (next === undefined) clearField();
                  else onChange(field.key, next ? (lastObjectRef.current ?? true) : false);
                }}
                aria-label={label}
              />
            )
          }
        />
        {enabled && field.children?.length ? (
          <div className="mb-2 ms-4 border-s-2 border-(--cui-color-stroke-default) ps-4">
            <InlineFieldRenderer
              fields={field.children}
              parentValue={asConfigRecord(fieldValue)}
              parentPath={dataPath}
              onChange={changeChild}
              disabled={disabled}
              editSessionId={editSessionId}
              showRequired={showRequired}
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (isNestedObject(field) && kind !== 'variant') {
    return (
      <NestedGroupWithAddField
        label={label}
        fields={field.children ?? []}
        parentValue={fieldValue}
        parentPath={dataPath}
        onChange={changeChild}
        disabled={disabled}
        editSessionId={editSessionId}
        showRequired={showRequired}
        required={required}
      />
    );
  }

  if (kind === 'array-object') {
    const renderFn = collectionRenderOverrides?.[field.key] ?? renderCollectionEntryFields;
    return (
      <CollectionRow title={label} fieldId={fieldId} required={required} extraChips={entryChips}>
        <ArrayObjectField
          id={fieldId}
          path={dataPath}
          value={fieldValue}
          fields={field.children ?? []}
          onChange={(v) => onChange(field.key, v)}
          disabled={disabled}
          renderFields={renderFn}
          editSessionId={editSessionId}
          isEntryLocked={lowerEntryLock(dataPath, revertTo?.value, fieldValue)}
        />
      </CollectionRow>
    );
  }

  if (kind === 'record-object') {
    const renderFn = collectionRenderOverrides?.[field.key] ?? renderCollectionEntryFields;
    return (
      <CollectionRow title={label} fieldId={fieldId} required={required} extraChips={entryChips}>
        <RecordObjectField
          id={fieldId}
          path={dataPath}
          value={fieldValue}
          fields={field.children ?? []}
          onChange={(v) => onChange(field.key, v)}
          disabled={disabled}
          allowPrimitiveValues={field.recordValueAllowsPrimitive}
          renderFields={renderFn}
          editSessionId={editSessionId}
          lockedKeys={lockedKeys}
        />
      </CollectionRow>
    );
  }

  if (kind === 'variant') {
    const { variants, discriminator } = fieldVariants(field, localize);
    if (variants.length > 0) {
      return (
        <InlineRow
          label={label}
          fieldId={fieldId}
          required={required}
          description={fieldDescription(field, meta, localize)}
          error={error}
          extraChips={entryChips}
          control={
            <VariantField
              key={`${fieldId}-${editSessionId ?? 0}`}
              id={fieldId}
              value={fieldValue}
              variants={variants}
              discriminator={discriminator}
              inheritedKeys={lowerLayerKeys(state)}
              onChange={(v) => onChange(field.key, v)}
              disabled={disabled}
              aria-label={label}
              renderFields={(variantFields, variantValue, onVariantChange) => (
                <InlineFieldRenderer
                  fields={variantFields}
                  parentValue={variantValue}
                  parentPath={dataPath}
                  onChange={onVariantChange}
                  disabled={disabled}
                  editSessionId={editSessionId}
                />
              )}
            />
          }
        />
      );
    }
  }

  const stringValue = typeof fieldValue === 'string' ? fieldValue : '';
  if (disabled && stringValue !== '' && SECRET_CONFIG_KEYS.has(field.key)) {
    return (
      <InlineRow
        label={label}
        fieldId={fieldId}
        required={required}
        control={
          <span id={fieldId} className="static-value">
            {isEnvReference(stringValue) ? stringValue : MASKED_SECRET}
          </span>
        }
      />
    );
  }
  const hasPendingSecret = typeof fieldValue === 'string';
  /** A secret the target stores reads back only as its preview: it is the target's own value, so it can be removed. */
  const ownsStoredSecret =
    secretPreview != null && stringValue === '' && state.isOverride && restorable;

  return (
    <InlineRow
      label={label}
      fieldId={fieldId}
      required={required}
      description={fieldDescription(field, meta, localize)}
      error={error}
      shadowedBy={fieldValue !== undefined ? state.shadowedBy : undefined}
      shadowSource={shadowedSourceLabel(state, localize, scope)}
      extraChips={entryChips}
      width={controlWidth}
      control={
        <FieldControl
          key={secretPreview != null ? `${fieldId}-${editSessionId ?? 0}` : undefined}
          field={field}
          path={dataPath}
          id={fieldId}
          label={label}
          value={fieldValue}
          onChange={(v) => onChange(field.key, v)}
          onClear={clearField}
          fieldDefault={ownsStoredSecret ? { ...fieldDefault, hasOwnValue: true } : fieldDefault}
          lockedKeys={lockedKeys}
          keyRemoval={keyRemoval}
          disabled={disabled}
          required={required}
          secretPreview={secretPreview != null && stringValue === '' ? secretPreview : null}
          secretMaskLabel={maskedSecretLabel(state, localize)}
          hasPendingEdit={hasPendingSecret}
          onCancelSecret={() => {
            if (hasPendingSecret) onChange(field.key, undefined);
          }}
          editSessionId={editSessionId}
        />
      }
    />
  );
}

/** Label + control row inside a collection entry (WS6's `SettingsRow` layout). */
function InlineRow({
  label,
  fieldId,
  required,
  description,
  error,
  shadowedBy,
  shadowSource,
  extraChips,
  width,
  control,
}: {
  label: string;
  fieldId: string;
  required?: boolean;
  description?: string;
  error?: string;
  /** D11: Global overrides (`endpoints.all`) take precedence over this value. */
  shadowedBy?: t.ShadowedBy;
  /** Where the shadowed value comes from, named in the reason ("librechat.yaml"). */
  shadowSource?: string;
  /** Chips a collection editor adds (`EntryFieldChipsContext`). */
  extraChips?: ReactNode;
  /** Control width token (URLs and prompts L); unset sizes by control type. */
  width?: t.ControlWidth;
  control: ReactNode;
}) {
  const localize = useLocalize();
  const chips =
    shadowedBy || extraChips ? (
      <>
        {extraChips}
        {shadowedBy && (
          <ShadowBadge
            shadowedBy={shadowedBy}
            source={shadowSource ?? localize('com_config_ui_state_edited')}
          />
        )}
      </>
    ) : undefined;
  return (
    <SettingsRow
      label={label}
      htmlFor={fieldId}
      description={description}
      control={control}
      chips={chips}
      error={error}
      required={required}
      width={width}
    />
  );
}

function CollectionRow({
  title,
  fieldId,
  required,
  extraChips,
  children,
}: {
  title: string;
  fieldId: string;
  required?: boolean;
  /** Chips a collection editor adds (`EntryFieldChipsContext`). */
  extraChips?: ReactNode;
  children: ReactNode;
}) {
  const heading = (
    <span id={`${fieldId}-label`} className="text-sm font-medium text-(--cui-color-text-default)">
      {title}
      {required && (
        <span aria-hidden="true" className="ms-0.5 text-(--cui-color-text-danger)">
          *
        </span>
      )}
    </span>
  );
  return (
    <div className="flex w-full flex-col gap-2 px-(--settings-row-px) py-2">
      {extraChips ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {heading}
          <span className="flex flex-wrap items-center gap-1.5">{extraChips}</span>
        </div>
      ) : (
        heading
      )}
      {children}
    </div>
  );
}

/** Parent keys whose InlineFieldRenderer hides empty fields behind an "Add field"
 *  picker. Add new keys here when an object has too many optional fields to
 *  show by default (e.g. modelSpecs.list[].preset has 20+ fields). */
const PROGRESSIVE_DISCLOSURE_PATHS = new Set(['preset', 'custom']);

/** Optional field ordering for InlineFieldRenderer.  Fields listed here are
 *  placed first (in the given order) and are always visible even when
 *  progressive disclosure is active.  Unlisted fields follow in schema order
 *  and may be hidden behind "Add field" if progressive disclosure applies. */
const FIELD_ORDER: Record<string, string[]> = {
  custom: ['name', 'apiKey', 'baseURL', 'iconURL', 'models', 'modelDisplayLabel'],
  preset: ['endpoint', 'model'],
};
