import { useContext } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  fieldControl,
  isRowVisible,
  isConfigRecord,
  hasConfigValue,
  isConfigValueEqual,
  getSecretPreviewValue,
} from '@/utils';
import { entryFieldDefault, layerValueBeneath, lowerLayerValue } from '../../renderer/defaults';
import {
  useLocalize,
  useFieldState,
  useValuesScope,
  useHasValueLayers,
  useRefocusWhenGone,
} from '@/hooks';
import { ConfiguredOnlyContext } from '@/contexts/ConfiguredOnlyContext';
import { fieldMetaFor, resolveControl } from '../../renderer/kinds';
import { fieldDescription, toFieldId } from '../../renderer/paths';
import { FieldProvenance, getRevertLabels } from '../../values';
import { DecorativeIcon, StateChip } from '@/components/shared';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { maskedSecretLabel } from '../../fields/SecretField';
import { FieldControl } from '../../renderer/FieldControl';
import { getFieldMeta, labelForPath } from '../../meta';
import { inferControlWidth } from '../../width';
import { SettingsRow } from '../../SettingsRow';

function recordKeys(value: t.ConfigValue): ReadonlySet<string> | undefined {
  return isConfigRecord(value) ? new Set(Object.keys(value)) : undefined;
}

function rowMarker(state: t.FieldState): t.SettingsRowMarker | undefined {
  if (state.error) return 'error';
  return state.isPendingReset ? 'pending' : undefined;
}

/** A field LibreChat reads only from librechat.yaml: a lock, named by its tooltip. */
function LockChip({ reason }: { reason: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-(--cui-color-text-muted)"
      title={reason}
    >
      <DecorativeIcon name="lock" size="xs" />
      <span className="sr-only">{reason}</span>
    </span>
  );
}

/**
 * One field of an MCP server (MCP-5): the control, where its value comes
 * from (librechat.yaml, Admin override, the open profile, Inherited) and a
 * Revert that removes the target's own value, or Edited / Pending revert with
 * Undo. Labels and help come from the schema path, so a card and the create
 * dialog read alike. Hidden while the tab filter matches nothing in it, and
 * with "Set values only" when it holds no value.
 */
export function McpField(props: t.McpFieldRowProps) {
  const rowFilter = useContext(RowFilterContext);
  const configuredOnly = useContext(ConfiguredOnlyContext);
  const scope = useValuesScope();
  const dataPath = `${props.entryPath}.${props.field.key}`;
  const state = useFieldState(dataPath);
  if (!isRowVisible(rowFilter, dataPath)) return null;
  if (configuredOnly && !isSetHere(state, props.entry[props.field.key], scope != null)) {
    return null;
  }
  return <McpFieldRow {...props} state={state} />;
}

/**
 * Whether "Set values only" keeps a field: in Base, any value (librechat.yaml
 * or an override); in a profile, only what the profile itself sets or edits.
 */
function isSetHere(state: t.FieldState, value: t.ConfigValue, inScope: boolean): boolean {
  if (!inScope) return hasConfigValue(value);
  return state.isConfigured || state.isEdited;
}

function McpFieldRow({
  field,
  entryPath,
  entry,
  onChange,
  disabled,
  lockReason,
  required,
  control,
  renderControl,
  extra,
  onDiscard,
  quiet,
  owned,
  state,
}: t.McpFieldRowProps & { state: t.FieldState }) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const hasLayers = useHasValueLayers();
  const dataPath = `${entryPath}.${field.key}`;
  const value = entry[field.key];
  const fieldId = toFieldId(dataPath);
  const label = labelForPath(field.path, localize);
  const meta = fieldMetaFor(field, dataPath);
  const description = fieldDescription(field, getFieldMeta(field.path), localize);
  const fieldDefault = entryFieldDefault(value, meta, state);
  const lower = lowerLayerValue(state);
  const revertTo = layerValueBeneath(state);
  const readOnly = disabled === true || lockReason != null;
  /**
   * A secret the server stores (`apiKey.key`, `oauth.client_secret`) is read
   * back only as its masked preview (`keyPreview`): the row shows it, with
   * Replace (and Cancel back to it) instead of an empty input.
   */
  const storedPreview = state.isPendingReset ? undefined : getSecretPreviewValue(entry, field.key);

  /**
   * "Default": remove the target's own value, so the server reads the layer
   * beneath again. A value only the layer beneath sets can't be removed (D3):
   * a pending change of it goes back to that value, and with none there is
   * nothing to clear.
   */
  const clear = (): boolean => {
    if (!revertTo) {
      onChange(field.key, undefined);
      return true;
    }
    if (isConfigValueEqual(value, revertTo.value)) return false;
    onChange(field.key, state.isOverride ? undefined : revertTo.value);
    return true;
  };

  const undo = onDiscard ? () => onDiscard(dataPath) : undefined;
  const undoLabel = localize('com_config_ui_undo_change', { name: label });
  const revert = getRevertLabels(state, label, localize, dataPath, scope);

  const chips = ((): ReactNode => {
    if (quiet || !hasLayers) return lockReason ? <LockChip reason={lockReason} /> : null;
    if (state.isPendingReset) {
      return (
        <StateChip
          kind="pendingRevert"
          description={revert?.label ?? localize('com_config_ui_state_pending_revert_desc')}
          onUndo={undo}
          undoLabel={undoLabel}
        />
      );
    }
    if (state.isEdited) {
      return (
        <StateChip
          kind="edited"
          description={localize('com_config_ui_state_edited_desc')}
          onUndo={undo}
          undoLabel={undoLabel}
        />
      );
    }
    return (
      <>
        {lockReason && <LockChip reason={lockReason} />}
        {!owned && <FieldProvenance path={dataPath} hideDefault />}
      </>
    );
  })();

  const canRevert = !owned && !readOnly && state.isOverride && !state.isEdited && revert != null;
  /** The revert takes its own button away: focus goes to the field it reverted. */
  const requestRefocus = useRefocusWhenGone(canRevert, [() => fieldControl(fieldId)]);
  const actions = canRevert ? (
    <button
      type="button"
      className="settings-row-action"
      onClick={() => {
        requestRefocus();
        onChange(field.key, undefined);
      }}
      aria-label={revert.ariaLabel}
    >
      {revert.label}
    </button>
  ) : undefined;

  const shownExtra = readOnly ? undefined : extra;
  const shownControl = control ?? renderControl?.({ id: fieldId, label, fieldDefault, clear }) ?? (
    <FieldControl
      key={storedPreview == null ? undefined : `${fieldId}-${storedPreview}`}
      field={field}
      path={dataPath}
      id={fieldId}
      label={label}
      value={value}
      onChange={(next) => onChange(field.key, next)}
      onClear={clear}
      fieldDefault={fieldDefault}
      lockedKeys={recordKeys(state.isOverride ? state.revertTarget?.value : lower?.value)}
      disabled={readOnly}
      required={required}
      secretPreview={storedPreview ?? null}
      secretMaskLabel={maskedSecretLabel(state, localize)}
      hasPendingEdit={state.isEdited}
      onCancelSecret={() => onDiscard?.(dataPath)}
    />
  );

  return (
    <SettingsRow
      label={label}
      htmlFor={fieldId}
      description={description}
      required={required && !readOnly}
      control={
        shownExtra ? (
          <div className="flex min-w-0 flex-col gap-2">
            {shownControl}
            {shownExtra}
          </div>
        ) : (
          shownControl
        )
      }
      chips={chips}
      actions={actions}
      error={state.error}
      width={
        resolveControl({ field, path: dataPath, value }).width ??
        inferControlWidth(field.path, state.effective)
      }
      marker={rowMarker(state)}
    />
  );
}
