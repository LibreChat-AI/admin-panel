import { useContext, useEffect, useState } from 'react';
import { ButtonGroup } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize, useFieldStates, useValuesScope, usePendingVisibility } from '@/hooks';
import { agentMode, isAgentKeyHidden, planAgentSwitch } from './state';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { NestedGroup, toFieldId } from '../../renderer';
import { UnknownSettings } from '../../UnknownSettings';
import { MEMORY_AGENT_KEYS } from '@/constants';
import { countConfigured } from '../../counts';
import { ConfigRow } from '../../ConfigRow';
import { labelForPath } from '../../meta';
import { isConfigRecord } from '@/utils';
import { FeatureFields } from './Fields';
import { RefPicker } from './Picker';

const MODES: readonly t.MemoryAgentMode[] = ['id', 'inline'];
const ENABLED_KEY = 'enabled';
/** The keys this editor places: the switch and each definition's own. */
const PLACED_KEYS: ReadonlySet<string> = new Set([
  ENABLED_KEY,
  ...MODES.flatMap((mode) => MEMORY_AGENT_KEYS[mode]),
]);
/** No definition: nothing pressed. An undefined `selected` would leave the group tracking clicks itself. */
const NO_MODE = '';

function Note({ tone = 'muted', children }: t.AgentNoteProps) {
  return (
    <p
      role={tone === 'warn' ? 'status' : undefined}
      className={
        tone === 'warn'
          ? 'm-0 text-xs text-(--settings-warn-fg)'
          : 'm-0 text-xs text-(--settings-muted-fg)'
      }
    >
      {children}
    </p>
  );
}

/**
 * The memory agent (FX-3): "Save memories automatically", then how the agent
 * is defined, either an existing agent by ID or a provider and model with
 * instructions, and only that definition's fields. LibreChat merges an
 * override over the layer beneath key by key, so switching away from a
 * definition librechat.yaml (or Base) makes hides its keys, which the save
 * writes before the new values; without permission to hide them the editor
 * says that only librechat.yaml can change it.
 */
export function MemoryAgent({ field, ...props }: t.MemoryAgentProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const visibility = usePendingVisibility();
  const rowFilter = useContext(RowFilterContext);
  const path = `${props.parentPath}.${field.key}`;
  const agentValue = props.getValue(
    path,
    isConfigRecord(props.parentValue) ? props.parentValue[field.key] : undefined,
  );
  const children = field.children ?? [];
  const [paths] = useState(() => children.map((child) => `${path}.${child.key}`));
  const states = useFieldStates(paths);
  const [chosen, setChosen] = useState<t.MemoryAgentMode | undefined>(undefined);
  const [blocked, setBlocked] = useState(false);
  /** A definition chosen without values yet belongs to its edit session: Discard or another scope forgets it. */
  useEffect(() => {
    setChosen(undefined);
    setBlocked(false);
  }, [props.editSessionId, scope?.name]);

  const hidden = new Set(
    children
      .filter((child) => {
        const childPath = `${path}.${child.key}`;
        return isAgentKeyHidden(states[childPath], visibility[childPath]);
      })
      .map((child) => child.key),
  );
  const visibleValue: t.ConfigRecord = {};
  for (const child of children) {
    if (hidden.has(child.key)) continue;
    const value = props.getValue(`${path}.${child.key}`, undefined);
    if (value !== undefined) visibleValue[child.key] = value;
  }
  const derived = agentMode(visibleValue);
  const mode = derived ?? chosen;
  const pendingHides = paths.filter((childPath) => visibility[childPath] === 'hide');
  const storedHides = paths.filter(
    (childPath) => states[childPath]?.isHidden && visibility[childPath] === undefined,
  );
  const ownsAgent =
    storedHides.length > 0 || paths.some((childPath) => states[childPath]?.isOverride);
  const lowerSource = localize(
    scope ? 'com_config_features_source_base' : 'com_config_features_source_yaml',
  );
  const keyLabels = (list: string[]) =>
    list.map((childPath) => labelForPath(childPath, localize)).join(', ');

  const switchTo = (next: string) => {
    if (next !== 'id' && next !== 'inline') return;
    if (next === mode) return;
    const plan = planAgentSwitch(next, path, states, visibility, props.editedValues);
    const cannotHide = plan.hide.length > 0 && !props.onHideField;
    if (cannotHide || (plan.show.length > 0 && !props.onUnhideField)) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    for (const keyPath of [...plan.unhide, ...plan.discard]) props.onDiscardField?.(keyPath);
    for (const keyPath of plan.reset) props.onChange(keyPath, undefined);
    for (const keyPath of plan.hide) props.onHideField?.(keyPath);
    for (const keyPath of plan.show) props.onUnhideField?.(keyPath);
    setChosen(next);
  };

  const modeFields = children.filter(
    (child) => mode !== undefined && MEMORY_AGENT_KEYS[mode].includes(child.key),
  );
  const enabledField = children.filter((child) => child.key === ENABLED_KEY);
  /** Keys a newer schema adds to the agent: shown whatever the definition, so none is lost. */
  const otherFields = children.filter((child) => !PLACED_KEYS.has(child.key));
  const provider = visibleValue.provider;
  const controls: t.FeatureControls = {
    provider: (control) => <RefPicker {...control} source="providers" requiredHint />,
    model: (control) => (
      <RefPicker
        {...control}
        source={typeof provider === 'string' && provider ? `models:${provider}` : undefined}
        requiredHint
      />
    ),
  };
  const counts = countConfigured(children, path, props.configuredPaths);
  const modeId = toFieldId(`${path}-mode`);

  return (
    <NestedGroup
      label={localize('com_config_features_memory_agent')}
      sectionId={`section-${path}`}
      configuredCount={counts.configured}
      totalCount={counts.total}
      defaultExpanded
      disabled={props.disabled}
      revealPaths={[path]}
    >
      <FeatureFields
        {...props}
        fields={enabledField}
        parentPath={path}
        parentValue={visibleValue}
      />
      <ConfigRow
        title={localize('com_config_features_memory_agent_mode')}
        description={localize('com_config_desc_memory_agent')}
        fieldId={modeId}
        fieldPath={path}
        permissions={props.permissions}
        onResetField={props.onResetField}
        onDiscardField={props.onDiscardField}
        isConfigured={props.configuredPaths?.has(path) || counts.configured > 0}
        isDbOverride={ownsAgent}
        isPendingReset={props.pendingResets?.has(path)}
        disabled={props.disabled}
      >
        <div className="flex w-full flex-col gap-2">
          <ButtonGroup
            id={modeId}
            aria-label={localize('com_config_features_memory_agent_mode')}
            className="max-w-full self-start"
            selected={mode ?? NO_MODE}
            options={MODES.map((value) => ({
              value,
              label: localize(`com_config_features_memory_mode_${value}`),
              disabled: props.disabled,
            }))}
            onClick={(value) => {
              if (!props.disabled) switchTo(value);
            }}
          />
          {mode === undefined && <Note>{localize('com_config_features_memory_mode_none')}</Note>}
          {pendingHides.length > 0 && (
            <Note>
              {localize('com_config_features_memory_hides', {
                keys: keyLabels(pendingHides),
                source: lowerSource,
              })}
            </Note>
          )}
          {storedHides.length > 0 && (
            <Note>
              {localize('com_config_features_memory_hidden', {
                keys: keyLabels(storedHides),
                source: lowerSource,
              })}
            </Note>
          )}
          {blocked && (
            <Note tone="warn">
              {localize('com_config_features_memory_blocked', { source: lowerSource })}
            </Note>
          )}
        </div>
      </ConfigRow>
      {modeFields.length > 0 && (
        <FeatureFields
          {...props}
          fields={modeFields}
          parentPath={path}
          parentValue={visibleValue}
          controls={mode === 'inline' ? controls : undefined}
        />
      )}
      {otherFields.length > 0 && (
        <FeatureFields
          {...props}
          fields={otherFields}
          parentPath={path}
          parentValue={visibleValue}
        />
      )}
      {!rowFilter && <UnknownSettings fields={children} value={agentValue} path={path} />}
    </NestedGroup>
  );
}
