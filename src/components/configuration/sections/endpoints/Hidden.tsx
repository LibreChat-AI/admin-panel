import type * as t from '@/types';
import { useLocalize, useValuesScope } from '@/hooks';
import { DecorativeIcon } from '@/components/shared';
import { describeHiddenNameUses } from '@/utils';
import { sourceLabel } from '../../values';

/** "Hidden for …" by whether the hide is saved, about to be saved, or about to be undone. */
function statusKey(item: t.EndpointHiddenItem): string {
  if (item.unhiding) return 'com_config_ce_unhiding';
  return item.entry.pending ? 'com_config_ce_hidden_pending' : 'com_config_ce_hidden';
}

function buttonKeys(item: t.EndpointHiddenItem): t.ToggleButtonKeys {
  if (item.unhiding)
    return { label: 'com_config_ctl_entry_undo', aria: 'com_config_ce_unhide_undo_a11y' };
  if (item.entry.pending)
    return { label: 'com_config_ctl_entry_undo', aria: 'com_config_ce_hide_undo_a11y' };
  return { label: 'com_config_ce_unhide', aria: 'com_config_ce_unhide_a11y' };
}

/** What LibreChat hides with the endpoint, one line each: its model specs, and the lists that name it. */
function hiddenNotes(
  item: t.EndpointHiddenItem,
  scopeName: string,
  localize: t.LocalizeFn,
): string[] {
  if (item.unhiding) return [];
  const { specs } = item.uses;
  const notes: string[] = [];
  if (specs.length > 0) {
    notes.push(
      localize(
        item.entry.pending ? 'com_config_ce_hidden_specs_pending' : 'com_config_ce_hidden_specs',
        { scope: scopeName, specs: specs.join(', '), count: specs.length },
      ),
    );
  }
  return [...notes, ...describeHiddenNameUses(item.uses, localize)];
}

function HiddenRow({ item, onToggle }: t.EndpointHiddenRowProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const scopeName = sourceLabel('scope', localize, scope);
  const notes = hiddenNotes(item, scopeName, localize);
  const keys = buttonKeys(item);
  return (
    <li
      data-endpoint-hidden={item.entry.name}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--cui-color-stroke-default) px-3 py-2"
    >
      <span className="flex size-8 shrink-0 items-center justify-center text-(--cui-color-text-muted)">
        <DecorativeIcon name={item.unhiding ? 'eye' : 'eye-closed'} size="sm" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm text-(--cui-color-text-muted)" title={item.entry.name}>
          {item.entry.name}
        </span>
        <span className="text-xs text-(--cui-color-text-muted)">
          {localize(statusKey(item), { scope: scopeName })}
        </span>
        {notes.map((note) => (
          <span key={note} className="text-xs text-(--settings-warn-fg)">
            {note}
          </span>
        ))}
      </span>
      {onToggle && (
        <button
          type="button"
          onClick={() => onToggle(item)}
          aria-label={localize(keys.aria, { name: item.entry.name })}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-solid border-(--cui-color-stroke-default) bg-transparent p-1.5 text-xs text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)"
        >
          <DecorativeIcon
            name={item.entry.pending || item.unhiding ? 'history' : 'eye'}
            size="sm"
          />
          <span>{localize(keys.label)}</span>
        </button>
      )}
    </li>
  );
}

/**
 * The custom endpoints the open profile hides (`keyedTombstones`), under
 * the others: each with "Hidden for Role: USER" (or the pending hide or
 * unhide), the model specs LibreChat hides with it, and Unhide or Undo.
 */
export function EndpointHiddenList({ items, onToggle }: t.EndpointHiddenListProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  if (items.length === 0) return null;
  return (
    <ul
      className="m-0 flex list-none flex-col gap-1.5 p-0"
      aria-label={localize('com_config_ce_hidden_list_label', {
        scope: sourceLabel('scope', localize, scope),
      })}
    >
      {items.map((item) => (
        <HiddenRow key={item.identity} item={item} onToggle={onToggle} />
      ))}
    </ul>
  );
}
