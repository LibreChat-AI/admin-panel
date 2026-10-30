import { useEffect, useRef } from 'react';
import type * as t from '@/types';
import { DecorativeIcon, KebabMenu, WarningList } from '@/components/shared';
import { useLocalize, useValuesScope, useCatalogEndpoint } from '@/hooks';
import { CATALOG_ENDPOINT_REASON_KEYS } from '@/constants';
import { sourceLabel } from '../../values';
import { describeIssue } from './issues';
import { isUnserved } from './model';
import { cn } from '@/utils';

/**
 * Two letters for the endpoint's monogram: initials of its words ("Azure
 * (DeepSeek)" → "AD"), else its first two letters or digits; punctuation never shows.
 */
export function monogram(title: string): string {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length >= 2) return `${[...words[0]][0]}${[...words[1]][0]}`.toUpperCase();
  const [only = title] = words;
  return [...only].slice(0, 2).join('').toUpperCase();
}

function Monogram({ title, muted }: { title: string; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
        muted
          ? 'bg-(--settings-neutral-bg) text-(--cui-color-text-muted)'
          : 'bg-(--settings-accent-bg) text-(--settings-accent-fg)',
      )}
    >
      {monogram(title)}
    </span>
  );
}

/** A chip in a list row or the drawer header; `description` is read after the label. */
export function Badge({
  tone,
  label,
  description,
  dot,
}: {
  tone: 'yaml' | 'override' | 'scope' | 'inherited' | 'added' | 'edited' | 'error' | 'warning';
  label: string;
  description?: string;
  dot?: boolean;
}) {
  return (
    <span className={cn('state-chip', `state-chip-${tone}`)} title={description}>
      {dot && <span className="state-chip-dot" aria-hidden="true" />}
      {label}
      {description && <span className="sr-only">{`, ${description}`}</span>}
    </span>
  );
}

/**
 * Where an endpoint comes from (CE-2): "librechat.yaml", "librechat.yaml +
 * overrides", "Added in admin panel"; in a profile "Inherited from Base", "Base +
 * Role: USER" or "Added in Role: USER".
 */
export function SourceBadge({ row }: { row: Pick<t.EndpointRow, 'origin' | 'overridden'> }) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const scopeName = scope ? sourceLabel('scope', localize, scope) : '';
  switch (row.origin) {
    case 'yaml':
      return row.overridden ? (
        <Badge
          tone="override"
          label={localize('com_config_ce_source_yaml_overrides')}
          description={localize('com_config_ce_source_yaml_overrides_desc')}
        />
      ) : (
        <Badge
          tone="yaml"
          label={localize('com_config_ce_source_yaml')}
          description={localize('com_config_ce_source_yaml_desc')}
        />
      );
    case 'admin':
      return (
        <Badge
          tone="added"
          label={localize('com_config_ce_source_admin')}
          description={localize('com_config_ce_source_admin_desc')}
        />
      );
    case 'inherited':
      return row.overridden ? (
        <Badge
          tone="scope"
          label={localize('com_config_ce_source_inherited_overrides', { scope: scopeName })}
          description={localize('com_config_ce_source_inherited_overrides_desc', {
            scope: scopeName,
          })}
        />
      ) : (
        <Badge
          tone="inherited"
          label={localize('com_config_ce_source_inherited')}
          description={localize('com_config_ce_source_inherited_desc')}
        />
      );
    default:
      return (
        <Badge
          tone="added"
          label={localize('com_config_ce_source_scope', { scope: scopeName })}
          description={localize('com_config_ce_source_scope_desc', { scope: scopeName })}
        />
      );
  }
}

/** "Incomplete – not served", "Needs attention" or nothing (CE-3). */
export function StatusBadge({ issues }: { issues: t.EndpointIssue[] }) {
  const localize = useLocalize();
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length === 0) return null;
  const summary = errors.map((issue) => describeIssue(issue, localize)).join(' ');
  return isUnserved(errors) ? (
    <Badge tone="error" label={localize('com_config_ce_status_unserved')} description={summary} />
  ) : (
    <Badge tone="error" label={localize('com_config_ce_status_invalid')} description={summary} />
  );
}

/**
 * "Not served" for a saved endpoint LibreChat does not serve the edit
 * target's users, from the scope catalog (`catalogApi`) with its reason: a
 * key the merge dropped, say, which the list's own checks can't see. Nothing
 * while the row has unsaved changes or problems of its own, or without the catalog.
 */
function ServedBadge({ row }: t.EndpointServedBadgeProps) {
  const localize = useLocalize();
  const entry = useCatalogEndpoint(row.identity ?? '');
  const ownErrors = row.issues.some((issue) => issue.severity === 'error');
  if (!entry || entry.enabled || row.isNew || row.edited || ownErrors) return null;
  return (
    <Badge
      tone="error"
      label={localize('com_config_ce_status_not_served')}
      description={localize(CATALOG_ENDPOINT_REASON_KEYS[entry.reason ?? 'unknown'])}
    />
  );
}

/** "New" or "Edited" for an endpoint with unsaved changes. */
function PendingBadge({ row }: { row: t.EndpointRow }) {
  const localize = useLocalize();
  if (row.isNew) {
    return (
      <Badge
        tone="edited"
        dot
        label={localize('com_config_ce_state_new')}
        description={localize('com_config_ce_state_new_desc')}
      />
    );
  }
  if (!row.edited) return null;
  return (
    <Badge
      tone="edited"
      dot
      label={localize('com_config_ui_state_edited')}
      description={localize('com_config_ui_state_edited_desc')}
    />
  );
}

function rowDetails(row: t.EndpointRow, localize: t.LocalizeFn): string {
  const parts = [row.host ?? localize('com_config_ce_no_base_url')];
  parts.push(localize('com_config_ce_models_count', { count: row.modelCount }));
  if (row.fetchesModels) parts.push(localize('com_config_ce_models_fetched'));
  return parts.join(' · ');
}

/** Why an endpoint the layer beneath defines can't be deleted, pointing at Hide where the row offers it. */
function deleteLockKey(row: t.EndpointRow, hides: boolean): string {
  if (row.origin !== 'inherited') return 'com_config_ce_delete_locked';
  return hides
    ? 'com_config_ce_delete_locked_inherited_hide'
    : 'com_config_ce_delete_locked_inherited';
}

/** Whether a row can be deleted here: endpoints the layer beneath defines can't (D1). */
export function isDeletable(row: Pick<t.EndpointRow, 'origin'>): boolean {
  return row.origin === 'admin' || row.origin === 'scope';
}

/** A saved endpoint a pending edit removes: struck through, with Undo (D9). */
function RemovalRow({ removal, disabled, onUndo, notes }: t.EndpointRemovalRowProps) {
  const localize = useLocalize();
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--cui-color-stroke-default) px-3 py-2">
      <Monogram title={removal.title} muted />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-sm text-(--cui-color-text-muted) line-through"
          title={removal.title}
        >
          {removal.title}
        </span>
        <span className="text-xs text-(--cui-color-text-muted)">
          {localize('com_config_ctl_entry_pending_delete')}
        </span>
      </span>
      {!disabled && (
        <button
          type="button"
          onClick={() => onUndo(removal)}
          data-removal-undo={removal.key}
          aria-label={localize('com_config_ctl_entry_undo_a11y', { name: removal.title })}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-(--cui-color-stroke-default) bg-transparent px-2 py-1 text-xs text-(--cui-color-text-default) hover:bg-(--cui-color-background-hover)"
        >
          <DecorativeIcon name="history" size="sm" />
          {localize('com_config_ctl_entry_undo')}
        </button>
      )}
      {notes && <WarningList notes={notes} />}
    </li>
  );
}

/**
 * One endpoint of the list. Its row is the target the table of contents,
 * search and the review's "Go to field" reveal: while its editor is closed it
 * reads as collapsed (a closed grid marker), and the reveal's `config:expand`
 * opens the editor.
 */
function EndpointListRow({
  row,
  idPrefix,
  isOpen,
  disabled,
  onOpen,
  onReveal,
  onDelete,
  onRevert,
  override,
  hide,
}: t.EndpointListRowProps) {
  const localize = useLocalize();
  const rowRef = useRef<HTMLLIElement>(null);
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  const detailsId = `${idPrefix}-${row.index}-details`;

  useEffect(() => {
    const element = rowRef.current;
    if (!element) return;
    const reveal = () => onRevealRef.current(row);
    element.addEventListener('config:expand', reveal);
    return () => element.removeEventListener('config:expand', reveal);
  }, [row]);

  const viewOnly = disabled || (row.origin === 'inherited' && !row.overridden);
  const menu: t.KebabMenuItem[] = [
    {
      label: localize(viewOnly ? 'com_config_ce_action_view' : 'com_config_ce_action_edit'),
      icon: viewOnly ? 'eye' : 'pencil',
      onClick: () => onOpen(row),
    },
  ];
  if (!disabled && override && row.origin === 'inherited' && !row.overridden && !row.edited) {
    menu.push({ label: override.label, icon: 'pencil', onClick: () => override.onSelect(row) });
  }
  if (!disabled && row.overridden) {
    menu.push({
      label: localize('com_config_ce_action_revert'),
      icon: 'history',
      onClick: () => onRevert(row),
    });
  }
  const hides = !disabled && hide?.offers(row) === true;
  if (hide && hides) {
    const reason = hide.disabledReason(row);
    menu.push({
      label: hide.label,
      icon: 'eye-closed',
      disabled: reason !== undefined,
      title: reason,
      onClick: () => hide.onSelect(row),
    });
  }
  if (!disabled) {
    const deletable = isDeletable(row);
    menu.push({
      label: localize('com_config_ce_menu_delete'),
      icon: 'trash',
      danger: deletable,
      disabled: !deletable,
      title: deletable ? undefined : localize(deleteLockKey(row, hides)),
      onClick: () => onDelete(row),
    });
  }

  return (
    <li
      ref={rowRef}
      id={`${idPrefix}-${row.index}`}
      data-endpoint-row={row.identity ?? ''}
      className="group relative flex items-center gap-3 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-2 transition-colors hover:bg-(--cui-color-background-hover)"
    >
      {!isOpen && <span className="config-section-grid-closed" style={{ display: 'none' }} inert />}
      <Monogram title={row.title} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-describedby={detailsId}
            onClick={() => onOpen(row)}
            className="row-link max-w-full cursor-pointer truncate border-none bg-transparent p-0 text-start text-sm font-medium text-(--cui-color-text-default) after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-1 focus-visible:after:outline-(--cui-color-outline)"
            title={row.title}
          >
            {row.title}
          </button>
          <SourceBadge row={row} />
          <PendingBadge row={row} />
          <StatusBadge issues={row.issues} />
          <ServedBadge row={row} />
        </div>
        <span
          id={detailsId}
          className="flex min-w-0 items-center gap-1 text-xs text-(--cui-color-text-muted)"
        >
          <span className="truncate" title={row.host ?? undefined}>
            {rowDetails(row, localize)}
          </span>
          {row.fetchesModels && (
            <span className="flex shrink-0">
              <DecorativeIcon name="refresh" size="xs" />
            </span>
          )}
        </span>
      </div>
      <div className="relative z-1 shrink-0">
        <KebabMenu
          items={menu}
          ariaLabel={localize('com_config_ce_actions_a11y', { name: row.title })}
        />
      </div>
    </li>
  );
}

/**
 * The custom endpoint list (WS10 CE-7): one compact row per endpoint with its
 * monogram, name, host, model count (and whether the list is fetched), where
 * it comes from, its status and an actions menu. Selecting a row opens the
 * editor. Pending deletions stay listed with Undo until Save (D9).
 */
export function EndpointList({
  rows,
  removals,
  openKey,
  disabled,
  onOpen,
  onReveal,
  onDelete,
  onRevert,
  override,
  hide,
  onUndoRemoval,
  removalNotes,
  idPrefix,
}: t.EndpointListProps) {
  const localize = useLocalize();
  const items: Array<
    { kind: 'row'; row: t.EndpointRow } | { kind: 'removed'; removal: t.EndpointRemoval }
  > = rows.map((row) => ({ kind: 'row' as const, row }));
  for (const removal of [...removals].sort((a, b) => a.index - b.index)) {
    items.splice(Math.min(removal.index, items.length), 0, { kind: 'removed', removal });
  }

  return (
    <ul
      className="m-0 flex list-none flex-col gap-1.5 p-0"
      aria-label={localize('com_config_ce_list_label')}
    >
      {items.map((item) =>
        item.kind === 'removed' ? (
          <RemovalRow
            key={item.removal.key}
            removal={item.removal}
            disabled={disabled}
            onUndo={onUndoRemoval}
            notes={removalNotes?.(item.removal)}
          />
        ) : (
          <EndpointListRow
            key={item.row.key}
            row={item.row}
            idPrefix={idPrefix}
            isOpen={item.row.key === openKey}
            disabled={disabled}
            onOpen={onOpen}
            onReveal={onReveal}
            override={override}
            hide={hide}
            onDelete={onDelete}
            onRevert={onRevert}
          />
        ),
      )}
    </ul>
  );
}
