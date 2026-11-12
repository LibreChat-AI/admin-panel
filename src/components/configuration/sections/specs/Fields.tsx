import { ButtonGroup } from '@clickhouse/click-ui';
import { EModelEndpoint, normalizeEndpointName } from 'librechat-data-provider';
import { useId, useRef, useState, useEffect, useContext } from 'react';
import type { FocusEvent, MouseEvent } from 'react';
import type * as t from '@/types';
import { problemAt, specEndpoint, ASSISTANT_ENDPOINTS, SPEC_LIST_PATH } from './validation';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { ConfirmChoiceDialog } from '../../fields/ConfirmChoice';
import { uniqueOptions, endpointLabelOf } from './options';
import { describeField, labelForPath } from '../../meta';
import { useLocalize, useOptionSources } from '@/hooks';
import { endpointGroups, mcpGroups } from './groups';
import { TextField } from '../../fields/TextField';
import { isConfigRecord, stringOf } from '@/utils';
import { GroupedSelect } from './GroupedSelect';
import { toFieldId } from '../../renderer';
import { ChipPicker } from './ChipPicker';
import { presetParams } from './params';
import { useSpecList } from './context';
import { SpecFieldRow } from './Row';
import { SpecIcon } from './Icon';

/** "OpenAI GPT-5" → "openai-gpt-5", made unique among the other specs' names. */
export function slugify(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'spec';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function otherNames(items: t.ConfigValue[], index: number): Set<string> {
  return new Set(
    items.flatMap((item, i) =>
      i !== index && isConfigRecord(item) && typeof item.name === 'string' ? [item.name] : [],
    ),
  );
}

/** A spec added in this session (not one the list was loaded with, whatever it is named now). */
function useIsNewSpec(index: number): boolean {
  return useSpecList().addedIndexes.has(index);
}

function useRowLabel(path: string, field?: t.SchemaField) {
  const localize = useLocalize();
  return {
    label: labelForPath(path, localize),
    description: field ? describeField(field, localize) : undefined,
  };
}

/** Whether a new spec's name is still the one derived from its label (so the label keeps deriving it). */
function useNameFollowsLabel(spec: t.ConfigRecord, index: number): boolean {
  const { items, addedIndexes } = useSpecList();
  const name = stringOf(spec.name);
  return (
    addedIndexes.has(index) &&
    (name === '' || name === slugify(stringOf(spec.label), otherNames(items, index)))
  );
}

/**
 * Label*: the name the model menu shows. On a new spec whose name still
 * follows the label, the name is derived from it ("GPT 5 mini" → "gpt-5-mini").
 */
export function LabelField({ field, spec, index, path, onChange, disabled }: t.SpecFieldProps) {
  const localize = useLocalize();
  const { items, problems } = useSpecList();
  const isNew = useIsNewSpec(index);
  const dataPath = `${path}.label`;
  const { label, description } = useRowLabel(dataPath, field);
  const followsLabel = useNameFollowsLabel(spec, index);
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      required
      problem={problemAt(problems, index, 'label')}
      quietWhenEmpty={isNew && stringOf(spec.label).trim() === ''}
      control={
        <TextField
          id={toFieldId(dataPath)}
          value={stringOf(spec.label)}
          required
          hasRowError={problemAt(problems, index, 'label') != null}
          disabled={disabled}
          placeholder={localize('com_config_specs_label_placeholder')}
          onChange={(next) => {
            onChange('label', next);
            if (followsLabel && next.trim() !== '') {
              onChange('name', slugify(next, otherNames(items, index)));
            }
          }}
        />
      }
    />
  );
}

/**
 * The name a spec was loaded with in this edit session: its pending edit's
 * origin, or its current name while the list has no pending edit (so it
 * follows saves, Discard and scope changes). Undefined for a spec added since.
 */
function useLoadedName(spec: t.ConfigRecord, index: number): string | undefined {
  const edit = useContext(CollectionEditsContext)[SPEC_LIST_PATH];
  return edit ? edit.origins[index]?.identity : stringOf(spec.name);
}

/**
 * Name*: the id conversations and `?spec=` links use; renaming a saved spec
 * says what it breaks. While a new spec's name is still derived from its
 * label, focusing it selects the derived name (also when the label commits
 * as focus moves here), so typing replaces it instead of appending to it.
 */
export function NameField({ field, spec, index, path, onChange, disabled }: t.SpecFieldProps) {
  const localize = useLocalize();
  const { problems, savedNames } = useSpecList();
  const isNew = useIsNewSpec(index);
  const followsLabel = useNameFollowsLabel(spec, index);
  const loadedName = useLoadedName(spec, index);
  const keepSelectionRef = useRef(false);
  const dataPath = `${path}.name`;
  const inputId = toFieldId(dataPath);
  const name = stringOf(spec.name);
  const { label, description } = useRowLabel(dataPath, field);
  const problem = problemAt(problems, index, 'name');
  const renamed =
    loadedName !== undefined &&
    loadedName !== '' &&
    savedNames.has(loadedName) &&
    name !== loadedName;
  const warningId = `${inputId}-rename`;

  useEffect(() => {
    if (!followsLabel) return;
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement && document.activeElement === input) input.select();
  }, [followsLabel, inputId, name]);

  const selectDerived = (event: FocusEvent<HTMLDivElement>) => {
    if (!followsLabel || !(event.target instanceof HTMLInputElement)) return;
    event.target.select();
    keepSelectionRef.current = true;
  };
  /** The click that focused the input would otherwise collapse the selection to a caret. */
  const keepSelection = (event: MouseEvent<HTMLDivElement>) => {
    if (!keepSelectionRef.current) return;
    keepSelectionRef.current = false;
    event.preventDefault();
  };

  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      required
      problem={problem}
      quietWhenEmpty={isNew && name.trim() === ''}
      control={
        <div
          className="flex w-full flex-col gap-1"
          onFocus={selectDerived}
          onMouseUp={keepSelection}
        >
          <TextField
            id={inputId}
            value={name}
            required
            hasRowError={problem != null}
            disabled={disabled}
            placeholder={localize('com_config_specs_name_placeholder')}
            aria-describedby={renamed ? warningId : undefined}
            onChange={(next) => onChange('name', next)}
          />
          {renamed && (
            <p id={warningId} className="m-0 text-xs text-(--settings-warn-fg)">
              {localize('com_config_specs_rename_warning', { name: loadedName })}
            </p>
          )}
        </div>
      }
    />
  );
}

/** Icon: an image URL or a provider name, with a preview of what the model menu shows. */
export function IconField({
  field,
  spec,
  path,
  onChange,
  disabled,
  keyName = 'iconURL',
}: t.SpecIconFieldProps) {
  const localize = useLocalize();
  const listId = useId();
  const { options } = useSpecList();
  const dataPath = `${path}.${keyName}`;
  const { label, description } = useRowLabel(dataPath, field);
  const value = stringOf(spec[keyName]);
  const title = stringOf(keyName === 'groupIcon' ? spec.group : spec.label) || label;
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      width="L"
      control={
        <div className="flex items-center gap-2">
          <SpecIcon iconURL={value} label={title} size="md" />
          <TextField
            id={toFieldId(dataPath)}
            value={value}
            list={listId}
            disabled={disabled}
            width="L"
            placeholder={localize('com_config_specs_icon_placeholder')}
            onChange={(next) => onChange(keyName, next)}
            onClear={() => {
              onChange(keyName, undefined);
              return true;
            }}
          />
          <datalist id={listId}>
            {options.endpoints
              .filter((option) => !options.customEndpoints.has(option.value))
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
          </datalist>
        </div>
      }
    />
  );
}

/** Group: a group the other specs use, an endpoint name (nests the spec under it), or a new name. */
export function GroupField({
  field,
  spec,
  path,
  onChange,
  disabled,
}: Omit<t.SpecFieldProps, 'index'>) {
  const localize = useLocalize();
  const listId = useId();
  const { options } = useSpecList();
  const dataPath = `${path}.group`;
  const { label, description } = useRowLabel(dataPath, field);
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      control={
        <>
          <TextField
            id={toFieldId(dataPath)}
            value={stringOf(spec.group)}
            list={listId}
            disabled={disabled}
            placeholder={localize('com_config_ctl_ref_placeholder')}
            onChange={(next) => onChange('group', next)}
            onClear={() => {
              onChange('group', undefined);
              return true;
            }}
          />
          <datalist id={listId}>
            {options.groups.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </datalist>
        </>
      }
    />
  );
}

/**
 * Preset parameters the old endpoint offers and the new one doesn't (Top K
 * and Thinking budget when an Anthropic spec switches to OpenAI).
 */
function strandedParams(
  preset: t.ConfigRecord,
  from: string,
  to: string,
  options: t.SpecOptions,
): string[] {
  if (!from || from === to) return [];
  const model = stringOf(preset.model);
  const keys = new Set(Object.keys(preset));
  const before = presetParams(from, model, options.customEndpoint(from), keys).params;
  const after = new Set(
    presetParams(to, model, options.customEndpoint(to), keys).params.map((param) => param.key),
  );
  return before.map((param) => param.key).filter((key) => !after.has(key));
}

/**
 * Endpoint*: a built-in provider or a custom endpoint; one the configuration
 * lacks is flagged. A preset naming only an agent shows the agents endpoint
 * LibreChat infers for it. Switching to an endpoint that doesn't offer
 * parameters the preset sets asks whether to remove them; leaving the agents
 * endpoint clears the agent ID, and leaving the assistants endpoints the
 * assistant ID: only those specs use (and show) them.
 */
export function EndpointField({
  field,
  spec,
  index,
  path,
  onPresetChange,
  disabled,
}: t.SpecPresetFieldProps) {
  const localize = useLocalize();
  const { options, problems } = useSpecList();
  const [switching, setSwitching] = useState<{ to: string; stranded: string[] } | null>(null);
  const dataPath = `${path}.preset.endpoint`;
  const { label, description } = useRowLabel(dataPath, field);
  const preset = isConfigRecord(spec.preset) ? spec.preset : {};
  const problem = problemAt(problems, index, 'preset.endpoint');
  const isNew = useIsNewSpec(index);
  const endpoint = stringOf(preset.endpoint) || specEndpoint(spec);
  /** LibreChat resolves a preset's endpoint by its served name, so "Ollama" is the "ollama" choice. */
  const served = normalizeEndpointName(endpoint);
  const shown = options.knownEndpoints.has(served) ? served : endpoint;
  const labelOf = (name: string) => endpointLabelOf(options, name);
  const paramLabel = (key: string) => labelForPath(`${path}.preset.${key}`, localize);

  const switchTo = (next: string, removed: readonly string[] = []) => {
    onPresetChange('endpoint', next);
    removed.forEach((key) => onPresetChange(key, undefined));
    if (next !== EModelEndpoint.agents && preset.agent_id !== undefined) {
      onPresetChange('agent_id', undefined);
    }
    if (!ASSISTANT_ENDPOINTS.has(next) && preset.assistant_id !== undefined) {
      onPresetChange('assistant_id', undefined);
    }
    setSwitching(null);
  };

  return (
    <>
      <SpecFieldRow
        path={dataPath}
        label={label}
        description={description}
        required
        problem={problem}
        quietWhenEmpty={isNew && endpoint.trim() === ''}
        control={
          <GroupedSelect
            id={toFieldId(dataPath)}
            value={shown || undefined}
            groups={endpointGroups(options, localize)}
            required
            disabled={disabled}
            placeholder={localize('com_config_specs_endpoint_placeholder')}
            unknownLabel={(name) => localize('com_config_specs_not_configured', { name })}
            aria-describedby={
              problem?.level === 'warning' ? `${toFieldId(dataPath)}-warning` : undefined
            }
            onChange={(next) => {
              const stranded = strandedParams(preset, endpoint, next, options);
              if (stranded.length === 0) switchTo(next);
              else setSwitching({ to: next, stranded });
            }}
          />
        }
      />
      {switching && (
        <ConfirmChoiceDialog
          open
          title={localize('com_config_specs_switch_title', { endpoint: labelOf(switching.to) })}
          onCancel={() => setSwitching(null)}
          actions={[
            {
              label: localize('com_config_specs_switch_keep'),
              type: 'secondary',
              onSelect: () => switchTo(switching.to),
            },
            {
              label: localize('com_config_specs_switch_remove'),
              onSelect: () => switchTo(switching.to, switching.stranded),
            },
          ]}
        >
          <p className="m-0">
            {localize('com_config_specs_switch_body', {
              endpoint: labelOf(switching.to),
              params: switching.stranded.map(paramLabel).join(', '),
            })}
          </p>
        </ConfirmChoiceDialog>
      )}
    </>
  );
}

/** Model*: free text with the endpoint's known models suggested (fetched models can't be listed here). */
export function ModelField({
  field,
  spec,
  index,
  path,
  onPresetChange,
  disabled,
}: t.SpecPresetFieldProps) {
  const localize = useLocalize();
  const listId = useId();
  const { options, problems } = useSpecList();
  const preset = isConfigRecord(spec.preset) ? spec.preset : {};
  const endpoint = specEndpoint(spec);
  const source = useOptionSources(endpoint ? `models:${endpoint}` : undefined);
  const suggestions = uniqueOptions([...options.modelsFor(endpoint), ...source.options]);
  const dataPath = `${path}.preset.model`;
  const { label, description } = useRowLabel(dataPath, field);
  const problem = problemAt(problems, index, 'preset.model');
  const isNew = useIsNewSpec(index);
  /** An assistant brings its own model. */
  const required = !ASSISTANT_ENDPOINTS.has(endpoint);
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      required={required}
      problem={problem}
      quietWhenEmpty={isNew && stringOf(preset.model).trim() === ''}
      control={
        <>
          <TextField
            id={toFieldId(dataPath)}
            value={stringOf(preset.model)}
            list={listId}
            required={required}
            hasRowError={problem != null}
            disabled={disabled}
            placeholder={localize('com_config_specs_model_placeholder')}
            onChange={(next) => onPresetChange('model', next)}
          />
          <datalist id={listId}>
            {suggestions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </datalist>
        </>
      }
    />
  );
}

/** Agent ID*: the agent an agents-endpoint spec runs (its model comes from the agent). */
export function AgentField({
  field,
  spec,
  index,
  path,
  onPresetChange,
  disabled,
}: t.SpecPresetFieldProps) {
  const { problems } = useSpecList();
  const preset = isConfigRecord(spec.preset) ? spec.preset : {};
  const dataPath = `${path}.preset.agent_id`;
  const { label, description } = useRowLabel(dataPath, field);
  const problem = problemAt(problems, index, 'preset.agent_id');
  const isNew = useIsNewSpec(index);
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      required
      problem={problem}
      quietWhenEmpty={isNew && stringOf(preset.agent_id).trim() === ''}
      control={
        <TextField
          id={toFieldId(dataPath)}
          value={stringOf(preset.agent_id)}
          required
          hasRowError={problem != null}
          disabled={disabled}
          onChange={(next) => onPresetChange('agent_id', next)}
        />
      }
    />
  );
}

const DEFAULT_KINDS: readonly t.SpecDefaultKind[] = ['none', 'soft', 'default'];

/** Default for new chats: No, Soft default or Default; choosing one moves it off any other spec. */
export function DefaultField({ spec, index, path, disabled }: Omit<t.SpecFieldProps, 'onChange'>) {
  const localize = useLocalize();
  const { problems, actions } = useSpecList();
  const dataPath = `${path}.default`;
  const kind: t.SpecDefaultKind = (() => {
    if (spec.default === true) return 'default';
    return spec.softDefault === true ? 'soft' : 'none';
  })();
  const problem =
    problemAt(problems, index, 'default') ?? problemAt(problems, index, 'softDefault');
  const label = localize('com_config_specs_default');
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={localize('com_config_specs_default_desc')}
      problem={problem}
      matchPaths={[`${path}.softDefault`]}
      control={
        <div id={toFieldId(`${path}.softDefault`)} className="flex max-w-full self-start">
          <ButtonGroup
            id={toFieldId(dataPath)}
            aria-label={label}
            className="max-w-full"
            options={DEFAULT_KINDS.map((value) => ({
              value,
              label: localize(`com_config_specs_default_${value}`),
              disabled,
            }))}
            selected={kind}
            onClick={(next) => {
              if (disabled || next === kind) return;
              actions.setDefault(index, next as t.SpecDefaultKind);
            }}
          />
        </div>
      }
    />
  );
}

/** MCP servers: picked from the servers the configuration defines. */
export function McpField({
  field,
  spec,
  path,
  onChange,
  disabled,
}: Omit<t.SpecFieldProps, 'index'>) {
  const localize = useLocalize();
  const { options } = useSpecList();
  const dataPath = `${path}.mcpServers`;
  const { label, description } = useRowLabel(dataPath, field);
  const values = Array.isArray(spec.mcpServers)
    ? spec.mcpServers.filter((item): item is string => typeof item === 'string')
    : [];
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      width="L"
      control={
        <ChipPicker
          id={toFieldId(dataPath)}
          values={values}
          groups={mcpGroups(options, localize)}
          disabled={disabled}
          onChange={(next) => onChange('mcpServers', next)}
          onClear={() => {
            onChange('mcpServers', undefined);
            return true;
          }}
          addLabel={localize('com_config_specs_mcp_add')}
          unknownLabel={(name) => localize('com_config_specs_not_configured', { name })}
          aria-label={label}
        />
      }
    />
  );
}
