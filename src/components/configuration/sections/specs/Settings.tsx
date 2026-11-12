import { useContext } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { normalizeEndpointName } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  cn,
  isRowVisible,
  stringItems,
  isSetByLayer,
  isConfigRecord,
  deriveSpecControl,
  selectsHiddenEndpoint,
  foldsEndpointReferences,
} from '@/utils';
import {
  useLocalize,
  useFieldState,
  useValuesScope,
  useHiddenEntries,
  useConfigContract,
} from '@/hooks';
import { DecorativeIcon, StateChip } from '@/components/shared';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { hasPathOrDescendant } from '../../renderer/paths';
import { SettingsRow } from '../../SettingsRow';
import { FieldProvenance } from '../../values';
import { ConfigRow } from '../../ConfigRow';
import { endpointLabelOf } from './options';
import { endpointGroups } from './groups';
import { ChipPicker } from './ChipPicker';
import { SpecNote } from './Note';

const ENFORCE = 'modelSpecs.enforce';
const PRIORITIZE = 'modelSpecs.prioritize';
const ADDED = 'modelSpecs.addedEndpoints';
const MODEL_SELECT = 'interface.modelSelect';

const MODES: readonly t.SpecSelectionMode[] = ['enforce', 'prioritize', 'endpoints'];

/** `enforce`/`prioritize` each mode stands for. */
const MODE_VALUES: Record<t.SpecSelectionMode, { enforce: boolean; prioritize: boolean }> = {
  enforce: { enforce: true, prioritize: true },
  prioritize: { enforce: false, prioritize: true },
  endpoints: { enforce: false, prioritize: false },
};

function asBool(value: t.ConfigValue, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function modeOf(enforce: boolean, prioritize: boolean): t.SpecSelectionMode {
  if (enforce) return 'enforce';
  return prioritize ? 'prioritize' : 'endpoints';
}

/** Layer sources from the bottom up, to find what the other flag holds at a layer. */
const LAYER_ORDER: readonly t.ProvenanceSource[] = [
  'default',
  'runtimeDefault',
  'yaml',
  'admin',
  'inherited',
  'scope',
];

/** A flag's value at `source`: its own layer there, else the nearest one beneath. */
function flagAt(stack: readonly t.FieldLayer[], source: t.ProvenanceSource, fallback: boolean) {
  const rank = LAYER_ORDER.indexOf(source);
  const below = stack.filter((layer) => LAYER_ORDER.indexOf(layer.source) <= rank);
  return asBool(below[below.length - 1]?.value, fallback);
}

/**
 * The mode each layer of the chip's flag selects ("Default: Specs first ·
 * librechat.yaml: Specs only"), read with the other flag at the same layer,
 * instead of the flag's own On/Off.
 */
function modeLayerFormatter(
  enforce: t.FieldState,
  prioritize: t.FieldState,
  localize: t.LocalizeFn,
): (layer: t.FieldLayer) => string {
  return (layer) => {
    const mode = modeOf(
      flagAt(enforce.stack ?? [], layer.source, false),
      flagAt(prioritize.stack ?? [], layer.source, true),
    );
    return localize(`com_config_specs_mode_${mode}`);
  };
}

/**
 * Whether the endpoint menu shows: `interface.modelSelect` when set, else
 * what LibreChat derives with specs configured (on only with added
 * endpoints). Before `specInterfaceRederive`, LibreChat derived it once, from
 * librechat.yaml's specs, so the value it serves (`value`) stands; once it
 * derives it again from the specs served (`derives`), a value no layer sets
 * follows the specs shown here.
 */
function modelSelectOn(
  value: t.ConfigValue,
  specCount: number,
  added: number,
  derives: boolean,
): boolean {
  if (typeof value === 'boolean' && !derives) return value;
  return deriveSpecControl('modelSelect', specCount, added);
}

/** "Users will see: 3 specs, plus OpenAI and Agents in the endpoint menu. 1 more is hidden." */
export function previewText(
  localize: t.LocalizeFn,
  { items, mode, menuOn, added, addsNone = false }: t.SpecsPreviewInput,
): string {
  if (items.length === 0) {
    return localize(
      menuOn ? 'com_config_specs_preview_none' : 'com_config_specs_preview_none_menu_off',
    );
  }
  const hidden = items.filter((spec) => isConfigRecord(spec) && spec.showInMenu === false).length;
  const specs = localize('com_config_specs_preview_specs', { count: items.length - hidden });
  const sentence = (() => {
    if (mode === 'enforce') return localize('com_config_specs_preview_enforce', { specs });
    if (!menuOn) return localize('com_config_specs_preview_menu_off', { specs });
    if (added.length > 0) {
      return localize('com_config_specs_preview_added', { specs, endpoints: added.join(', ') });
    }
    if (addsNone) return localize('com_config_specs_preview_added_none', { specs });
    return localize('com_config_specs_preview_all', { specs });
  })();
  if (hidden === 0) return sentence;
  return `${sentence} ${localize('com_config_specs_preview_hidden', { count: hidden })}`;
}

/** Enforce and Prioritize as one setting: set by mode, with their pending and overridden paths. */
function useModeState(
  onChange: t.FieldRendererProps['onChange'],
  onDiscard?: (path: string) => void,
) {
  const enforce = useFieldState(ENFORCE);
  const prioritize = useFieldState(PRIORITIZE);
  const states: Array<[string, t.FieldState]> = [
    [ENFORCE, enforce],
    [PRIORITIZE, prioritize],
  ];
  /**
   * Sets one flag to `desired` with the fewest stored changes: back to its
   * saved value drops the pending edit; back to what lies beneath removes the
   * override; anything else is an edit.
   */
  const apply = (path: string, state: t.FieldState, fallback: boolean, desired: boolean) => {
    const saved = asBool(state.effective, fallback);
    const lower = state.isOverride ? asBool(state.revertTarget?.value, fallback) : saved;
    if (desired === saved && !state.isPendingReset) {
      if (state.isEdited) {
        if (onDiscard) onDiscard(path);
        else onChange(path, saved);
      }
      return;
    }
    onChange(path, state.isOverride && desired === lower ? undefined : desired);
  };
  const setMode = (mode: t.SpecSelectionMode) => {
    const values = MODE_VALUES[mode];
    apply(ENFORCE, enforce, false, values.enforce);
    apply(PRIORITIZE, prioritize, true, values.prioritize);
  };
  const overridden = states.filter(([, state]) => state.isOverride).map(([path]) => path);
  const edited = states.filter(([, state]) => state.isEdited).map(([path]) => path);
  return { setMode, overridden, edited, enforce, prioritize };
}

/**
 * "How users pick models" (MS-3): Specs only, Specs first or Endpoints first
 * in place of the raw Enforce and Prioritize switches; the endpoints listed
 * next to the specs, picked from the configured ones; and a line saying what
 * users will see.
 */
export function SpecsSettings({
  items,
  options,
  getValue,
  onChange,
  onResetField,
  onDiscardField,
  disabled,
  permissions,
  configuredPaths,
  dbOverridePaths,
  pendingResets,
  showConfiguredOnly,
}: t.SpecsSettingsProps) {
  const localize = useLocalize();
  const contract = useConfigContract();
  /** A server that folds endpoint references matches `Ollama` to `ollama`: neither spelling "never matches". */
  const foldsNames = foldsEndpointReferences(contract);
  const { specInterfaceRederive } = contract.features;
  const navigate = useNavigate();
  const scope = useValuesScope();
  const rowFilter = useContext(RowFilterContext);
  const modeState = useModeState(onChange, onDiscardField);
  const { setMode, overridden, edited } = modeState;
  const enforce = asBool(getValue(ENFORCE, undefined), false);
  const prioritize = asBool(getValue(PRIORITIZE, undefined), true);
  const mode = modeOf(enforce, prioritize);
  const added = stringItems(getValue(ADDED, undefined));
  /** What the profile's members get: LibreChat leaves out the specs and added endpoints it hides (`keyedTombstones`). */
  const { hidden: hiddenEndpoints } = useHiddenEntries('endpoints.custom');
  const hiddenIds = new Set(hiddenEndpoints.keys());
  const servedItems = items.filter((spec) => !selectsHiddenEndpoint(spec, hiddenIds));
  const servedAdded = added.filter((name) => !hiddenIds.has(normalizeEndpointName(name)));
  /**
   * The endpoint menu: LibreChat derives an unset `modelSelect` from the configured specs when it
   * loads, and a profile's hides don't change that, unless the server derives it again after the
   * merge (`specInterfaceRederive`), from the specs and added endpoints the members are served.
   */
  const modelSelectState = useFieldState(MODEL_SELECT);
  const derivesMenu = specInterfaceRederive && !isSetByLayer(modelSelectState);
  const menuOn = modelSelectOn(
    getValue(MODEL_SELECT, undefined),
    derivesMenu ? servedItems.length : items.length,
    derivesMenu ? servedAdded.length : added.length,
    derivesMenu,
  );
  const canEdit = !disabled && permissions?.canEdit !== false;
  const isShown = (path: string) =>
    isRowVisible(rowFilter, path) &&
    (!showConfiguredOnly || hasPathOrDescendant(path, configuredPaths));
  const showsMode = isShown(ENFORCE) || isShown(PRIORITIZE);

  const goToModelSelect = () =>
    navigate({
      to: '/configuration',
      search: (prev: t.ConfigSearchParams) => ({ ...prev, tab: 'features', field: MODEL_SELECT }),
    });
  const modelSelectLink = (
    <button type="button" className="settings-row-action" onClick={goToModelSelect}>
      {localize('com_config_specs_open_model_select')}
    </button>
  );

  const modeChips = (): ReactNode => {
    if (edited.length > 0) {
      return (
        <StateChip
          kind="edited"
          description={localize('com_config_ui_state_edited_desc')}
          onUndo={onDiscardField ? () => edited.forEach((path) => onDiscardField(path)) : undefined}
          undoLabel={localize('com_config_ui_undo_change', {
            name: localize('com_config_specs_mode'),
          })}
        />
      );
    }
    return (
      <FieldProvenance
        path={overridden[0] ?? (enforce ? ENFORCE : PRIORITIZE)}
        hideDefault
        formatLayer={modeLayerFormatter(modeState.enforce, modeState.prioritize, localize)}
      />
    );
  };

  const modeRevert =
    canEdit && onResetField && overridden.length > 0 && edited.length === 0 ? (
      <button
        type="button"
        className="settings-row-action"
        onClick={() => overridden.forEach((path) => onResetField(path))}
      >
        {localize(scope ? 'com_config_specs_mode_revert_scope' : 'com_config_specs_mode_revert')}
      </button>
    ) : null;

  const addedState = useFieldState(ADDED);
  const isDbOverride = hasPathOrDescendant(ADDED, dbOverridePaths);
  const isConfigured = hasPathOrDescendant(ADDED, configuredPaths);

  return (
    <>
      {showsMode && (
        <SettingsRow
          label={localize('com_config_specs_mode')}
          description={localize('com_config_specs_mode_desc')}
          width="L"
          marker={edited.length > 0 ? 'edited' : undefined}
          chips={modeChips()}
          actions={modeRevert}
          control={
            <fieldset
              id="modelSpecs-mode"
              aria-label={localize('com_config_specs_mode')}
              disabled={!canEdit}
              className="m-0 flex min-w-0 flex-col gap-2 border-none p-0"
            >
              {MODES.map((value) => (
                <label
                  key={value}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg border border-solid px-3 py-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-(--cui-color-outline)',
                    value === mode
                      ? 'border-(--settings-accent) bg-(--settings-accent-bg)'
                      : 'border-(--cui-color-stroke-default)',
                    canEdit
                      ? 'cursor-pointer hover:border-(--cui-color-stroke-intense)'
                      : 'cursor-default',
                  )}
                >
                  <input
                    type="radio"
                    name="modelSpecs-mode"
                    value={value}
                    checked={value === mode}
                    onChange={() => setMode(value)}
                    aria-labelledby={`modelSpecs-mode-${value}-title`}
                    aria-describedby={`modelSpecs-mode-${value}-desc`}
                    className="mt-0.5 size-4 shrink-0 accent-(--settings-accent-solid-bg) outline-none"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span
                      id={`modelSpecs-mode-${value}-title`}
                      className="text-sm font-medium text-(--cui-color-text-default)"
                    >
                      {localize(`com_config_specs_mode_${value}`)}
                    </span>
                    <span
                      id={`modelSpecs-mode-${value}-desc`}
                      className={cn(
                        'text-xs',
                        value === mode
                          ? 'text-(--cui-color-text-default)'
                          : 'text-(--cui-color-text-muted)',
                      )}
                    >
                      {localize(
                        value === 'enforce' && items.length === 0
                          ? 'com_config_specs_mode_enforce_desc_empty'
                          : `com_config_specs_mode_${value}_desc`,
                      )}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          }
        />
      )}
      {showsMode && enforce && !prioritize && (
        <SpecNote tone="warning">{localize('com_config_specs_mode_mixed')}</SpecNote>
      )}
      {servedItems.length === 0 && !menuOn && (
        <SpecNote tone="warning" action={modelSelectLink}>
          {localize('com_config_specs_empty_menu_off')}
        </SpecNote>
      )}
      {showsMode && mode === 'enforce' && servedItems.length === 0 && menuOn && (
        <SpecNote tone="info">{localize('com_config_specs_enforce_empty')}</SpecNote>
      )}
      {showsMode && mode === 'enforce' && servedItems.length > 0 && menuOn && (
        <SpecNote tone="warning" action={modelSelectLink}>
          {localize('com_config_specs_enforce_menu_on')}
        </SpecNote>
      )}
      {isShown(ADDED) && (
        <ConfigRow
          title={localize('com_config_specs_added')}
          description={localize('com_config_specs_added_desc')}
          fieldId="modelSpecs-addedEndpoints"
          fieldPath={ADDED}
          permissions={permissions}
          onResetField={onResetField}
          onDiscardField={onDiscardField}
          isConfigured={isConfigured}
          isDbOverride={isDbOverride}
          isPendingReset={pendingResets?.has(ADDED)}
          disabled={!canEdit}
          controlWidth="L"
        >
          <ChipPicker
            id="modelSpecs-addedEndpoints"
            values={added}
            groups={endpointGroups(options, localize)}
            disabled={!canEdit}
            onChange={(next) => onChange(ADDED, next)}
            onClear={() => {
              if (isDbOverride) {
                onChange(ADDED, undefined);
                return true;
              }
              /** librechat.yaml (or, in a profile, Base) sets the list: it can't be emptied here (D3). */
              if (addedState.effective !== undefined) return false;
              onChange(ADDED, undefined);
              return true;
            }}
            addLabel={localize('com_config_specs_added_add')}
            matchValue={foldsNames ? normalizeEndpointName : undefined}
            unknownLabel={(name) => {
              const served = normalizeEndpointName(name);
              return !foldsNames && served !== name && options.knownEndpoints.has(served)
                ? localize('com_config_specs_added_served_as', { name, served })
                : localize('com_config_specs_not_configured', { name });
            }}
            aria-label={localize('com_config_specs_added')}
          />
        </ConfigRow>
      )}
      {isShown(ADDED) && !menuOn && added.length > 0 && mode !== 'enforce' && (
        <SpecNote tone="info" action={modelSelectLink}>
          {localize('com_config_specs_added_menu_off')}
        </SpecNote>
      )}
      {!rowFilter && !showConfiguredOnly && (
        <SpecNote tone="preview" icon={<DecorativeIcon name="users" size="sm" />}>
          <span className="font-medium">{localize('com_config_specs_preview_label')}</span>{' '}
          {previewText(localize, {
            items: servedItems,
            mode,
            menuOn,
            added: servedAdded.map((name) => endpointLabelOf(options, name)),
            addsNone: servedAdded.length === 0 && added.length > 0,
          })}
        </SpecNote>
      )}
    </>
  );
}
