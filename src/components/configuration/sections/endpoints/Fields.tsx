/**
 * Rows of the custom endpoint editor whose control the generic schema form
 * cannot pick (WS10 CE-1, CE-5, CE-9): the name (locked for endpoints the
 * layer beneath defines), the API key of a librechat.yaml endpoint (whose
 * literal key LibreChat never sends back), and pickers for the endpoint or
 * model another setting names.
 */
import { useId, useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import { EModelEndpoint, paramSettings, normalizeEndpointName } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { useLocalize, useFieldError, useFieldState, useOptionSources } from '@/hooks';
import { SecretInput, SelectField, TextField } from '../../fields';
import { layerValueBeneath } from '../../renderer/defaults';
import { fieldDescription } from '../../renderer/paths';
import { DecorativeIcon } from '@/components/shared';
import { fieldMetaFor } from '../../renderer/kinds';
import { SettingsRow } from '../../SettingsRow';
import { toFieldId } from '../../renderer';
import { labelForPath } from '../../meta';
import { TagListField } from './Request';

const CURRENT_MODEL = 'current_model';
const DEFAULT_PARAM_SET = EModelEndpoint.custom as string;

/** `bedrock-anthropic` → "Bedrock · Anthropic"; built-ins use their provider label. */
function paramSetLabel(key: string, localize: t.LocalizeFn): string {
  if (key === DEFAULT_PARAM_SET) return localize('com_config_ce_params_openai_compatible');
  if (key === 'openrouter') return 'OpenRouter';
  const [provider, variant] = key.split('-');
  const base = labelForPath(`endpoints.${provider}`, localize);
  if (!variant) return base;
  return `${base} · ${variant.charAt(0).toUpperCase()}${variant.slice(1)}`;
}

/** Parameter sets LibreChat ships (`paramSettings`), for "Parameters from". */
function paramSetOptions(localize: t.LocalizeFn): t.SelectOption[] {
  return Object.keys(paramSettings).map((key) => ({
    value: key,
    label: paramSetLabel(key, localize),
  }));
}

/** What clearing a field goes back to: the layer beneath's value when it sets one (D3), else nothing. */
function useClearTarget(path: string): t.RevertTarget | undefined {
  return layerValueBeneath(useFieldState(path));
}

/** A settings row of the endpoint editor with the field's label, help and inline error. */
function EditorRow({ path, field, required, chips, control, note }: t.EndpointEditorRowProps) {
  const localize = useLocalize();
  const error = useFieldError(path);
  return (
    <SettingsRow
      label={labelForPath(path, localize)}
      htmlFor={toFieldId(path)}
      description={fieldDescription(field, fieldMetaFor(field, path), localize)}
      required={required}
      chips={chips}
      error={error}
      control={
        <>
          {control}
          {note && <div className="text-xs text-(--cui-color-text-muted)">{note}</div>}
        </>
      }
    />
  );
}

/**
 * The endpoint's name. An endpoint the layer beneath defines keeps its name
 * (D1: LibreChat merges by name, so a rename would add a second endpoint).
 */
export function NameRow({
  path,
  field,
  value,
  locked,
  lockNote,
  warning,
  required,
  chips,
  disabled,
  onChange,
}: {
  path: string;
  field: t.SchemaField;
  value: string;
  locked: boolean;
  lockNote: string;
  warning?: string;
  required?: boolean;
  chips?: ReactNode;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const localize = useLocalize();
  const id = toFieldId(path);
  if (locked || disabled) {
    return (
      <EditorRow
        path={path}
        field={field}
        chips={chips}
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
        note={locked ? lockNote : undefined}
      />
    );
  }
  return (
    <EditorRow
      path={path}
      field={field}
      required={required}
      chips={chips}
      note={warning}
      control={
        <TextField
          id={id}
          value={value}
          onChange={onChange}
          required
          hasRowError={false}
          placeholder={localize('com_config_ce_name_placeholder')}
          aria-label={labelForPath(path, localize)}
        />
      }
    />
  );
}

/**
 * The API key of an endpoint the layer beneath defines with a literal key:
 * LibreChat redacts it on read and sends no preview, so it is not shown, not
 * marked missing, and can only be replaced (CE-9).
 */
export function HiddenKeyRow({
  path,
  field,
  value,
  chips,
  disabled,
  onChange,
}: {
  path: string;
  field: t.SchemaField;
  value: t.ConfigValue;
  chips?: ReactNode;
  disabled?: boolean;
  onChange: (value: t.ConfigValue) => void;
}) {
  const localize = useLocalize();
  const id = toFieldId(path);
  const pending = typeof value === 'string';
  const [replacing, setReplacing] = useState(pending);
  if (!replacing || disabled) {
    return (
      <EditorRow
        path={path}
        field={field}
        chips={chips}
        control={
          <div className="flex flex-wrap items-center gap-2">
            <span id={id} className="static-value text-(--cui-color-text-muted)">
              {localize('com_config_ce_key_hidden')}
            </span>
            {!disabled && (
              <Button
                type="secondary"
                htmlType="button"
                iconLeft="pencil"
                label={localize('com_config_ce_key_replace')}
                onClick={() => setReplacing(true)}
              />
            )}
          </div>
        }
        note={localize('com_config_ce_key_hidden_note')}
      />
    );
  }
  return (
    <EditorRow
      path={path}
      field={field}
      chips={chips}
      control={
        <div className="flex w-full flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <SecretInput
              id={id}
              value={typeof value === 'string' ? value : ''}
              onChange={onChange}
              onClear={() => {
                onChange(undefined);
                return true;
              }}
              autoFocus
              placeholder={localize('com_config_ce_key_placeholder')}
              aria-label={labelForPath(path, localize)}
            />
          </div>
          <Button
            type="secondary"
            htmlType="button"
            label={localize('com_ui_cancel')}
            onClick={() => {
              onChange(undefined);
              setReplacing(false);
            }}
          />
        </div>
      }
    />
  );
}

/**
 * A setting that names another endpoint (title, activity and reasoning
 * labels) or a parameter set: a select of the known ones, so a typo can't
 * reach the save. Default leaves the setting unset; a value the list doesn't
 * know is kept and shown as unknown.
 */
function ReferenceRow({
  path,
  field,
  value,
  options,
  defaultLabel,
  chips,
  disabled,
  onChange,
}: {
  path: string;
  field: t.SchemaField;
  value: t.ConfigValue;
  options: t.SelectOption[];
  defaultLabel: string;
  chips?: ReactNode;
  disabled?: boolean;
  onChange: (value: t.ConfigValue) => void;
}) {
  const localize = useLocalize();
  const clearTo = useClearTarget(path);
  const text = typeof value === 'string' ? value : undefined;
  if (disabled) {
    const label = options.find((option) => option.value === text)?.label ?? text;
    return (
      <EditorRow
        path={path}
        field={field}
        chips={chips}
        control={
          <span id={toFieldId(path)} className="static-value self-start">
            {label ?? defaultLabel}
          </span>
        }
      />
    );
  }
  return (
    <EditorRow
      path={path}
      field={field}
      chips={chips}
      control={
        <SelectField
          id={toFieldId(path)}
          value={text}
          options={options}
          onChange={onChange}
          onClear={() => {
            onChange(clearTo?.value);
            return true;
          }}
          defaultLabel={defaultLabel}
          width="M"
          aria-label={labelForPath(path, localize)}
        />
      }
    />
  );
}

/**
 * A setting that names an endpoint (`titleEndpoint`, …): the providers
 * LibreChat can hand the work to (built-in providers and custom endpoints),
 * except the endpoint being edited, matched by the name LibreChat serves it
 * under (the options' values: `Ollama` is served as `ollama`).
 */
export function EndpointRefRow({
  self,
  ...props
}: {
  path: string;
  field: t.SchemaField;
  value: t.ConfigValue;
  /** Name of the endpoint being edited, which is not offered. */
  self: string;
  chips?: ReactNode;
  disabled?: boolean;
  onChange: (value: t.ConfigValue) => void;
}) {
  const localize = useLocalize();
  const { options: providers } = useOptionSources('providers');
  const served = normalizeEndpointName(self);
  const options = providers.filter((option) => option.value !== served);
  return (
    <ReferenceRow
      {...props}
      options={options}
      defaultLabel={localize('com_config_ce_ref_default_endpoint')}
    />
  );
}

/** "Parameters from": which built-in parameter panel the endpoint's users get. */
export function ParamSetRow({ openRouter = false, ...props }: t.ParamSetRowProps) {
  const localize = useLocalize();
  const options = paramSetOptions(localize).filter((option) => option.value !== DEFAULT_PARAM_SET);
  return (
    <ReferenceRow
      {...props}
      options={options}
      defaultLabel={localize(
        openRouter ? 'com_config_ce_params_default_openrouter' : 'com_config_ce_params_default',
      )}
    />
  );
}

/**
 * A setting that names a model (`titleModel`, …): a text input suggesting
 * "current_model" (the conversation's own model), the default models of the
 * endpoint it names, and that endpoint's fetched models (WS9's
 * `models:<endpoint>` source). Any other model id can be typed.
 */
export function ModelRefRow({
  path,
  field,
  value,
  endpointName,
  models,
  chips,
  disabled,
  onChange,
}: {
  path: string;
  field: t.SchemaField;
  value: t.ConfigValue;
  endpointName: string;
  models: readonly string[];
  chips?: ReactNode;
  disabled?: boolean;
  onChange: (value: t.ConfigValue) => void;
}) {
  const localize = useLocalize();
  const listId = useId();
  const clearTo = useClearTarget(path);
  const { options: fetched } = useOptionSources(
    endpointName ? `models:${endpointName}` : undefined,
  );
  const text = typeof value === 'string' ? value : undefined;
  const suggestions = [
    ...new Set([CURRENT_MODEL, ...models, ...fetched.map((option) => option.value)]),
  ].filter((model) => model.trim() !== '');
  if (disabled) {
    return (
      <EditorRow
        path={path}
        field={field}
        chips={chips}
        control={
          <span id={toFieldId(path)} data-static-value className="static-value self-start">
            {text === CURRENT_MODEL
              ? localize('com_config_ce_current_model')
              : (text ?? localize('com_config_ce_model_default'))}
          </span>
        }
      />
    );
  }
  const fallback = typeof clearTo?.value === 'string' ? clearTo.value : undefined;
  return (
    <EditorRow
      path={path}
      field={field}
      chips={chips}
      note={text === CURRENT_MODEL ? localize('com_config_ce_current_model_note') : undefined}
      control={
        <>
          <TextField
            id={toFieldId(path)}
            value={text ?? ''}
            list={listId}
            onChange={onChange}
            onClear={() => {
              onChange(clearTo?.value);
              return true;
            }}
            placeholder={
              fallback
                ? localize('com_config_ctl_placeholder_default', { value: fallback })
                : localize('com_config_ce_model_placeholder')
            }
            width="M"
            aria-label={labelForPath(path, localize)}
          />
          <datalist id={listId}>
            {suggestions.map((model) => (
              <option key={model} value={model}>
                {model === CURRENT_MODEL ? localize('com_config_ce_current_model') : model}
              </option>
            ))}
          </datalist>
        </>
      }
    />
  );
}

/** Parameters dropped from every request, as tags (CE-7). Removing the last one clears the setting. */
export function DropParamsRow({
  path,
  field,
  value,
  chips,
  disabled,
  onChange,
}: {
  path: string;
  field: t.SchemaField;
  value: t.ConfigValue;
  chips?: ReactNode;
  disabled?: boolean;
  onChange: (value: t.ConfigValue) => void;
}) {
  const localize = useLocalize();
  const clearTo = useClearTarget(path);
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
  return (
    <EditorRow
      path={path}
      field={field}
      chips={chips}
      control={
        disabled && values.length === 0 ? (
          <span data-static-value className="static-value static-value-unset self-start">
            {localize('com_config_ce_drop_params_none')}
          </span>
        ) : (
          <TagListField
            id={toFieldId(path)}
            values={values}
            onChange={onChange}
            onClear={() => onChange(clearTo?.value)}
            disabled={disabled}
            aria-label={labelForPath(path, localize)}
          />
        )
      }
    />
  );
}
