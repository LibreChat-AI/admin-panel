import { useContext } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { useLocalize, useOwnedField, useValuesScope } from '@/hooks';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { NumberField } from '../../fields/NumberField';
import { SelectField } from '../../fields/SelectField';
import { formatUsd, inputValues } from './credits';
import { getFieldOptions } from '../../controls';
import { StateChip } from '@/components/shared';
import { SettingsRow } from '../../SettingsRow';
import { FieldProvenance } from '../../values';
import { isRowShown } from '../files/FieldRow';
import { CREDITS_PER_USD } from '@/constants';
import { CreditsInput } from './CreditsInput';
import { toFieldId } from '../../renderer';

const AMOUNT = 'balance.refillAmount';
const EVERY = 'balance.refillIntervalValue';
const UNIT = 'balance.refillIntervalUnit';

function asNumber(value: t.ConfigValue): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * Auto-refill as one sentence (FX-11): "Add [1,000,000] credits every [4]
 * [hours]", with the dollar value of each refill. Each input is its own
 * setting: cleared, it goes back to the value in brackets. The row's chips
 * cover all three: Edited (Undo undoes every part) or where they come from,
 * and one revert for the parts the edit target overrides.
 */
export function RefillRow({
  unitField,
  fieldProps,
}: {
  unitField: t.SchemaField | undefined;
  fieldProps: t.FieldRendererProps;
}) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const scope = useValuesScope();
  const amount = useOwnedField(AMOUNT, fieldProps);
  const every = useOwnedField(EVERY, fieldProps);
  const unit = useOwnedField(UNIT, fieldProps);
  const { disabled, onResetField, onDiscardField, permissions, pendingResets } = fieldProps;
  const parts = [amount, every, unit];
  if (!parts.some((part) => isRowShown(rowFilter, part.path, fieldProps))) return null;

  const id = toFieldId(AMOUNT);
  const amountInput = inputValues(amount);
  const everyInput = inputValues(every);
  const shownAmount = asNumber(amount.own) ?? asNumber(amount.fallback);
  /** Unit names as they read mid-sentence ("every 4 hours"). */
  const unitOptions = (unitField ? getFieldOptions(unitField, localize) : []).map((option) => ({
    ...option,
    label: localize(`com_config_credits_unit_${option.value}`),
  }));
  const unitLabels = Object.fromEntries(unitOptions.map((option) => [option.value, option.label]));
  const unitLabel = (value: t.ConfigValue) => unitLabels[String(value)] ?? String(value ?? '');
  const isPending = (part: t.OwnedField) =>
    part.state.isPendingReset || (pendingResets?.has(part.path) ?? false);
  const edited = parts.filter((part) => part.state.isEdited || isPending(part));
  const overridden = parts.filter((part) => part.state.isOverride && !isPending(part));
  const canEdit = !disabled && permissions?.canEdit !== false;

  const chips = (): ReactNode => {
    if (edited.length > 0) {
      return (
        <StateChip
          kind={edited.every(isPending) ? 'pendingRevert' : 'edited'}
          description={localize('com_config_ui_state_edited_desc')}
          onUndo={
            onDiscardField ? () => edited.forEach((part) => onDiscardField(part.path)) : undefined
          }
          undoLabel={localize('com_config_ui_undo_change', {
            name: localize('com_config_credits_refill'),
          })}
        />
      );
    }
    /** Where the refill comes from: the part the target overrides, else the first a layer sets. */
    const shown = overridden[0] ?? parts.find((part) => part.state.source !== 'default');
    return shown ? <FieldProvenance path={shown.path} hideDefault /> : null;
  };

  const actions =
    canEdit && edited.length === 0 && overridden.length > 0 && onResetField ? (
      <button
        type="button"
        className="settings-row-action"
        onClick={() => overridden.forEach((part) => onResetField(part.path))}
      >
        {localize(scope ? 'com_config_credits_refill_inherit' : 'com_config_credits_refill_revert')}
      </button>
    ) : undefined;

  const control = disabled ? (
    <span id={id} className="static-value">
      {localize('com_config_credits_refill_sentence_static', {
        amount: (shownAmount ?? 0).toLocaleString(),
        every: String(asNumber(every.own) ?? asNumber(every.fallback) ?? ''),
        unit: unitLabel(unit.own ?? unit.fallback),
      })}
    </span>
  ) : (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-(--cui-color-text-default)">
        <span>{localize('com_config_credits_refill_add')}</span>
        <CreditsInput
          id={id}
          value={asNumber(amountInput.value)}
          placeholder={asNumber(amountInput.placeholder)}
          onChange={(next) => amount.set(next)}
          min={1}
          aria-label={localize('com_config_credits_refill_amount')}
        />
        <span>{localize('com_config_credits_refill_every_word')}</span>
        <div className="w-20">
          <NumberField
            id={toFieldId(EVERY)}
            value={asNumber(everyInput.value)}
            placeholder={String(asNumber(everyInput.placeholder) ?? '')}
            onChange={(next) => every.set(next)}
            onClear={() => every.set(undefined)}
            min={1}
            int
            aria-label={localize('com_config_credits_refill_every')}
          />
        </div>
        <div className="w-32">
          <SelectField
            id={toFieldId(UNIT)}
            value={String(unit.own ?? unit.fallback ?? '')}
            options={unitOptions}
            onChange={(next) => unit.set(next === unit.fallback ? undefined : next)}
            aria-label={localize('com_config_credits_refill_unit')}
          />
        </div>
      </div>
      {shownAmount != null && (
        <span className="text-xs text-(--cui-color-text-muted)">
          {localize('com_config_credits_refill_usd', {
            usd: formatUsd(shownAmount / CREDITS_PER_USD),
          })}
        </span>
      )}
    </div>
  );

  return (
    <SettingsRow
      label={localize('com_config_credits_refill')}
      htmlFor={id}
      description={localize('com_config_credits_refill_desc')}
      control={control}
      chips={chips()}
      actions={actions}
      width="L"
      marker={edited.length > 0 ? 'edited' : undefined}
    />
  );
}
