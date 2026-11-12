import { Icon } from '@clickhouse/click-ui';
import { useMemo, useState, useEffect, useRef, useContext } from 'react';
import type * as t from '@/types';
import {
  MODEL_KEYS,
  PROMPT_KEYS,
  PRESET_DENYLIST,
  paramField,
  isMisplacedId,
  isForeignPresetKey,
} from './params';
import { useFieldError, useLocalize, useExpandableState } from '@/hooks';
import { INPUT_CLASSES, widthClass } from '../../fields/display';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { renderInlineField, toFieldId } from '../../renderer';
import { FieldControl } from '../../renderer/FieldControl';
import { cn, isConfigRecord, isRowVisible } from '@/utils';
import { describeField, labelForPath } from '../../meta';
import { CodeField } from '../../fields/CodeField';
import { FieldNotice } from '../../fields/Notice';
import { SettingsRow } from '../../SettingsRow';
import { specEndpoint } from './validation';
import { endpointLabelOf } from './options';
import { useSpecList } from './context';

const PICK = '\u0000pick';

/** One model parameter: the shared control with the endpoint's range, choices and default. */
function ParamRow({
  field,
  param,
  value,
  path,
  onChange,
  disabled,
  editSessionId,
}: {
  field: t.SchemaField;
  param: t.PresetParam;
  value: t.ConfigValue;
  path: string;
  onChange: (key: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  editSessionId?: number;
}) {
  const localize = useLocalize();
  const dataPath = `${path}.${param.key}`;
  const id = toFieldId(dataPath);
  const label = labelForPath(dataPath, localize);
  const error = useFieldError(dataPath);
  const shaped = paramField(field, param);
  return (
    <SettingsRow
      label={label}
      htmlFor={id}
      description={describeField(field, localize)}
      error={error}
      marker={error ? 'error' : undefined}
      control={
        <FieldControl
          field={shaped}
          path={dataPath}
          id={id}
          label={label}
          value={value}
          onChange={(next) => onChange(param.key, next)}
          onClear={() => {
            onChange(param.key, undefined);
            return true;
          }}
          fieldDefault={{
            hasOwnValue: value !== undefined,
            value: param.defaultValue,
            source: 'runtimeDefault',
          }}
          disabled={disabled}
          editSessionId={editSessionId}
        />
      }
    />
  );
}

/**
 * A spec's model parameters (MS-4), driven by LibreChat's own parameter
 * settings for its endpoint and model: only the parameters that endpoint
 * offers, with their ranges, choices and defaults. Preset fields the spec
 * sets that the endpoint doesn't offer stay listed (so they can be changed or
 * removed); "Advanced (raw)" adds any other preset field LibreChat accepts,
 * internal conversation fields excepted, or edits the preset as YAML. While
 * the tab filter is on, only the matching parameters are listed.
 */
export function PresetEditor({
  presetField,
  preset,
  params,
  path,
  onChange,
  onReplace,
  disabled,
  editSessionId,
}: t.PresetEditorProps) {
  const localize = useLocalize();
  const { options, configuredOnly } = useSpecList();
  const rowFilter = useContext(RowFilterContext);
  const [addedKeys, setAddedKeys] = useState<string[]>([]);
  const [droppedKeys, setDroppedKeys] = useState<string[]>([]);
  const [misplacedKeys, setMisplacedKeys] = useState<string[]>([]);
  const [rawOpen, setRawOpen] = useExpandableState(false);
  const focusKeyRef = useRef<string | null>(null);
  const endpoint = specEndpoint({ preset });
  const children = presetField.children ?? [];
  const byKey = useMemo(() => new Map(children.map((field) => [field.key, field])), [children]);
  const isShown = (key: string) => isRowVisible(rowFilter, `${path}.${key}`);
  const showsNotes = !configuredOnly && !rowFilter;
  const endpointLabel = endpointLabelOf(options, endpoint);

  const ownParams = new Set(params.map((param) => param.key));
  const handled = new Set([...MODEL_KEYS, ...PROMPT_KEYS, ...ownParams]);
  const others = children.filter(
    (field) =>
      !handled.has(field.key) &&
      (preset[field.key] !== undefined || addedKeys.includes(field.key)) &&
      isShown(field.key),
  );
  const pickable = children
    .filter(
      (field) =>
        !handled.has(field.key) &&
        !PRESET_DENYLIST.has(field.key) &&
        !isForeignPresetKey(field.key, endpoint, ownParams) &&
        preset[field.key] === undefined &&
        !addedKeys.includes(field.key),
    )
    .map((field) => ({
      value: field.key,
      label: localize('com_config_specs_raw_option', {
        label: labelForPath(`${path}.${field.key}`, localize),
        key: field.key,
      }),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  useEffect(() => {
    const key = focusKeyRef.current;
    if (!key) return;
    focusKeyRef.current = null;
    const el = document.getElementById(toFieldId(`${path}.${key}`));
    const target = el?.matches('input, select, textarea, button')
      ? el
      : el?.querySelector<HTMLElement>('input, select, textarea, button');
    target?.focus();
  });

  return (
    <>
      {!endpoint && showsNotes && (
        <p className="settings-group-desc">{localize('com_config_specs_params_no_endpoint')}</p>
      )}
      {endpoint && params.length === 0 && showsNotes && (
        <p className="settings-group-desc">
          {localize('com_config_specs_params_none', { endpoint: endpointLabel })}
        </p>
      )}
      {params.map((param) => {
        const field = byKey.get(param.key);
        if (!field || (configuredOnly && preset[param.key] === undefined) || !isShown(param.key)) {
          return null;
        }
        return (
          <ParamRow
            key={param.key}
            field={field}
            param={param}
            value={preset[param.key]}
            path={path}
            onChange={onChange}
            disabled={disabled}
            editSessionId={editSessionId}
          />
        );
      })}
      {others.length > 0 && (
        <>
          <p className="settings-group-desc mt-2">
            <span className="font-medium text-(--cui-color-text-default)">
              {localize('com_config_specs_params_other')}
            </span>{' '}
            {localize('com_config_specs_params_other_desc', {
              endpoint: endpointLabel || localize('com_config_specs_this_endpoint'),
            })}
          </p>
          {others.map((field) =>
            renderInlineField(
              field,
              preset,
              path,
              onChange,
              localize,
              disabled,
              undefined,
              false,
              editSessionId,
            ),
          )}
        </>
      )}
      {!disabled && showsNotes && (
        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            className="settings-row-action self-start"
            aria-expanded={rawOpen}
            aria-controls={`${toFieldId(path)}-raw`}
            onClick={() => setRawOpen((open) => !open)}
          >
            {localize('com_config_specs_raw')}
          </button>
          {rawOpen && (
            <div id={`${toFieldId(path)}-raw`} className="flex flex-col gap-3">
              <p className="m-0 text-xs text-(--cui-color-text-muted)">
                {localize('com_config_specs_raw_desc')}
              </p>
              {pickable.length > 0 && (
                <div className={cn('relative w-full', widthClass('M'))}>
                  <select
                    id={`${toFieldId(path)}-raw-add`}
                    value={PICK}
                    aria-label={localize('com_config_specs_raw_add')}
                    onChange={(event) => {
                      const key = event.target.value;
                      if (key === PICK) return;
                      focusKeyRef.current = key;
                      setAddedKeys((keys) => [...keys, key]);
                    }}
                    className={cn(INPUT_CLASSES, 'cursor-pointer appearance-none pr-8')}
                  >
                    <option value={PICK} disabled>
                      {localize('com_config_specs_raw_add')}
                    </option>
                    {pickable.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 text-(--cui-color-text-muted)"
                  >
                    <Icon name="plus" size="sm" />
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${toFieldId(path)}-yaml`}
                  className="text-xs font-medium text-(--cui-color-text-default)"
                >
                  {localize('com_config_specs_raw_yaml')}
                </label>
                <CodeField
                  id={`${toFieldId(path)}-yaml`}
                  value={preset}
                  onChange={(next) => {
                    const record = isConfigRecord(next) ? next : {};
                    const recordEndpoint = specEndpoint({ preset: record });
                    const isNew = (key: string) => preset[key] === undefined;
                    const internal = Object.keys(record).filter(
                      (key) => PRESET_DENYLIST.has(key) && isNew(key),
                    );
                    const elsewhere = Object.keys(record).filter(
                      (key) => isNew(key) && isMisplacedId(key, recordEndpoint),
                    );
                    const dropped = new Set([...internal, ...elsewhere]);
                    setDroppedKeys(internal);
                    setMisplacedKeys(elsewhere);
                    onReplace(
                      dropped.size === 0
                        ? record
                        : Object.fromEntries(
                            Object.entries(record).filter(([key]) => !dropped.has(key)),
                          ),
                    );
                  }}
                />
                {droppedKeys.length > 0 && (
                  <FieldNotice>
                    {localize('com_config_specs_raw_dropped', { keys: droppedKeys.join(', ') })}
                  </FieldNotice>
                )}
                {misplacedKeys.length > 0 && (
                  <FieldNotice>
                    {localize('com_config_specs_raw_misplaced', { keys: misplacedKeys.join(', ') })}
                  </FieldNotice>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
