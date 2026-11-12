import type * as t from '@/types';
import {
  canRoundTrip,
  coerceEnumValue,
  getArrayItemType,
  splitUnionTypes,
  getFieldOptions,
  getNumberInputProps,
} from '../controls';
import {
  fieldOptions,
  fieldMetaFor,
  literalValue,
  resolveControl,
  scalarUnionKinds,
  enumMemberOptions,
} from './kinds';
import { addressItemError, isAddressListPath, isWhitespaceSignificantPath } from '@/utils';
import { defaultChoiceLabel, formatDefaultValue } from '../fields/display';
import { useLocalize, useFieldError, useInheritedMimeList } from '@/hooks';
import { SecretField, SecretInput } from '../fields/SecretField';
import { ScalarUnionField } from '../fields/ScalarUnionField';
import { BoolOrListField } from '../fields/BoolOrListField';
import { TextRecordField } from '../fields/TextRecordField';
import { ListRecordField } from '../fields/ListRecordField';
import { DomainListField } from '../fields/DomainListField';
import { ModelListField } from '../fields/ModelListField';
import { MultiEnumField } from '../fields/MultiEnumField';
import { RefSelectField } from '../fields/RefSelectField';
import { TriStateField } from '../fields/TriStateField';
import { TextareaField } from '../fields/TextareaField';
import { KeyValueField } from '../fields/KeyValueField';
import { MimeListField } from '../fields/MimeListField';
import { RefListField } from '../fields/RefListField';
import { LiteralField } from '../fields/LiteralField';
import { EnvStatusWrap } from '../fields/EnvStatus';
import { NumberField } from '../fields/NumberField';
import { SelectField } from '../fields/SelectField';
import { ToggleField } from '../fields/ToggleField';
import { StaticField } from '../fields/StaticField';
import { TextField } from '../fields/TextField';
import { ListField } from '../fields/ListField';
import { CodeField } from '../fields/CodeField';
import { toKVPair } from '../fields/kv';
import { labelForPath } from '../meta';

/** "Global: …" for a value `endpoints.all` sets, "Inherited: …" for Base's in a profile, else "Default: …". */
function placeholderKey(fieldDefault: t.FieldDefault): string {
  if (fieldDefault.fromGlobal) return 'com_config_ctl_placeholder_global';
  if (fieldDefault.source === 'inherited') return 'com_config_ctl_placeholder_inherited';
  return 'com_config_ctl_placeholder_default';
}

function isPlainRecord(value: t.ConfigValue): value is t.ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKVPairs(value: t.ConfigValue): value is t.KeyValuePair[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isPlainRecord(item) && typeof item.key === 'string' && 'value' in item)
  );
}

function isStringArray(value: t.ConfigValue): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Whether a control can show `value` and emit it back unchanged (WS2's
 * `canRoundTrip`, with text inputs also showing numbers and booleans as text
 * and number inputs numeric strings). Anything a control cannot represent
 * falls back to the YAML editor instead of an empty control that would
 * overwrite the value on the next edit (`[object Object]`, `''`).
 */
export function fitsControl(
  kind: t.ControlKind,
  field: t.SchemaField,
  value: t.ConfigValue,
): boolean {
  if (value === undefined || value === null) return true;
  switch (kind) {
    case 'text':
    case 'textarea':
    case 'secret':
    case 'ref-select':
      return typeof value !== 'object';
    case 'number':
      return (
        typeof value === 'number' ||
        (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)))
      );
    case 'record':
      return isPlainRecord(value) || isKVPairs(value);
    case 'scalar-union':
    case 'literal':
      return !isPlainRecord(value) && !Array.isArray(value);
    default:
      return canRoundTrip(kind, field, value);
  }
}

function recordPairs(value: t.ConfigValue): t.KeyValuePair[] {
  if (isKVPairs(value)) return value;
  if (!isPlainRecord(value)) return [];
  return Object.entries(value).map(([key, child]) => toKVPair(key, child));
}

function textValue(value: t.ConfigValue): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

const INDEX_SEGMENT_RE = /^\d+$/;

/**
 * A button group's accessible name: its label with the setting it belongs to
 * ("Balance: Enabled"), since labels such as "Enabled" repeat on a tab.
 * Entry fields keep their own label (the entry card already names them).
 */
function groupName(path: string, label: string, localize: t.LocalizeFn): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return label;
  const parentPath = path.slice(0, dot);
  if (parentPath.split('.').some((segment) => INDEX_SEGMENT_RE.test(segment))) return label;
  return localize('com_config_ctl_group_name', {
    parent: labelForPath(parentPath, localize),
    label,
  });
}

/**
 * Options of a checkbox grid with their one-line descriptions
 * (`FieldMeta.enumDescriptions`), in `FieldMeta.order` when it lists them.
 */
function describedOptions(
  options: t.SelectOption[],
  meta: t.FieldMeta | undefined,
  localize: t.LocalizeFn,
): t.MultiEnumOption[] {
  const descriptionKeys = meta?.enumDescriptions;
  const described = descriptionKeys
    ? options.map((option) => {
        const key = descriptionKeys[option.value];
        return key ? { ...option, description: localize(key) } : option;
      })
    : options;
  if (!meta?.order) return described;
  const rank = new Map(meta.order.map((value, index) => [value, index]));
  const last = meta.order.length;
  return [...described].sort((a, b) => (rank.get(a.value) ?? last) - (rank.get(b.value) ?? last));
}

/**
 * What a field's env status note reports on: its own value, else (with no own
 * value) the value it shows from the layer beneath. A stored secret is not an
 * env reference, whatever the layer beneath holds. Text LibreChat does not
 * expand (interface copy, model specs, prompts) is skipped by the note itself.
 */
function envStatusValue(props: t.FieldControlProps): t.ConfigValue {
  if (props.secretPreview != null) return undefined;
  if (props.value !== undefined && props.value !== '') return props.value;
  return props.fieldDefault.hasOwnValue ? undefined : props.fieldDefault.value;
}

/**
 * The control for one field, shared by full settings rows and inline entry
 * rows, with whether each `${NAME}` its value references is set on the
 * server below it (`envStatus`; see `ControlFor`).
 */
export function FieldControl(props: t.FieldControlProps) {
  return (
    <EnvStatusWrap value={envStatusValue(props)} path={props.path}>
      <ControlFor {...props} />
    </EnvStatusWrap>
  );
}

/**
 * Picks the control from `FieldMeta.control` or the schema shape, wires
 * "Default" (no own value) through `onClear`, and falls back to YAML when the
 * value does not fit the control.
 */
function ControlFor({
  field,
  path,
  id,
  label,
  value,
  onChange,
  onClear,
  fieldDefault,
  disabled,
  required,
  secretPreview,
  secretMaskLabel,
  hasPendingEdit,
  onCancelSecret,
  lockedKeys,
  keyRemoval,
  'aria-describedby': ariaDescribedBy,
}: t.FieldControlProps) {
  const localize = useLocalize();
  const rowError = useFieldError(path);
  const control = resolveControl({ field, path, value });
  const { unit, width, optionSource } = control;
  const kind: t.ControlKind =
    secretPreview != null && control.kind === 'text' ? 'secret' : control.kind;
  /**
   * A required value the layer beneath also sets: clearing it goes back to
   * that value (D3), not an error. With no own value there is nothing to
   * clear: the field says so and keeps the value, and nothing is staged.
   */
  const revertible =
    required === true &&
    fieldDefault.value !== undefined &&
    (fieldDefault.source === 'yaml' || fieldDefault.source === 'inherited');
  const mustFill = required === true && !revertible;
  const optional = field.isOptional && !required;
  const clear = optional || revertible ? onClear : undefined;
  const { labels: optionLabels } = fieldOptions(field, localize);
  const meta = fieldMetaFor(field, path);
  const defaultLabelKey = meta?.defaultLabelKey;
  const defaultLabel =
    defaultLabelKey && fieldDefault.value === undefined
      ? localize(defaultLabelKey)
      : defaultChoiceLabel(fieldDefault, localize, optionLabels);
  const shownDefault = formatDefaultValue(fieldDefault.value, localize, optionLabels);
  const showsDefault = shownDefault != null && shownDefault !== '' && !fieldDefault.hasOwnValue;
  const example = meta?.placeholderKey ? localize(meta.placeholderKey) : undefined;
  const placeholder = showsDefault
    ? localize(placeholderKey(fieldDefault), { value: shownDefault })
    : example;
  const common = { id, disabled, 'aria-label': label };

  if (disabled) {
    return (
      <StaticField
        id={id}
        field={field}
        kind={kind}
        value={value}
        secretPreview={secretPreview}
        secretMaskLabel={secretMaskLabel}
        fallback={fieldDefault.value}
        unit={unit}
        width={width}
      />
    );
  }

  if (!fitsControl(kind, field, value)) {
    return (
      <CodeField id={id} value={value} onChange={onChange} disabled={disabled} aria-label={label} />
    );
  }

  switch (kind) {
    case 'tristate': {
      const effective = typeof value === 'boolean' ? value : undefined;
      const defaultBool = typeof fieldDefault.value === 'boolean' ? fieldDefault.value : undefined;
      return (
        <TriStateField
          {...common}
          aria-label={groupName(path, label, localize)}
          value={fieldDefault.hasOwnValue ? effective : undefined}
          defaultValue={defaultBool}
          defaultSource={fieldDefault.source}
          defaultFromGlobal={fieldDefault.fromGlobal}
          unsetLabel={defaultLabelKey ? localize(defaultLabelKey) : undefined}
          onChange={(next) => (next === undefined ? onClear() : onChange(next))}
        />
      );
    }
    case 'toggle': {
      const fallback = typeof fieldDefault.value === 'boolean' ? fieldDefault.value : false;
      const checked = typeof value === 'boolean' ? value : fallback;
      return <ToggleField {...common} checked={checked} onChange={onChange} />;
    }
    case 'select': {
      const showOwn = fieldDefault.hasOwnValue || !clear;
      const { options } = fieldOptions(field, localize, value);
      return (
        <SelectField
          {...common}
          value={showOwn && value != null ? String(value) : undefined}
          options={options}
          onChange={(next) => onChange(coerceEnumValue(next, field))}
          onClear={clear}
          defaultLabel={defaultLabel}
          width={width}
          aria-describedby={ariaDescribedBy}
        />
      );
    }
    case 'number': {
      const { min, max, step } = getNumberInputProps(field);
      return (
        <NumberField
          {...common}
          value={value == null ? undefined : Number(value)}
          onChange={(next) => (next === undefined ? onClear() : onChange(next))}
          onClear={clear ?? (mustFill ? undefined : onClear)}
          required={mustFill}
          placeholder={showsDefault ? shownDefault : undefined}
          min={min}
          max={max}
          step={step}
          int={field.constraints?.int}
          unit={unit}
          width={width}
          hasRowError={rowError != null}
          aria-describedby={ariaDescribedBy}
        />
      );
    }
    case 'secret': {
      if (secretPreview != null && onCancelSecret) {
        return (
          <SecretField
            {...common}
            value={typeof value === 'string' ? value : ''}
            maskedValue={secretPreview}
            maskLabel={secretMaskLabel}
            onChange={onChange}
            onCancel={onCancelSecret}
            onRemove={fieldDefault.hasOwnValue && clear ? clear : undefined}
            hasPendingEdit={hasPendingEdit}
            width={width}
          />
        );
      }
      return (
        <SecretInput
          {...common}
          value={textValue(value)}
          onChange={onChange}
          onClear={clear ?? onClear}
          required={mustFill}
          hasRowError={rowError != null}
          placeholder={placeholder}
          width={width}
          aria-describedby={ariaDescribedBy}
        />
      );
    }
    case 'textarea':
      return (
        <TextareaField
          {...common}
          value={textValue(value)}
          onChange={onChange}
          onClear={clear ?? onClear}
          required={mustFill}
          hasRowError={rowError != null}
          placeholder={placeholder}
          width={width}
          aria-describedby={ariaDescribedBy}
        />
      );
    case 'ref-select':
      return (
        <RefSelectField
          {...common}
          value={value == null ? undefined : textValue(value)}
          source={optionSource}
          path={path}
          onChange={onChange}
          onClear={clear ?? onClear}
          placeholder={placeholder}
          width={width}
        />
      );
    case 'literal': {
      const literal = literalValue(field.type);
      if (literal === undefined) break;
      const literalKey = fieldMetaFor(field, path)?.enumLabels?.[String(literal)];
      return (
        <LiteralField
          id={id}
          literal={literal}
          value={value}
          onChange={(next) => (next === undefined ? onClear() : onChange(next))}
          disabled={disabled}
          label={literalKey ? localize(literalKey) : undefined}
        />
      );
    }
    case 'bool-or-list':
      return (
        <BoolOrListField
          {...common}
          value={fieldDefault.hasOwnValue || !clear ? value : undefined}
          onChange={onChange}
          onClear={clear}
          defaultLabel={
            defaultLabelKey && fieldDefault.value === undefined
              ? defaultLabel
              : defaultChoiceLabel(fieldDefault, localize, {
                  true: localize('com_config_ctl_bool_list_all'),
                  false: localize('com_config_ctl_off'),
                })
          }
          itemLabel={localize(`com_config_field_${field.key}_item`)}
        />
      );
    case 'scalar-union': {
      const kinds = scalarUnionKinds(field.type) ?? ['string'];
      return (
        <ScalarUnionField
          {...common}
          value={fieldDefault.hasOwnValue || !clear ? value : undefined}
          kinds={kinds}
          options={enumMemberOptions(field, localize)}
          onChange={onChange}
          onClear={clear}
          defaultLabel={defaultLabel}
          unit={unit}
        />
      );
    }
    case 'multi-enum':
      return (
        <MultiEnumField
          {...common}
          value={isStringArray(value) ? value : undefined}
          options={describedOptions(
            getFieldOptions(field, localize, undefined),
            fieldMetaFor(field, path),
            localize,
          )}
          onChange={(next) => (next === undefined ? onClear() : onChange(next))}
          clearOnEmpty={false}
        />
      );
    case 'mime-list':
      return (
        <MimeListControl
          id={id}
          path={path}
          label={label}
          value={fieldDefault.hasOwnValue && isStringArray(value) ? value : undefined}
          fieldDefault={fieldDefault}
          onChange={onChange}
          onClear={onClear}
        />
      );
    case 'model-list':
      return (
        <ModelListField
          {...common}
          value={value}
          path={path}
          source={optionSource}
          namesOnly={getArrayItemType(field.type) === 'string'}
          onChange={onChange}
          onClear={onClear}
          required={mustFill || !field.isOptional}
        />
      );
    case 'array': {
      const itemType = getArrayItemType(field.type);
      if (optionSource && !itemType.startsWith('enum(')) {
        return (
          <RefListField
            {...common}
            source={optionSource}
            values={isStringArray(value) ? value : []}
            onChange={onChange}
            onClear={onClear}
            itemLabel={localize(`com_config_field_${field.key}_item`)}
            width={width ?? 'M'}
          />
        );
      }
      const addresses = isAddressListPath(path);
      return (
        <ListField
          {...common}
          values={isStringArray(value) ? value : []}
          onChange={onChange}
          onClear={onClear}
          itemLabel={localize(`com_config_field_${field.key}_item`)}
          options={itemType.startsWith('enum(') ? getFieldOptions(field, localize) : undefined}
          keepsWhitespace={isWhitespaceSignificantPath(path)}
          placeholder={addresses ? localize('com_config_providers_network_placeholder') : undefined}
          validateItem={addresses ? (entry) => addressItemError(entry, localize) : undefined}
          width={width ?? (addresses ? 'M' : 'L')}
        />
      );
    }
    case 'domain-list':
      return (
        <DomainListField
          {...common}
          path={path}
          values={isStringArray(value) ? value : []}
          lowerValues={isStringArray(fieldDefault.value) ? fieldDefault.value : undefined}
          hasOwnValue={fieldDefault.hasOwnValue}
          lowerSource={fieldDefault.source}
          onChange={onChange}
          onClear={onClear}
        />
      );
    case 'record':
      return (
        <KeyValueField
          {...common}
          pairs={recordPairs(value)}
          onChange={onChange}
          onClear={onClear}
          valueTypes={field.recordValueKVTypes}
          valueOptions={field.itemType ? getFieldOptions(field, localize) : undefined}
          lockedKeys={lockedKeys}
          keyRemoval={keyRemoval}
        />
      );
    case 'text-record': {
      const variant = splitUnionTypes(field.type).some((member) => member.startsWith('array'))
        ? 'array'
        : 'record';
      return <TextRecordField {...common} value={value} onChange={onChange} variant={variant} />;
    }
    case 'list-record':
      return <ListRecordField {...common} value={value} onChange={onChange} />;
    case 'text':
      return (
        <TextField
          {...common}
          value={textValue(value)}
          onChange={onChange}
          onClear={clear ?? onClear}
          required={mustFill}
          hasRowError={rowError != null}
          placeholder={placeholder}
          width={width}
          aria-describedby={ariaDescribedBy}
        />
      );
    default:
      break;
  }
  return (
    <CodeField id={id} value={value} onChange={onChange} disabled={disabled} aria-label={label} />
  );
}

/** The MIME list editor with the list it inherits (FX-7). */
function MimeListControl({
  id,
  path,
  label,
  value,
  fieldDefault,
  onChange,
  onClear,
}: Pick<t.FieldControlProps, 'id' | 'path' | 'label' | 'fieldDefault' | 'onChange' | 'onClear'> & {
  value: string[] | undefined;
}) {
  const inherited = useInheritedMimeList(path, fieldDefault);
  return (
    <MimeListField
      id={id}
      path={path}
      value={value}
      inherited={inherited}
      onChange={onChange}
      onClear={onClear}
      aria-label={label}
    />
  );
}

/** On or Off as text, for a switch that can't be changed here. */
export function BooleanChip({ value }: { value: boolean }) {
  const localize = useLocalize();
  return (
    <span className="static-value self-start">
      {localize(value ? 'com_config_ctl_on' : 'com_config_ctl_off')}
    </span>
  );
}
