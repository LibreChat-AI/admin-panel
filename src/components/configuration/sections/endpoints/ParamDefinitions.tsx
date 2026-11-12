/**
 * Parameter definitions of a custom endpoint (WS10 CE-6): the parameter
 * panel its users see. An entry that only sets the default of a built-in
 * parameter (`{ key, default }`, or the built-in definition with only its
 * default changed) reads as such, with a default control of the parameter's
 * own type; "Customize every option" opens the full definition,
 * whose Default follows the chosen Type, whose Component choices fit that
 * Type, and whose built-in (locale-coded) label and description are shown as
 * such with a switch to custom text. Definitions librechat.yaml (or Base)
 * defines keep their key: LibreChat would bring the original back.
 */
import { useMemo, useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import { paramSettings } from 'librechat-data-provider';
import type { SettingDefinition } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { ArrayObjectField, ListField, NumberField, SelectField, TextField } from '../../fields';
import { renderInlineField, toFieldId } from '../../renderer';
import { describeField, labelForPath } from '../../meta';
import { UnknownSettings } from '../../UnknownSettings';
import { getEntryKey, asConfigRecord, isConfigValueEqual } from '@/utils';
import { DecorativeIcon } from '@/components/shared';
import { SettingsRow } from '../../SettingsRow';
import { useLocalize } from '@/hooks';

/** Components that can show each type of parameter. */
const TYPE_COMPONENTS: Readonly<Record<string, string[]>> = {
  number: ['input', 'slider'],
  boolean: ['checkbox', 'switch'],
  string: ['input', 'textarea'],
  enum: ['dropdown', 'slider', 'combobox'],
  array: ['tags'],
};

/** Fields each component reads. */
const COMPONENT_FIELDS: Readonly<Record<string, string[]>> = {
  input: ['placeholder', 'placeholderCode', 'minText', 'maxText'],
  textarea: ['placeholder', 'placeholderCode', 'minText', 'maxText'],
  slider: ['range', 'includeInput'],
  checkbox: [],
  switch: [],
  dropdown: ['options', 'enumMappings'],
  combobox: [
    'options',
    'searchPlaceholder',
    'searchPlaceholderCode',
    'selectPlaceholder',
    'selectPlaceholderCode',
  ],
  tags: ['minTags', 'maxTags'],
};

/** Components whose options are a list of choices (a checkbox or switch ignores them). */
const OPTION_COMPONENTS: ReadonlySet<string> = new Set(['dropdown', 'combobox', 'slider']);

/** How the definition is laid out, after key, type, component and default. */
const LAYOUT_FIELDS = [
  'optionType',
  'showLabel',
  'showDefault',
  'descriptionSide',
  'columnSpan',
  'columns',
];

/** Fields a built-in definition may differ in and still read as "the built-in, with its default changed". */
const OVERRIDE_FIELDS: ReadonlySet<string> = new Set(['default', 'optionType']);

/** Fields placed by hand (the rest render through the generic entry renderer). */
const HANDLED: ReadonlySet<string> = new Set([
  'key',
  'type',
  'component',
  'default',
  'label',
  'labelCode',
  'description',
  'descriptionCode',
]);

/** Every key this editor places somewhere; a key outside it (a newer schema's) is always shown. */
const KNOWN: ReadonlySet<string> = new Set([
  ...HANDLED,
  ...Object.values(COMPONENT_FIELDS).flat(),
  ...LAYOUT_FIELDS,
]);

function text(value: t.ConfigValue): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function displayValue(value: t.ConfigValue): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/**
 * A built-in parameter as a stored definition. Before
 * `customParamsExpansion`, LibreChat expands librechat.yaml's definitions
 * over the built-in ones (`parseCustomParams`) but serves an override's as
 * stored, and its client replaces the built-in definition with it whole, so a
 * bare `{ key, default }` would lose its type, component and label: store the
 * full definition, as LibreChat expands it.
 */
export function builtInDefinition(builtIn: SettingDefinition): t.ConfigRecord {
  const definition: t.ConfigValue = JSON.parse(JSON.stringify(builtIn));
  return { ...asConfigRecord(definition), optionType: 'custom' };
}

/**
 * A built-in parameter as librechat.yaml writes it, `{ key, default }`, which
 * LibreChat completes from the parameter set (`customParamsExpansion`) for
 * an override as for librechat.yaml.
 */
function compactDefinition(builtIn: SettingDefinition): t.ConfigRecord {
  const definition = asConfigRecord(JSON.parse(JSON.stringify(builtIn)) as t.ConfigValue);
  return definition.default === undefined
    ? { key: builtIn.key }
    : { key: builtIn.key, default: definition.default };
}

/** Whether a definition is the built-in one with at most its default changed (or only `{ key, default }`). */
function isBuiltInOverride(value: t.ConfigRecord, builtIn: SettingDefinition | undefined): boolean {
  if (!builtIn) return false;
  if (value.type === undefined && value.component === undefined) return true;
  const full = builtInDefinition(builtIn);
  const keys = new Set([...Object.keys(value), ...Object.keys(full)]);
  return [...keys].every(
    (key) => OVERRIDE_FIELDS.has(key) || isConfigValueEqual(value[key], full[key]),
  );
}

/** The built-in parameters of a parameter set, by key (LibreChat's `paramSettings`). */
function builtInParameters(paramSet: string | undefined): Map<string, SettingDefinition> {
  const settings = paramSettings[paramSet ?? 'custom'] ?? paramSettings.custom ?? [];
  return new Map(settings.map((setting) => [setting.key, setting]));
}

function Row({
  path,
  control,
  description,
  note,
}: {
  path: string;
  control: ReactNode;
  description?: string;
  note?: ReactNode;
}) {
  const localize = useLocalize();
  return (
    <SettingsRow
      label={labelForPath(path, localize)}
      htmlFor={toFieldId(path)}
      description={description ?? describeField({ path, description: undefined }, localize)}
      control={
        <>
          {control}
          {note && <div className="text-xs text-(--cui-color-text-muted)">{note}</div>}
        </>
      }
    />
  );
}

/** The default value, with a control for the parameter's type. */
function DefaultControl({
  path,
  type,
  value,
  options,
  range,
  onChange,
  disabled,
}: {
  path: string;
  type: string | undefined;
  value: t.ConfigValue;
  options: string[];
  range: t.ConfigRecord;
  onChange: (value: t.ConfigValue) => void;
  disabled?: boolean;
}) {
  const localize = useLocalize();
  const id = toFieldId(path);
  const label = labelForPath(path, localize);
  const clear = () => {
    onChange(undefined);
    return true;
  };
  if (disabled) {
    return (
      <span id={id} data-static-value className="static-value self-start">
        {value === undefined || value === ''
          ? localize('com_config_ce_param_no_default')
          : displayValue(value)}
      </span>
    );
  }
  switch (type) {
    case 'boolean':
      return (
        <SelectField
          id={id}
          value={typeof value === 'boolean' ? String(value) : undefined}
          options={[
            { value: 'true', label: localize('com_config_ctl_on') },
            { value: 'false', label: localize('com_config_ctl_off') },
          ]}
          onChange={(next) => onChange(next === 'true')}
          onClear={clear}
          defaultLabel={localize('com_config_ce_param_no_default')}
          width="S"
          aria-label={label}
        />
      );
    case 'number':
      return (
        <NumberField
          id={id}
          value={typeof value === 'number' ? value : undefined}
          onChange={(next) => onChange(next)}
          onClear={clear}
          min={typeof range.min === 'number' ? range.min : undefined}
          max={typeof range.max === 'number' ? range.max : undefined}
          step={typeof range.step === 'number' ? range.step : undefined}
          width="S"
          aria-label={label}
        />
      );
    case 'enum':
      return (
        <SelectField
          id={id}
          value={value === undefined ? undefined : String(value)}
          options={options.map((option) => ({ value: option, label: option }))}
          onChange={onChange}
          onClear={clear}
          defaultLabel={localize('com_config_ce_param_no_default')}
          width="M"
          aria-label={label}
        />
      );
    case 'array':
      return (
        <ListField
          id={id}
          values={Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []}
          onChange={onChange}
          onClear={clear}
          width="L"
          aria-label={label}
        />
      );
    default:
      return (
        <TextField
          id={id}
          value={value === undefined ? '' : displayValue(value)}
          onChange={onChange}
          onClear={clear}
          width="M"
          aria-label={label}
        />
      );
  }
}

/**
 * A label or description LibreChat looks up in its own translations
 * (`labelCode`): shown as the built-in text, with a switch to custom text.
 */
function CodedText({
  path,
  codeKey,
  values,
  onChange,
  disabled,
  wide,
}: {
  path: string;
  codeKey: string;
  values: t.ConfigRecord;
  onChange: (key: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  wide?: boolean;
}) {
  const localize = useLocalize();
  const key = path.split('.').pop() ?? '';
  const id = toFieldId(path);
  const current = text(values[key]);
  if (values[codeKey] === true) {
    return (
      <Row
        path={path}
        note={localize('com_config_ce_param_builtin_note', { code: current ?? '' })}
        control={
          <div className="flex flex-wrap items-center gap-2">
            <span id={id} data-static-value className="static-value">
              {localize('com_config_ce_param_builtin_text')}
            </span>
            {!disabled && (
              <Button
                type="secondary"
                htmlType="button"
                label={localize('com_config_ce_param_custom_text')}
                onClick={() => {
                  onChange(codeKey, false);
                  onChange(key, undefined);
                }}
              />
            )}
          </div>
        }
      />
    );
  }
  if (disabled) {
    return (
      <Row
        path={path}
        control={
          <span id={id} data-static-value className="static-value self-start">
            {current ?? '—'}
          </span>
        }
      />
    );
  }
  return (
    <Row
      path={path}
      control={
        <TextField
          id={id}
          value={current ?? ''}
          onChange={(next) => onChange(key, next)}
          onClear={() => {
            onChange(key, undefined);
            return true;
          }}
          width={wide ? 'L' : 'M'}
          aria-label={labelForPath(path, localize)}
        />
      }
    />
  );
}

function KeyRow({
  path,
  value,
  locked,
  disabled,
  builtIns,
  onChange,
}: {
  path: string;
  value: string;
  locked: boolean;
  disabled?: boolean;
  builtIns: Map<string, SettingDefinition>;
  onChange: (value: string) => void;
}) {
  const localize = useLocalize();
  const id = toFieldId(path);
  const listId = `${id}-builtins`;
  if (locked || disabled) {
    return (
      <Row
        path={path}
        note={locked ? localize('com_config_ce_param_key_locked') : undefined}
        control={
          <span className="flex items-center gap-1.5 self-start">
            {locked && (
              <span className="flex text-(--cui-color-text-muted)">
                <DecorativeIcon name="lock" size="xs" />
              </span>
            )}
            <span id={id} data-static-value className="static-value">
              {value}
            </span>
          </span>
        }
      />
    );
  }
  return (
    <Row
      path={path}
      control={
        <>
          <TextField
            id={id}
            value={value}
            onChange={onChange}
            required
            list={listId}
            width="M"
            aria-label={labelForPath(path, localize)}
          />
          <datalist id={listId}>
            {[...builtIns.keys()].map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>
        </>
      }
    />
  );
}

function ParamDefinitionEntry({
  fields,
  value,
  path,
  onChange,
  disabled,
  builtIns,
  keyLocked,
}: t.ParamDefinitionEntryProps) {
  const localize = useLocalize();
  const key = text(value.key) ?? '';
  const builtIn = builtIns.get(key);
  const type = text(value.type);
  const component = text(value.component);
  const [expanded, setExpanded] = useState(() => !isBuiltInOverride(value, builtIn));
  const options = Array.isArray(value.options)
    ? value.options.filter((option): option is string => typeof option === 'string')
    : (builtIn?.options ?? []);
  const range = asConfigRecord(value.range ?? (builtIn?.range as t.ConfigValue | undefined));
  const effectiveType = type ?? builtIn?.type;

  const keyRow = (
    <KeyRow
      path={`${path}.key`}
      value={key}
      locked={keyLocked}
      disabled={disabled}
      builtIns={builtIns}
      onChange={(next) => onChange('key', next)}
    />
  );
  const defaultRow = (
    <Row
      path={`${path}.default`}
      description={
        builtIn?.default !== undefined
          ? localize('com_config_ce_param_builtin_default', {
              value: displayValue(builtIn.default),
            })
          : undefined
      }
      control={
        <DefaultControl
          path={`${path}.default`}
          type={effectiveType}
          value={value.default}
          options={options}
          range={range}
          onChange={(next) => onChange('default', next)}
          disabled={disabled}
        />
      }
    />
  );

  if (!expanded) {
    return (
      <div className="flex flex-col gap-1">
        <p className="m-0 px-(--settings-row-px) text-xs text-(--cui-color-text-muted)">
          {localize('com_config_ce_param_override_note')}
        </p>
        {keyRow}
        {defaultRow}
        {!disabled && (
          <div className="px-(--settings-row-px) pt-1">
            <Button
              type="secondary"
              htmlType="button"
              label={localize('com_config_ce_param_customize')}
              onClick={() => setExpanded(true)}
            />
          </div>
        )}
      </div>
    );
  }

  const changeType = (next: string | undefined) => {
    onChange('type', next);
    const allowed = next ? (TYPE_COMPONENTS[next] ?? []) : [];
    if (component && !allowed.includes(component)) onChange('component', undefined);
    if (value.default !== undefined && next !== type) onChange('default', undefined);
  };
  const typeOptions = Object.keys(TYPE_COMPONENTS).map((option) => ({
    value: option,
    label: localize(`com_config_ce_param_type_${option}`),
  }));
  const componentOptions = (effectiveType ? (TYPE_COMPONENTS[effectiveType] ?? []) : []).map(
    (option) => ({ value: option, label: localize(`com_config_ce_param_component_${option}`) }),
  );
  const showsOptions =
    effectiveType === 'enum' ||
    (component != null && OPTION_COMPONENTS.has(component)) ||
    (Array.isArray(value.options) && value.options.length > 0);
  const extra = new Set([
    ...(component ? (COMPONENT_FIELDS[component] ?? []) : []),
    ...(showsOptions ? ['options'] : []),
    ...LAYOUT_FIELDS,
  ]);
  const rest = fields.filter(
    (field) =>
      !HANDLED.has(field.key) &&
      (extra.has(field.key) || !KNOWN.has(field.key) || value[field.key] !== undefined),
  );
  const staticText = (shown: string) => (
    <span data-static-value className="static-value self-start">
      {shown}
    </span>
  );

  return (
    <div className="flex flex-col gap-1">
      {keyRow}
      <Row
        path={`${path}.type`}
        control={
          disabled ? (
            staticText(type ? localize(`com_config_ce_param_type_${type}`) : '—')
          ) : (
            <SelectField
              id={toFieldId(`${path}.type`)}
              value={type}
              options={typeOptions}
              onChange={changeType}
              onClear={() => {
                changeType(undefined);
                return true;
              }}
              defaultLabel={localize('com_config_ce_param_type_unset')}
              width="M"
              aria-label={labelForPath(`${path}.type`, localize)}
            />
          )
        }
      />
      <Row
        path={`${path}.component`}
        control={
          disabled ? (
            staticText(component ? localize(`com_config_ce_param_component_${component}`) : '—')
          ) : (
            <SelectField
              id={toFieldId(`${path}.component`)}
              value={component}
              options={componentOptions}
              onChange={(next) => onChange('component', next)}
              onClear={() => {
                onChange('component', undefined);
                return true;
              }}
              defaultLabel={localize(
                effectiveType
                  ? 'com_config_ce_param_component_auto'
                  : 'com_config_ce_param_pick_type',
              )}
              width="M"
              aria-label={labelForPath(`${path}.component`, localize)}
            />
          )
        }
      />
      {defaultRow}
      <CodedText
        path={`${path}.label`}
        codeKey="labelCode"
        values={value}
        onChange={onChange}
        disabled={disabled}
      />
      <CodedText
        path={`${path}.description`}
        codeKey="descriptionCode"
        values={value}
        onChange={onChange}
        disabled={disabled}
        wide
      />
      {rest.map((field) => renderInlineField(field, value, path, onChange, localize, disabled))}
      <UnknownSettings fields={fields} value={value} path={path} />
    </div>
  );
}

/** One-line summary of a definition in its collapsed card: type and default. */
function summarize(item: t.ConfigValue, localize: t.LocalizeFn): string | null {
  const record = asConfigRecord(item);
  const type = text(record.type);
  const parts: string[] = [];
  if (type) parts.push(localize(`com_config_ce_param_type_${type}`));
  if (record.default !== undefined) {
    parts.push(
      localize('com_config_ce_param_default_summary', { value: displayValue(record.default) }),
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The parameter definitions of an endpoint: a card per definition titled by
 * its key, plus "Override a built-in parameter" (from the endpoint's
 * parameter set) and "Add a custom parameter".
 */
export function ParamDefinitionsRow({
  path,
  field,
  value,
  lowerKeys,
  paramSet,
  compact = false,
  openRouterDefaults = false,
  onChange,
  disabled,
  editSessionId,
  chips,
}: t.ParamDefinitionsRowProps) {
  const localize = useLocalize();
  const items = Array.isArray(value) ? value : [];
  const builtIns = useMemo(() => builtInParameters(paramSet), [paramSet]);
  const defined = new Set(items.flatMap((item) => getEntryKey(item, 'key') ?? []));
  const available = [...builtIns.keys()].filter((key) => !defined.has(key));
  const fieldId = toFieldId(path);

  const renderFields = useMemo(
    (): t.CollectionRenderFields =>
      (entryFields, parentValue, parentPath, entryChange, _addRef, _session, entryDisabled) => (
        <ParamDefinitionEntry
          fields={entryFields}
          value={asConfigRecord(parentValue)}
          path={parentPath}
          onChange={entryChange}
          disabled={entryDisabled ?? disabled}
          builtIns={builtIns}
          keyLocked={lowerKeys.has(getEntryKey(parentValue, 'key') ?? '')}
        />
      ),
    [builtIns, lowerKeys, disabled],
  );

  const add = (entry: t.ConfigRecord) => onChange([...items, entry]);

  return (
    <div className="flex w-full flex-col gap-2 px-(--settings-row-px) py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span id={`${fieldId}-label`} className="settings-label">
            {labelForPath(path, localize)}
          </span>
          <p className="settings-help m-0">{localize('com_config_ce_params_desc')}</p>
          {compact && (
            <p className="settings-help m-0">
              {localize(
                openRouterDefaults
                  ? 'com_config_ce_params_expanded_openrouter'
                  : 'com_config_ce_params_expanded',
              )}
            </p>
          )}
        </div>
        {chips && <span className="flex flex-wrap items-center gap-1.5">{chips}</span>}
      </div>
      <ArrayObjectField
        id={fieldId}
        path={path}
        value={items}
        fields={field.children ?? []}
        onChange={onChange}
        disabled={disabled}
        hideAddButton
        renderFields={renderFields}
        editSessionId={editSessionId}
        getEntryTitle={(item, index) =>
          getEntryKey(item, 'key') ?? localize('com_config_ce_param_untitled', { n: index + 1 })
        }
        renderSummary={(item) => summarize(item, localize)}
        isEntryLocked={(item) => lowerKeys.has(getEntryKey(item, 'key') ?? '')}
        emptyLabel={localize('com_config_ce_params_empty')}
      />
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          {available.length > 0 && (
            <div className="w-72 max-w-full">
              <SelectField
                id={`${fieldId}-builtin`}
                value={undefined}
                options={available.map((key) => ({ value: key, label: key }))}
                placeholder={localize('com_config_ce_param_add_builtin')}
                onChange={(key) => {
                  const builtIn = builtIns.get(key);
                  if (!builtIn) add({ key });
                  else add(compact ? compactDefinition(builtIn) : builtInDefinition(builtIn));
                }}
                aria-label={localize('com_config_ce_param_add_builtin')}
              />
            </div>
          )}
          <Button
            type="secondary"
            htmlType="button"
            iconLeft="plus"
            label={localize('com_config_ce_param_add_custom')}
            onClick={() => add({ key: '', type: 'string', component: 'input' })}
          />
        </div>
      )}
    </div>
  );
}
