import { Icon } from '@clickhouse/click-ui';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { diffList, formatReviewValue, isListChange, isShowableSecret } from './format';
import { cn, isConfigRecord, describeHiddenNameUses } from '@/utils';
import { describeOverrideNotes } from '../values';
import { useLocalize } from '@/hooks';

/** The row's enum option labels, so values read as the page's options ("Remaining tokens"). */
const ValueLabelsContext = createContext<Readonly<Record<string, string>> | undefined>(undefined);

/** `formatReviewValue` with the row's option labels. */
function useFormatValue(): (value: t.ConfigValue) => string {
  const localize = useLocalize();
  const labels = useContext(ValueLabelsContext);
  return (value) => formatReviewValue(value, localize, labels);
}

/** The kind chip of a change: the page's state-chip colours, which meet AA contrast in both themes. */
const KIND_BADGE: Record<t.ChangeKind, { key: string; chip: string }> = {
  added: { key: 'com_config_review_kind_added', chip: 'state-chip-added' },
  changed: { key: 'com_config_review_kind_changed', chip: 'state-chip-changed' },
  removed: { key: 'com_config_review_kind_removed', chip: 'state-chip-error' },
  reverted: { key: 'com_config_review_kind_reverted', chip: 'state-chip-warning' },
  hidden: { key: 'com_config_review_kind_hidden', chip: 'state-chip-error' },
  unhidden: { key: 'com_config_review_kind_unhidden', chip: 'state-chip-warning' },
  renamed: { key: 'com_config_review_kind_changed', chip: 'state-chip-changed' },
};

/**
 * The kind chip of a row: a plain list change that only adds (or only
 * removes) items reads "Added" (or "Removed"), not "Changed".
 */
function badgeOf(item: t.ChangeSummaryItem): { key: string; chip: string } {
  if (item.kind !== 'changed' || !isListChange(item)) return KIND_BADGE[item.kind];
  const { added, removed } = diffList(item.before ?? item.revertTarget?.value, item.after);
  if (added.length > 0 && removed.length === 0) {
    return { key: 'com_config_review_kind_list_added', chip: 'state-chip-added' };
  }
  if (removed.length > 0 && added.length === 0) {
    return { key: 'com_config_review_kind_removed', chip: 'state-chip-error' };
  }
  return KIND_BADGE.changed;
}

const ENTRY_TITLE_KEYS: Partial<Record<t.ChangeKind, string>> = {
  added: 'com_config_review_added_entry',
  removed: 'com_config_review_removed_entry',
  renamed: 'com_config_review_renamed_entry',
  reverted: 'com_config_review_reverted_entry',
  hidden: 'com_config_review_hidden_entry',
  unhidden: 'com_config_review_unhidden_entry',
};

const SOURCE_KEYS: Record<t.ProvenanceSource, string> = {
  default: 'com_config_review_source_default',
  runtimeDefault: 'com_config_review_source_runtimeDefault',
  yaml: 'com_config_review_source_yaml',
  admin: 'com_config_review_source_admin',
  scope: 'com_config_review_source_scope',
  inherited: 'com_config_review_source_inherited',
};

/** Row-level warnings; `yamlEntry` is reported as a blocking problem on the row instead. */
const WARNING_KEYS: Partial<Record<t.ChangeWarning, string>> = {
  emptyAllowlist: 'com_config_review_warning_empty_allowlist',
  openAllowlist: 'com_config_review_warning_open_allowlist',
  openRegistration: 'com_config_review_warning_open_registration',
  emptySpecs: 'com_config_review_warning_empty_specs',
  shadowed: 'com_config_review_warning_shadowed',
  shadowedBlock: 'com_config_review_warning_shadowed_block',
  shadowedPair: 'com_config_review_warning_shadowed_pair',
  secretRebinding: 'com_config_review_warning_secret_rebinding',
  secretRebindingEnter: 'com_config_review_warning_secret_rebinding_enter',
  secretRestated: 'com_config_review_warning_secret_restated',
  secretNotCopied: 'com_config_review_warning_secret_not_copied',
};

function ActionButton({
  icon,
  label,
  ariaLabel,
  onClick,
}: {
  icon: t.IconName;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)"
    >
      <span aria-hidden="true" className="flex">
        <Icon name={icon} size="xs" />
      </span>
      {label}
    </button>
  );
}

function Value({
  children,
  muted,
  strike,
}: {
  children: ReactNode;
  muted?: boolean;
  strike?: boolean;
}) {
  return (
    <span
      className={cn(
        'rounded bg-(--cui-color-background-muted) px-1 font-mono text-[13px] wrap-anywhere',
        muted ? 'text-(--cui-color-text-muted)' : 'text-(--cui-color-text-default)',
        strike && 'line-through decoration-(--cui-color-text-muted)',
      )}
    >
      {children}
    </span>
  );
}

function Arrow() {
  return (
    <span aria-hidden="true" className="text-(--cui-color-text-muted)">
      →
    </span>
  );
}

/** "1,000,000 (librechat.yaml)" or, for a profile with no value of its own, "Not set · inherits 1,000,000 from Base". */
function LowerValue({ target, secret }: { target: t.RevertTarget; secret?: boolean }) {
  const localize = useLocalize();
  const format = useFormatValue();
  /** A whole entry (an MCP server) is named by where it comes from, not dumped. */
  if (isConfigRecord(target.value)) {
    return (
      <Value muted>
        {target.source === 'inherited'
          ? localize('com_config_review_entry_from_base')
          : localize('com_config_review_entry_from', {
              source: localize(SOURCE_KEYS[target.source]),
            })}
      </Value>
    );
  }
  const value =
    secret && !isShowableSecret(target.value)
      ? localize('com_config_review_secret_set')
      : format(target.value);
  if (target.source === 'inherited') {
    return <Value muted>{localize('com_config_review_inherits', { value })}</Value>;
  }
  return (
    <Value muted>
      {localize('com_config_review_value_source', {
        value,
        source: localize(SOURCE_KEYS[target.source]),
      })}
    </Value>
  );
}

function SecretChange({ item }: t.ChangeItemProps) {
  const localize = useLocalize();
  const format = useFormatValue();
  const before = item.before ?? item.revertTarget?.value;
  if (item.kind === 'reverted' || item.after == null) {
    const target = item.revertTarget;
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Value muted>{localize('com_config_review_secret_removed')}</Value>
        {target && target.value != null && (
          <>
            <Arrow />
            <Value>
              {localize('com_config_review_reverts_to', {
                value: isShowableSecret(target.value)
                  ? format(target.value)
                  : localize('com_config_review_secret_hidden'),
                source: localize(SOURCE_KEYS[target.source]),
              })}
            </Value>
          </>
        )}
      </span>
    );
  }
  const afterText = isShowableSecret(item.after)
    ? format(item.after)
    : localize(
        before == null ? 'com_config_review_secret_set' : 'com_config_review_secret_replaced',
      );
  /** A stored key replaced by a value the review may show: the stored one reads struck through. */
  const replacesStored =
    before != null && !isShowableSecret(before) && isShowableSecret(item.after);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {before != null && isShowableSecret(before) && (
        <>
          <Value muted strike>
            {format(before)}
          </Value>
          <Arrow />
        </>
      )}
      {replacesStored && (
        <>
          <Value muted strike>
            {localize('com_config_review_secret_stored')}
          </Value>
          <Arrow />
        </>
      )}
      <Value>{afterText}</Value>
    </span>
  );
}

function ListChange({ item }: t.ChangeItemProps) {
  const localize = useLocalize();
  const format = useFormatValue();
  const before = item.before ?? item.revertTarget?.value;
  const { added, removed, reordered } = diffList(before, item.after);
  if (reordered) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-(--cui-color-text-muted)">
          {localize('com_config_review_list_reordered')}:
        </span>
        <Value>{format(item.after)}</Value>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {added.map((value, i) => (
        <span
          key={`+${i}`}
          className="rounded bg-[rgba(22,163,74,0.12)] px-1 font-mono text-[13px] wrap-anywhere text-(--cui-color-text-default)"
          aria-label={`${localize('com_config_review_list_added')}: ${format(value)}`}
        >
          + {format(value)}
        </span>
      ))}
      {removed.map((value, i) => (
        <span
          key={`-${i}`}
          className="rounded bg-[rgba(220,38,38,0.1)] px-1 font-mono text-[13px] wrap-anywhere text-(--cui-color-text-default) line-through"
          aria-label={`${localize('com_config_review_list_removed')}: ${format(value)}`}
        >
          − {format(value)}
        </span>
      ))}
    </span>
  );
}

/**
 * What a value shown again reads as: the value the same save writes there
 * (`after`), else the one it inherits again, else not set.
 */
function ShownValue({ item }: t.ChangeItemProps) {
  const localize = useLocalize();
  const format = useFormatValue();
  if (item.after !== undefined) {
    const hidesValue = item.secret && !isShowableSecret(item.after);
    return (
      <Value>{hidesValue ? localize('com_config_review_secret_set') : format(item.after)}</Value>
    );
  }
  if (item.revertTarget) return <LowerValue target={item.revertTarget} secret={item.secret} />;
  return <Value>{localize('com_config_field_not_set')}</Value>;
}

/**
 * A hidden inherited value ("1,000,000 (Base) → Hidden"), or one shown
 * again ("Hidden → inherits 1,000,000 from Base", or "Hidden → 2,000,000"
 * where the same save writes its own value there). Where the target sets its
 * own value there (`before`), that is what its users get now, struck through.
 */
function VisibilityChange({ item }: t.ChangeItemProps) {
  const localize = useLocalize();
  const format = useFormatValue();
  const hidden = (
    <Value muted={item.kind === 'unhidden'}>{localize('com_config_review_hidden')}</Value>
  );
  const own =
    item.before !== undefined ? (
      <Value muted strike>
        {format(item.before)}
      </Value>
    ) : null;
  if (item.kind === 'hidden') {
    return (
      <span className="flex flex-wrap items-center gap-1">
        {own ??
          (item.revertTarget && <LowerValue target={item.revertTarget} secret={item.secret} />)}
        <Arrow />
        {hidden}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {own ?? hidden}
      <Arrow />
      <ShownValue item={item} />
    </span>
  );
}

/** BEFORE → AFTER for one value, with the layer it reverts to or inherits from. */
function ValueChange({ item, isScope }: t.ScopedChangeItemProps) {
  const localize = useLocalize();
  const format = useFormatValue();
  if (item.kind === 'hidden' || item.kind === 'unhidden') return <VisibilityChange item={item} />;
  if (item.secret) return <SecretChange item={item} />;
  if (isListChange(item)) return <ListChange item={item} />;
  if (item.kind === 'reverted') {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Value muted strike>
          {format(item.before)}
        </Value>
        <Arrow />
        {item.revertTarget ? (
          <Value>
            {localize('com_config_review_reverts_to', {
              value: format(item.revertTarget.value),
              source: localize(SOURCE_KEYS[item.revertTarget.source]),
            })}
          </Value>
        ) : (
          <Value>{localize('com_config_field_not_set')}</Value>
        )}
      </span>
    );
  }
  const showLower = item.before == null && item.revertTarget != null;
  const hideBefore = item.before == null && !showLower && !isScope;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {showLower && item.revertTarget && <LowerValue target={item.revertTarget} />}
      {!showLower && !hideBefore && (
        <Value muted strike={item.before != null}>
          {format(item.before)}
        </Value>
      )}
      {!hideBefore && <Arrow />}
      <Value>
        {item.after == null ? localize('com_config_review_kind_removed') : format(item.after)}
      </Value>
    </span>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-xs text-(--settings-warn-fg)">
      <span aria-hidden="true" className="flex text-(--settings-warn-mark)">
        <Icon name="warning" size="xs" />
      </span>
      {children}
    </span>
  );
}

/** What a hidden custom endpoint takes with it: its model specs, and its name in the endpoint lists. */
function describeHiddenUses(
  uses: t.HiddenEndpointUses | undefined,
  localize: t.LocalizeFn,
): string[] {
  if (!uses) return [];
  return [
    ...(uses.specs.length > 0
      ? [localize('com_config_review_hidden_specs', { specs: uses.specs.join(', ') })]
      : []),
    ...describeHiddenNameUses(uses, localize),
  ];
}

/** Warnings worded for the target: turning on required terms reads differently in a profile. */
function warningKey(warning: t.ChangeWarning, isScope: boolean): string | undefined {
  if (warning === 'hideDeletesOwn') {
    return isScope
      ? 'com_config_review_warning_hide_deletes_own_scope'
      : 'com_config_review_warning_hide_deletes_own';
  }
  if (warning === 'deletesOwnValue') {
    return isScope
      ? 'com_config_review_warning_deletes_own_value_scope'
      : 'com_config_review_warning_deletes_own_value';
  }
  if (warning === 'requireTerms') {
    return isScope
      ? 'com_config_terms_acceptance_import_scope'
      : 'com_config_terms_acceptance_import';
  }
  return WARNING_KEYS[warning];
}

/** Row warnings, and the value saved meanwhile when someone else changed it since the edit (SV-8). */
function RowWarnings({ item, isScope }: t.ScopedChangeItemProps) {
  const localize = useLocalize();
  const format = useFormatValue();
  const keys = (item.warnings ?? [])
    .map((warning) => warningKey(warning, isScope))
    .filter((key): key is string => key != null);
  const profileNotes = describeOverrideNotes(item.overrideNotes ?? [], localize);
  const hiddenNotes = describeHiddenUses(item.hiddenUses, localize);
  const drift = item.drift;
  if (keys.length === 0 && profileNotes.length === 0 && hiddenNotes.length === 0 && !drift) {
    return null;
  }
  return (
    <>
      {keys.map((key) => (
        <Warning key={key}>{localize(key)}</Warning>
      ))}
      {hiddenNotes.map((note) => (
        <Warning key={note}>{note}</Warning>
      ))}
      {profileNotes.map((note) => (
        <Warning key={note}>{note}</Warning>
      ))}
      {drift && (
        <Warning>
          {localize('com_config_review_drift', {
            value: item.secret ? localize('com_config_review_secret_set') : format(drift.current),
          })}
        </Warning>
      )}
    </>
  );
}

function RowIssues({ issues }: { issues?: t.ReviewIssue[] }) {
  if (!issues?.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {issues.map((issue, i) => (
        <li
          key={`${issue.path ?? ''}:${i}`}
          className="text-xs wrap-anywhere text-(--cui-color-text-danger)"
        >
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

/** A detail under a row: a leaf of an added entry, or a part the change deletes with it. */
function DetailValue({ detail }: t.ReviewDetailValueProps) {
  const localize = useLocalize();
  const { item } = detail;
  if (item.kind === 'removed') {
    if (item.secret) return <>{localize('com_config_review_secret_removed')}</>;
    return (
      <span className="line-through decoration-(--cui-color-text-muted)">
        {formatReviewValue(item.before, localize, detail.valueLabels)}
      </span>
    );
  }
  if (item.secret && !isShowableSecret(item.after)) {
    return <>{localize('com_config_review_secret_set')}</>;
  }
  return <>{formatReviewValue(item.after, localize, detail.valueLabels)}</>;
}

/** One change of the review: its label, BEFORE → AFTER, warnings, problems, and Revert / Go to field. */
export function ChangeRow({
  row,
  isScope,
  onRevert,
  onGoTo,
  leading,
  compact,
}: t.ReviewRowViewProps) {
  const localize = useLocalize();
  const { item } = row;
  const isEntry = row.noun != null;
  const entryTitleKey = ENTRY_TITLE_KEYS[item.kind];
  const badge = badgeOf(item);
  const hasIssue = (row.issues?.length ?? 0) > 0;
  /** A rename to no name names the entry by its old name. */
  const nameCleared = item.kind === 'renamed' && !item.entryIdentity && !!item.previousIdentity;

  return (
    <li
      className={cn(
        'flex flex-col gap-1 rounded-md px-2 py-1.5',
        hasIssue && 'bg-[rgba(220,38,38,0.06)] ring-1 ring-[rgba(220,38,38,0.35)]',
      )}
      data-review-path={item.path}
    >
      <div className="flex min-w-0 items-start gap-2 max-sm:flex-wrap">
        {leading}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {isEntry && entryTitleKey ? (
              <span className="text-sm text-(--cui-color-text-default)">
                <span className="text-(--cui-color-text-muted)">
                  {localize(entryTitleKey, { noun: row.noun ?? '' })}
                </span>{' '}
                <span className="font-medium wrap-anywhere">
                  {nameCleared ? item.previousIdentity : row.label}
                </span>
                {item.kind === 'renamed' && item.previousIdentity && (
                  <span className="text-(--cui-color-text-muted)">
                    {' '}
                    {nameCleared
                      ? `(${localize('com_config_review_name_cleared')})`
                      : `(${item.previousIdentity} → ${row.label})`}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-sm font-medium wrap-anywhere text-(--cui-color-text-default)">
                {row.label}
              </span>
            )}
            {!isEntry && (
              <span className={cn('state-chip', badge.chip)}>{localize(badge.key)}</span>
            )}
          </div>
          <ValueLabelsContext.Provider value={row.valueLabels}>
            {!isEntry && <ValueChange item={item} isScope={isScope} />}
            <RowWarnings item={item} isScope={isScope} />
          </ValueLabelsContext.Provider>
          <RowIssues issues={row.issues} />
          {row.details && row.details.length > 0 && (
            <dl className="m-0 grid grid-cols-[minmax(6rem,max-content)_1fr] gap-x-3 gap-y-0.5 pl-1 text-xs">
              {row.details.map((detail) => (
                <div key={detail.key} className="contents">
                  <dt className="text-(--cui-color-text-muted)">{detail.label}</dt>
                  <dd className="m-0 min-w-0 font-mono wrap-anywhere text-(--cui-color-text-default)">
                    <DetailValue detail={detail} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {!compact && (onRevert || onGoTo) && (
          <div className="flex shrink-0 items-center gap-0.5 max-sm:w-full max-sm:justify-end">
            {onRevert && (
              <ActionButton
                icon="history"
                label={localize('com_config_review_revert')}
                ariaLabel={localize('com_config_review_revert_aria', { label: row.label })}
                onClick={() => onRevert(row)}
              />
            )}
            {onGoTo && (
              <ActionButton
                icon="arrow-right"
                label={localize('com_config_review_go_to')}
                ariaLabel={localize('com_config_review_go_to_aria', { label: row.label })}
                onClick={() => onGoTo(row)}
              />
            )}
          </div>
        )}
      </div>
    </li>
  );
}
