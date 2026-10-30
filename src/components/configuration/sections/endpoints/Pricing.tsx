import { useId, useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { cn, asConfigRecord, getUnknownConfigEntries } from '@/utils';
import { InlineFieldRenderer } from '../../renderer/InlineField';
import { DecorativeIcon } from '@/components/shared';
import { INPUT_CLASSES } from '../../fields/display';
import { NumberField } from '../../fields';
import { toFieldId } from '../../renderer';
import { useLocalize } from '@/hooks';

/** The rates of one model, in table order. `context` is a token count; the rest are USD per million tokens. */
const COLUMNS: ReadonlyArray<{ key: string; labelKey: string; required: boolean; int?: boolean }> =
  [
    { key: 'prompt', labelKey: 'com_config_ce_pricing_prompt', required: true },
    { key: 'completion', labelKey: 'com_config_ce_pricing_completion', required: true },
    { key: 'context', labelKey: 'com_config_ce_pricing_context', required: true, int: true },
    { key: 'cacheRead', labelKey: 'com_config_ce_pricing_cache_read', required: false },
    { key: 'cacheWrite', labelKey: 'com_config_ce_pricing_cache_write', required: false },
  ];

const COLUMN_KEYS: ReadonlySet<string> = new Set(COLUMNS.map((column) => column.key));

/**
 * Token pricing of a custom endpoint as a table (WS10 CE-7): one row per
 * model with its input and output rates (USD per million tokens), context
 * window and optional cache rates. Models librechat.yaml prices keep their
 * row; a model can be added from the endpoint's models or typed.
 */
export function PricingRow({
  path,
  field,
  value,
  models,
  lockedModels,
  onChange,
  disabled,
  chips,
}: t.PricingRowProps) {
  const localize = useLocalize();
  const listId = useId();
  const [draft, setDraft] = useState('');
  const record = asConfigRecord(value);
  const rows = Object.entries(record);
  const fieldId = toFieldId(path);
  const unpriced = models.filter((model) => model.trim() !== '' && !(model in record));
  const rateFields = field?.children ?? [];
  /** Rate settings the table has no column for (a newer schema's): listed under it, per model. */
  const otherFields = rateFields.filter((child) => !COLUMN_KEYS.has(child.key));

  const setCell = (model: string, key: string, cell: t.ConfigValue) => {
    const row = { ...asConfigRecord(record[model]) };
    if (cell === undefined) delete row[key];
    else row[key] = cell;
    onChange({ ...record, [model]: row });
  };
  const remove = (model: string) => {
    const next = { ...record };
    delete next[model];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  const add = () => {
    const model = draft.trim();
    setDraft('');
    if (model === '' || model in record) return;
    onChange({ ...record, [model]: {} });
  };

  return (
    <div className="flex w-full flex-col gap-2 px-(--settings-row-px) py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span id={`${fieldId}-label`} className="settings-label">
            {localize('com_config_ce_pricing_rates')}
          </span>
          <p className="settings-help m-0">{localize('com_config_ce_pricing_desc')}</p>
        </div>
        {chips && <span className="flex flex-wrap items-center gap-1.5">{chips}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-(--cui-color-text-muted)">
          {localize('com_config_ce_pricing_empty')}
        </p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table aria-labelledby={`${fieldId}-label`} className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-start text-xs text-(--cui-color-text-muted)">
                <th scope="col" className="py-1.5 pe-3 font-medium">
                  {localize('com_config_ce_pricing_model')}
                </th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="px-1.5 py-1.5 font-medium whitespace-nowrap"
                  >
                    {localize(column.labelKey)}
                  </th>
                ))}
                <th scope="col" className="w-8 py-1.5">
                  <span className="sr-only">{localize('com_ui_actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([model, row]) => {
                const cells = asConfigRecord(row);
                const missing = COLUMNS.some(
                  (column) => column.required && typeof cells[column.key] !== 'number',
                );
                const locked = lockedModels.has(model);
                return (
                  <tr
                    key={model}
                    className="border-t border-(--cui-color-stroke-default) align-top"
                  >
                    <th
                      scope="row"
                      className="max-w-56 min-w-36 py-2 pe-3 text-start font-mono text-xs font-normal wrap-anywhere text-(--cui-color-text-default)"
                    >
                      <span className="block pt-1.5">{model}</span>
                      {missing && !disabled && (
                        <span className="block pt-1 font-sans text-xs text-(--cui-color-text-danger)">
                          {localize('com_config_ce_pricing_missing')}
                        </span>
                      )}
                    </th>
                    {COLUMNS.map((column) => {
                      const cell = cells[column.key];
                      const label = `${model}: ${localize(column.labelKey)}`;
                      return (
                        <td key={column.key} className="min-w-28 px-1.5 py-2">
                          {disabled ? (
                            <span data-static-value className="static-value">
                              {typeof cell === 'number' ? cell.toLocaleString() : '—'}
                            </span>
                          ) : (
                            <NumberField
                              id={`${fieldId}-${toFieldId(model)}-${column.key}`}
                              value={typeof cell === 'number' ? cell : undefined}
                              onChange={(next) => setCell(model, column.key, next)}
                              onClear={() => {
                                setCell(model, column.key, undefined);
                                return true;
                              }}
                              min={0}
                              int={column.int}
                              aria-label={label}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 ps-1">
                      {!disabled && !locked && (
                        <button
                          type="button"
                          onClick={() => remove(model)}
                          aria-label={localize('com_ui_remove_item', { name: model })}
                          title={localize('com_ui_remove_item', { name: model })}
                          className="icon-btn icon-btn-danger mt-0.5"
                        >
                          <DecorativeIcon name="trash" size="sm" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rateFields.length > 0 &&
        rows.map(([model, row]) => {
          const cells = asConfigRecord(row);
          const unknown = getUnknownConfigEntries(rateFields, cells).length > 0;
          if (otherFields.length === 0 && !unknown) return null;
          const modelPath = `${path}.${model}`;
          return (
            <section
              key={model}
              aria-label={localize('com_config_ce_pricing_other', { model })}
              className="flex flex-col gap-1"
            >
              <span className="text-xs font-medium text-(--cui-color-text-muted)">
                {localize('com_config_ce_pricing_other', { model })}
              </span>
              <InlineFieldRenderer
                fields={otherFields}
                knownFields={rateFields}
                parentValue={cells}
                parentPath={modelPath}
                onChange={(key, next) => setCell(model, key, next)}
                disabled={disabled}
              />
            </section>
          );
        })}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draft}
            list={listId}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            placeholder={localize('com_config_ce_pricing_add_placeholder')}
            aria-label={localize('com_config_ce_pricing_add_placeholder')}
            className={cn(INPUT_CLASSES, 'max-w-72')}
          />
          <datalist id={listId}>
            {unpriced.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <Button
            type="secondary"
            htmlType="button"
            iconLeft="plus"
            label={localize('com_config_ce_pricing_add')}
            disabled={draft.trim() === '' || draft.trim() in record}
            onClick={add}
          />
        </div>
      )}
    </div>
  );
}
