import { useState } from 'react';
import { Badge, Checkbox, Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { ChangeRow, formatReviewValue } from '@/components/configuration/review';
import { hasPathOrAncestor } from '@/utils';
import { useLocalize } from '@/hooks';

/** The value an imported leaf sets, for keys shown without a change row (not recognized). */
function importedValue(row: t.ImportPreviewRow): t.ConfigValue {
  return row.rows.find((change) => change.item.path === row.fieldPath)?.item.after;
}

function PreviewEntry({
  row,
  isScope,
  included,
  onToggle,
}: {
  row: t.ImportPreviewRow;
  isScope: boolean;
  included: boolean;
  onToggle: (fieldPath: string, include: boolean) => void;
}) {
  const localize = useLocalize();
  const checkbox = (
    <Checkbox
      checked={included}
      onCheckedChange={(checked) => onToggle(row.fieldPath, checked === true)}
      aria-label={localize('com_config_review_import_include', { label: row.label })}
    />
  );
  const single = row.rows.length === 1 && row.rows[0].item.path === row.fieldPath;
  const notes = [
    ...(row.replacesList
      ? [
          localize(
            isScope
              ? 'com_config_review_warning_ownership_scope'
              : 'com_config_review_warning_ownership',
          ),
        ]
      : []),
    ...(row.hiddenNotes ?? []),
  ];
  if (single && !row.unknown && notes.length === 0) {
    return (
      <ChangeRow
        row={{ ...row.rows[0], label: row.label }}
        isScope={isScope}
        leading={checkbox}
        compact
      />
    );
  }
  return (
    <li className="flex flex-col gap-1 rounded-md px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {checkbox}
        <span className="text-sm font-medium wrap-anywhere text-(--cui-color-text-default)">
          {row.label}
        </span>
        {row.unknown && (
          <Badge
            text={localize('com_config_review_import_unknown_badge')}
            state="neutral"
            size="sm"
          />
        )}
      </div>
      {row.unchanged && (
        <span className="ps-6 text-xs text-(--cui-color-text-muted)">
          {localize('com_config_review_import_unchanged')}
        </span>
      )}
      {row.unknown && (
        <span className="ps-6 text-xs text-(--cui-color-text-muted)">
          {localize('com_config_review_import_unknown')}:{' '}
          <span className="font-mono text-(--cui-color-text-default)">
            {formatReviewValue(importedValue(row), localize)}
          </span>
        </span>
      )}
      {notes.map((note) => (
        <span key={note} className="flex items-start gap-1 ps-6 text-xs text-(--settings-warn-fg)">
          <span aria-hidden="true" className="flex pt-0.5 text-(--settings-warn-mark)">
            <Icon name="warning" size="xs" />
          </span>
          {note}
        </span>
      ))}
      {!row.unknown && row.rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 ps-4">
          {row.rows.map((change) => (
            <ChangeRow key={change.key} row={change} isScope={isScope} compact />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The enum values the import writes: those in a row left checked, minus any
 * inside a key left out of it (a list entry the target hides).
 */
function importedEnumValues(
  values: t.ImportEnumValue[],
  included: ReadonlySet<string>,
  skipped: t.ReviewSkippedRow[],
): t.ImportEnumValue[] {
  if (values.length === 0) return values;
  const leftOut = new Set(skipped.map((skip) => skip.path));
  return values.filter(
    ({ path }) => hasPathOrAncestor(included, path) && !hasPathOrAncestor(leftOut, path),
  );
}

/**
 * The enum values the bundled schema doesn't list that the import writes as
 * written, each with its path, so a typo is named before it is stored: only
 * LibreChat v0.8.8 and later refuse a value they don't know.
 */
function UnknownEnumValues({ values }: { values: t.ImportEnumValue[] }) {
  const localize = useLocalize();
  if (values.length === 0) return null;
  const title = localize('com_config_review_import_enum_title', { count: values.length });
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-1 rounded-lg border border-solid border-(--settings-warn-mark) bg-(--settings-warn-bg) px-3 py-2 text-xs text-(--settings-warn-fg)"
    >
      <p className="m-0 flex items-start gap-1 font-medium">
        <span aria-hidden="true" className="flex pt-0.5 text-(--settings-warn-mark)">
          <Icon name="warning" size="xs" />
        </span>
        {title}
      </p>
      <p className="m-0">{localize('com_config_review_import_enum_note')}</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {values.map(({ path, value, options }) => (
          <li key={`${path}:${value}`} className="wrap-anywhere">
            <code>{path}</code>: <code>{JSON.stringify(value)}</code> ·{' '}
            {localize('com_config_review_import_enum_known', { options: options.join(', ') })}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Step 3: every key of the YAML, what it changes in the target (or that it
 * already has that value), with a checkbox to leave it out, the enum values
 * this panel doesn't recognize that it imports, and the keys that will not be
 * imported with the reason.
 */
export function Preview({
  preview,
  targetLabel,
  isScope,
  included,
  onToggle,
  unknownEnumValues,
}: t.ImportPreviewProps) {
  const localize = useLocalize();
  const { groups, skipped } = preview;
  const [showUnchanged, setShowUnchanged] = useState(false);
  const count = groups.reduce(
    (sum, group) => sum + group.rows.filter((row) => included.has(row.fieldPath)).length,
    0,
  );
  const unchangedCount = groups.reduce(
    (sum, group) => sum + group.rows.filter((row) => row.unchanged).length,
    0,
  );
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  /** Unchanged settings stay listed when nothing else is (or when asked for). */
  const hideUnchanged = !showUnchanged && unchangedCount < total;
  const visible = groups
    .map((group) => ({
      ...group,
      rows: hideUnchanged ? group.rows.filter((row) => !row.unchanged) : group.rows,
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-(--cui-color-text-default)">
        {localize('com_config_review_import_summary', { count, target: targetLabel })}
      </p>
      <UnknownEnumValues values={importedEnumValues(unknownEnumValues, included, skipped)} />
      <div className="flex flex-col gap-3">
        {visible.map((group) => (
          <section key={group.key} aria-label={group.title} className="flex flex-col gap-1">
            <h3 className="m-0 text-xs font-semibold tracking-wide text-(--cui-color-text-muted) uppercase">
              {group.title}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {group.rows.map((row) => (
                <PreviewEntry
                  key={row.fieldPath}
                  row={row}
                  isScope={isScope}
                  included={included.has(row.fieldPath)}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </section>
        ))}
        {unchangedCount > 0 && unchangedCount < total && (
          <button
            type="button"
            onClick={() => setShowUnchanged((shown) => !shown)}
            aria-expanded={showUnchanged}
            className="cursor-pointer self-start rounded px-1.5 py-0.5 text-xs text-(--cui-color-text-muted) underline-offset-2 hover:text-(--cui-color-text-default) hover:underline"
          >
            {localize(
              showUnchanged
                ? 'com_config_review_import_hide_unchanged'
                : 'com_config_review_import_show_unchanged',
              { count: unchangedCount },
            )}
          </button>
        )}
        {skipped.length > 0 && (
          <section
            aria-label={localize('com_config_review_import_skipped_title', {
              count: skipped.length,
            })}
            className="rounded-lg border border-(--cui-color-stroke-default) px-3 py-2 text-xs text-(--cui-color-text-muted)"
          >
            <p className="m-0 mb-1 font-medium text-(--cui-color-text-default)">
              {localize('com_config_review_import_skipped_title', { count: skipped.length })}
            </p>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {skipped.map((skip) => (
                <li key={skip.key} className="wrap-anywhere">
                  <span className="text-(--cui-color-text-default)">{skip.label}</span>:{' '}
                  {skip.reason}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
