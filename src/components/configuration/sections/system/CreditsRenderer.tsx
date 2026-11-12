import { useContext } from 'react';
import type * as t from '@/types';
import { NestedGroup, OtherSettings, toFieldId } from '../../renderer';
import { useFieldState, useLocalize, useOwnedField } from '@/hooks';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { FieldRow, isRowShown } from '../files/FieldRow';
import { ConfigSection } from '../../ConfigSection';
import { formatUsd, inputValues } from './credits';
import { CREDITS_PER_USD } from '@/constants';
import { CreditsInput } from './CreditsInput';
import { WarningNote } from '../files/Note';
import { ConfigRow } from '../../ConfigRow';
import { labelForPath } from '../../meta';
import { RefillRow } from './RefillRow';

const BALANCE = 'balance';
const TRANSACTIONS = 'transactions';
const START = 'balance.startBalance';
const RESERVATION = 'balance.reservationTtlMs';
/** The keys this card places; any other balance or transactions setting follows as a plain row. */
const BALANCE_PLACED: ReadonlySet<string> = new Set([
  'enabled',
  'startBalance',
  'autoRefillEnabled',
  'refillIntervalValue',
  'refillIntervalUnit',
  'refillAmount',
  'reservationTtlMs',
]);
const TRANSACTIONS_PLACED: ReadonlySet<string> = new Set(['enabled']);

function fieldFinder(section: t.ConfigSectionConfig | undefined): t.FieldLookup {
  const fields = new Map((section?.fields ?? []).map((field) => [field.key, field]));
  return (key) => fields.get(key);
}

/** Starting credits with thousands separators and their dollar value (FX-11). */
function StartingCreditsRow({ fieldProps }: { fieldProps: t.FieldRendererProps }) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const start = useOwnedField(START, fieldProps);
  if (!isRowShown(rowFilter, START, fieldProps)) return null;
  const id = toFieldId(START);
  const input = inputValues(start);
  const shown = typeof start.state.value === 'number' ? start.state.value : undefined;
  const label = labelForPath(START, localize);
  return (
    <ConfigRow
      title={label}
      description={localize('com_config_credits_start_desc')}
      fieldId={id}
      fieldPath={START}
      disabled={fieldProps.disabled}
      permissions={fieldProps.permissions}
      previewScope={fieldProps.previewScope}
      previewChangedPaths={fieldProps.previewChangedPaths}
      onResetField={fieldProps.onResetField}
      onDiscardField={fieldProps.onDiscardField}
      isConfigured={fieldProps.configuredPaths?.has(START) ?? false}
      isDbOverride={fieldProps.dbOverridePaths?.has(START) ?? false}
      isPendingReset={fieldProps.pendingResets?.has(START) ?? false}
    >
      <div className="flex flex-col gap-1">
        {fieldProps.disabled ? (
          <span id={id} className="static-value">
            {localize('com_config_credits_amount', { amount: (shown ?? 0).toLocaleString() })}
          </span>
        ) : (
          <CreditsInput
            id={id}
            value={typeof input.value === 'number' ? input.value : undefined}
            placeholder={typeof input.placeholder === 'number' ? input.placeholder : undefined}
            onChange={(next) => start.set(next)}
            aria-label={label}
          />
        )}
        {shown != null && (
          <span className="text-xs text-(--cui-color-text-muted)">
            {localize('com_config_credits_usd', { usd: formatUsd(shown / CREDITS_PER_USD) })}
          </span>
        )}
      </div>
    </ConfigRow>
  );
}

/**
 * Balance & credits (FX-11): `balance` and `transactions` as one card. Balance
 * on/off; starting credits with separators and their dollar value; auto-refill
 * and, while it is on, the refill as one sentence; the reservation time-out
 * under Advanced; then Transactions, with a warning while balance needs them
 * but they are turned off (LibreChat records them anyway).
 */
export function CreditsRenderer({
  sections,
  propsFor,
  renderSection,
  counts,
  showConfiguredOnly,
}: t.SectionGroupRendererProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const balanceEnabled = useFieldState('balance.enabled');
  const autoRefill = useFieldState('balance.autoRefillEnabled');
  const transactionsEnabled = useFieldState('transactions.enabled');
  const balance = sections.find((section) => section.id === BALANCE);
  const transactions = sections.find((section) => section.id === TRANSACTIONS);
  const host = sections[0];
  const balanceField = fieldFinder(balance);
  const transactionsField = fieldFinder(transactions);
  const total = sections.reduce(
    (sum, section) => ({
      configured: sum.configured + (counts[section.id]?.configured ?? 0),
      total: sum.total + (counts[section.id]?.total ?? 0),
      overrides: sum.overrides + (counts[section.id]?.overrides ?? 0),
    }),
    { configured: 0, total: 0, overrides: 0 },
  );
  /** LibreChat turns transactions back on while balance is on (`getTransactionsConfig`). */
  const transactionsConflict = balanceEnabled.value === true && transactionsEnabled.value === false;

  const balanceContent = (fieldProps: t.FieldRendererProps) => (
    <>
      <FieldRow field={balanceField('enabled')} fieldProps={fieldProps} />
      <StartingCreditsRow fieldProps={fieldProps} />
      <FieldRow field={balanceField('autoRefillEnabled')} fieldProps={fieldProps} />
      {autoRefill.value === true && (
        <RefillRow unitField={balanceField('refillIntervalUnit')} fieldProps={fieldProps} />
      )}
      {autoRefill.value !== true && !rowFilter && !fieldProps.showConfiguredOnly && (
        <p className="m-0 pb-2 text-xs text-(--cui-color-text-muted)">
          {localize('com_config_credits_refill_off')}
        </p>
      )}
      {balanceField('reservationTtlMs') && isRowShown(rowFilter, RESERVATION, fieldProps) && (
        <NestedGroup
          label={localize('com_config_group_advanced')}
          sectionId={`section-${BALANCE}.advanced`}
          revealPaths={[RESERVATION]}
        >
          <FieldRow field={balanceField('reservationTtlMs')} fieldProps={fieldProps} />
        </NestedGroup>
      )}
      <OtherSettings {...fieldProps} placed={BALANCE_PLACED} />
    </>
  );

  const transactionsContent = (fieldProps: t.FieldRendererProps) => (
    <>
      <FieldRow field={transactionsField('enabled')} fieldProps={fieldProps} />
      {transactionsConflict && (
        <WarningNote>{localize('com_config_credits_transactions_forced')}</WarningNote>
      )}
      <OtherSettings {...fieldProps} placed={TRANSACTIONS_PLACED} />
    </>
  );

  return (
    <ConfigSection
      sectionId={host.id}
      title={localize('com_config_credits_title')}
      description={localize('com_config_credits_desc')}
      configuredCount={total.configured}
      totalCount={total.total}
      overrideCount={total.overrides}
      defaultExpanded
      showConfiguredOnly={showConfiguredOnly}
    >
      {balance &&
        (balance.scopeGate || balance.readOnlyReason
          ? renderSection(balance)
          : balanceContent(propsFor(balance)))}
      {transactions && (
        <NestedGroup
          label={localize('com_config_section_transactions')}
          description={localize('com_config_credits_transactions_desc')}
          sectionId={`section-${TRANSACTIONS}`}
          defaultExpanded
          revealPaths={[TRANSACTIONS]}
        >
          {transactions.scopeGate || transactions.readOnlyReason
            ? renderSection(transactions)
            : transactionsContent(propsFor(transactions))}
        </NestedGroup>
      )}
    </ConfigSection>
  );
}
