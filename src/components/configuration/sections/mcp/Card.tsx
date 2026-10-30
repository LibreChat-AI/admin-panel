import { useEffect, useRef, useState } from 'react';
import type * as t from '@/types';
import { DecorativeIcon, KebabMenu, StateChip, WarningList } from '@/components/shared';
import { useExpandableState, useLocalize, useValuesScope } from '@/hooks';
import { RegionNameContext } from '@/contexts/RegionNameContext';
import { transportLabelKey, transportOf } from './transport';
import { sourceLabel } from '../../values';
import { cn, restoreFocusLater } from '@/utils';

/** Row-menu icons, the same as the custom endpoint rows'. */
const ACTION_ICONS: Readonly<Record<t.McpServerAction['id'], t.MenuIconName>> = {
  override: 'pencil',
  rename: 'pencil',
  duplicate: 'copy',
  revert: 'history',
  hide: 'eye-closed',
  delete: 'trash',
};

function toDomId(value: string): string {
  return value.replace(/[^\w-]+/g, '-');
}

/** One line under the title: the server's address or command, as a collapsed card's summary. */
function summaryOf(value: t.ConfigRecord): string | null {
  if (typeof value.url === 'string' && value.url !== '') return value.url;
  if (typeof value.command !== 'string' || value.command === '') return null;
  const args = Array.isArray(value.args) ? value.args.filter((arg) => typeof arg === 'string') : [];
  return [value.command, ...args].join(' ');
}

/** The source badge and override count of a card header (MCP-5). */
function SourceChips({ badges }: { badges: t.McpServerBadges }) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const scopeName = sourceLabel('scope', localize, scope);
  const source = ((): { kind: t.StateChipKind; label: string; description: string } => {
    switch (badges.source) {
      case 'yaml':
        return {
          kind: 'yaml',
          label: localize('com_config_ui_state_yaml'),
          description: localize('com_config_mcp_source_yaml_desc'),
        };
      case 'inherited':
        return {
          kind: 'inherited',
          label: localize('com_config_values_source_inherited'),
          description: localize('com_config_mcp_source_inherited_desc'),
        };
      case 'scope':
        return {
          kind: 'scope',
          label: localize('com_config_mcp_source_added_in', { scope: scopeName }),
          description: localize('com_config_ui_state_added_scope_desc'),
        };
      default:
        return {
          kind: 'override',
          label: localize('com_config_ui_state_added'),
          description: localize('com_config_ui_state_added_desc'),
        };
    }
  })();
  const overrideKind: t.StateChipKind = scope ? 'scope' : 'override';
  return (
    <>
      <StateChip kind={source.kind} label={source.label} description={source.description} />
      {badges.overrides > 0 && (
        <StateChip
          kind={overrideKind}
          label={localize(
            scope ? 'com_config_mcp_overrides_scope' : 'com_config_mcp_overrides_admin',
            { count: badges.overrides, scope: scopeName },
          )}
          description={localize(
            scope ? 'com_config_mcp_overrides_scope_desc' : 'com_config_mcp_overrides_admin_desc',
            { scope: scopeName },
          )}
        />
      )}
      {badges.edited && (
        <StateChip kind="edited" description={localize('com_config_ui_state_edited_desc')} />
      )}
    </>
  );
}

/** The rename input of a card header: Enter or blur commits, Escape cancels, a bad name stays with its error. */
function RenameInput({
  serverKey,
  onCommit,
  onCancel,
}: {
  serverKey: string;
  onCommit: (next: string) => string | null;
  onCancel: () => void;
}) {
  const localize = useLocalize();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(serverKey);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${toDomId(serverKey)}-rename-error`;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const next = draft.trim();
    if (next === '' || next === serverKey) {
      onCancel();
      return;
    }
    setError(onCommit(next));
  };

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2">
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          if (!error) commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        aria-label={localize('com_a11y_rename_entry', { name: serverKey })}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="config-input-ghost w-auto max-w-80 min-w-20 text-sm font-medium"
      />
      {error && (
        <span id={errorId} role="alert" className="text-xs text-(--cui-color-text-danger)">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * One MCP server (MCP-5, MCP-12, MCP-14): the header names it by its title
 * and key, its transport, where it comes from (librechat.yaml, Added in the
 * admin panel, Inherited, or added in the open profile), how many values the
 * edit target overrides and whether it has unsaved edits; Rename, Duplicate,
 * Delete and the profile actions sit in its actions menu. Follows Expand all
 * and `config:expand` / `config:collapse`.
 */
export function McpServerCard({
  serverKey,
  path,
  value,
  badges,
  actions,
  readOnlyNote,
  renaming,
  onRenameCommit,
  onRenameCancel,
  defaultExpanded,
  children,
}: t.McpServerCardProps) {
  const localize = useLocalize();
  const dataPath = `${path}.${serverKey}`;
  const domId = `section-${toDomId(path)}-${encodeURIComponent(serverKey)}`;
  const panelId = `${toDomId(dataPath)}-panel`;
  const factsId = `${panelId}-facts`;
  const cardRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(renaming);
  const userToggled = useRef(false);
  const [isExpanded, setIsExpanded] = useExpandableState(defaultExpanded, [dataPath]);
  const [hasEverExpanded, setHasEverExpanded] = useState(isExpanded);
  const title = typeof value.title === 'string' && value.title !== '' ? value.title : null;
  const transport = transportOf(value);
  const summary = summaryOf(value);

  useEffect(() => {
    if (isExpanded && !hasEverExpanded) setHasEverExpanded(true);
  }, [isExpanded, hasEverExpanded]);

  useEffect(() => {
    if (defaultExpanded && !userToggled.current) setIsExpanded(true);
  }, [defaultExpanded, setIsExpanded]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const expand = () => setIsExpanded(true);
    const collapse = () => setIsExpanded(false);
    el.addEventListener('config:expand', expand);
    el.addEventListener('config:collapse', collapse);
    return () => {
      el.removeEventListener('config:expand', expand);
      el.removeEventListener('config:collapse', collapse);
    };
  }, [setIsExpanded]);

  /**
   * Escape (or Enter on an unchanged name) takes the rename input away: focus
   * goes back to the header. Checked a frame later, since a blur that ends the
   * rename (a click or Tab elsewhere) is still moving focus to its target.
   */
  useEffect(() => {
    const was = wasRenaming.current;
    wasRenaming.current = renaming;
    if (was && !renaming) restoreFocusLater([() => headerRef.current]);
  }, [renaming]);

  useEffect(() => {
    if (!badges.isNew || !defaultExpanded) return;
    const card = cardRef.current;
    requestAnimationFrame(() => card?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }));
  }, [badges.isNew, defaultExpanded]);

  /**
   * The facts line sits above the header's stretched hit area so its chips'
   * and summary's tooltips show on hover; a click on it still opens or closes
   * the card, as a click anywhere else on the header does.
   */
  const toggleFromFacts = () => headerRef.current?.click();

  const menuItems: t.KebabMenuItem[] = actions.map((action) => ({
    label: action.label,
    icon: ACTION_ICONS[action.id],
    danger: action.danger,
    disabled: action.disabled,
    title: action.reason,
    onClick: action.onSelect,
  }));

  return (
    <div
      ref={cardRef}
      id={domId}
      data-entry-card
      data-mcp-server={serverKey}
      className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default)"
    >
      <div
        className={cn(
          'w-full rounded-lg transition-colors hover:bg-(--cui-color-background-hover)',
          renaming
            ? 'flex items-start gap-1 pe-2'
            : 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-2.5 pe-2 ps-3 has-[.row-link:focus-visible]:bg-(--cui-color-background-hover)',
          isExpanded
            ? 'sticky top-0 z-5 rounded-t-lg bg-(--cui-color-background-default)'
            : 'relative',
        )}
      >
        {renaming ? (
          <RenameInput serverKey={serverKey} onCommit={onRenameCommit} onCancel={onRenameCancel} />
        ) : (
          <>
            <span
              aria-hidden="true"
              className={cn(
                'flex items-center justify-center pt-0.5 transition-transform duration-200',
                isExpanded && 'rotate-90',
              )}
            >
              <DecorativeIcon name="chevron-right" size="sm" />
            </span>
            <button
              ref={headerRef}
              type="button"
              data-section-id={domId}
              aria-expanded={isExpanded}
              aria-controls={panelId}
              aria-describedby={factsId}
              onClick={() => {
                userToggled.current = true;
                setIsExpanded((prev) => !prev);
              }}
              className="row-link flex min-w-0 cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 border-none bg-transparent p-0 text-start select-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:outline-1 focus-visible:after:-outline-offset-1 focus-visible:after:outline-(--cui-color-outline)"
            >
              <span
                className="max-w-full truncate text-sm font-medium text-(--cui-color-text-default)"
                title={title ?? serverKey}
              >
                {title ?? serverKey}
              </span>
              {title && (
                <>
                  {' '}
                  <span
                    className="max-w-full truncate font-mono text-xs text-(--cui-color-text-muted)"
                    title={serverKey}
                  >
                    <span className="sr-only">{localize('com_config_mcp_server_key')}</span>{' '}
                    {serverKey}
                  </span>
                </>
              )}
              {badges.isNew && (
                <>
                  {' '}
                  <span className="rounded-full bg-(--cui-color-background-muted) px-1.5 py-0.5 text-xs font-semibold text-(--cui-color-text-default) uppercase">
                    {localize('com_config_ctl_entry_new')}
                  </span>
                </>
              )}
            </button>
            {menuItems.length > 0 && (
              <span className="relative z-1 row-span-2 -mt-0.5">
                <KebabMenu
                  items={menuItems}
                  ariaLabel={localize('com_config_mcp_actions', { name: serverKey })}
                />
              </span>
            )}
            <span
              id={factsId}
              onClick={toggleFromFacts}
              className="relative z-1 col-start-2 flex min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 select-none"
            >
              <SourceChips badges={badges} />
              <span
                className="min-w-0 flex-[1_1_12rem] truncate text-xs text-(--cui-color-text-muted)"
                title={summary ?? undefined}
              >
                {[
                  transport ? localize(transportLabelKey(transport)) : null,
                  isExpanded ? null : summary,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </>
        )}
      </div>
      <div
        id={panelId}
        className={cn(
          'config-section-grid',
          isExpanded ? 'config-section-grid-open' : 'config-section-grid-closed',
        )}
        inert={!isExpanded ? true : undefined}
      >
        <div className="config-section-inner">
          <div className="settings-card-body flex flex-col gap-2 border-t border-(--cui-color-stroke-default) px-2 py-3">
            {readOnlyNote}
            <RegionNameContext.Provider value={serverKey}>
              {hasEverExpanded && children}
            </RegionNameContext.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A server deleted in this session, until Save (D9): struck through, with Undo. */
export function McpDeletedRow({ serverKey, onUndo, focusUndo, notes }: t.McpDeletedRowProps) {
  const localize = useLocalize();
  const undoRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusUndo) undoRef.current?.focus();
  }, [focusUndo]);
  return (
    <div
      data-mcp-deleted={serverKey}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--cui-color-stroke-default) px-3 py-2.5"
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm">
        <span className="truncate text-(--cui-color-text-muted) line-through" title={serverKey}>
          {serverKey}
        </span>
        <span className="text-xs text-(--cui-color-text-muted)">
          {localize('com_config_ctl_entry_pending_delete')}
        </span>
      </span>
      <button
        ref={undoRef}
        type="button"
        onClick={onUndo}
        aria-label={localize('com_config_ctl_entry_undo_a11y', { name: serverKey })}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-solid border-(--cui-color-stroke-default) bg-transparent p-1.5 text-xs text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)"
      >
        <DecorativeIcon name="history" size="sm" />
        <span>{localize('com_config_ctl_entry_undo')}</span>
      </button>
      {notes && <WarningList notes={notes} />}
    </div>
  );
}

/** How a hidden server reads: saved or pending, and whether the hide also blocks its use. */
const HIDDEN_KEYS = {
  saved: { list: 'com_config_mcp_hidden', boundary: 'com_config_mcp_hidden_boundary' },
  pending: {
    list: 'com_config_mcp_hidden_pending',
    boundary: 'com_config_mcp_hidden_pending_boundary',
  },
} as const;

/** A server the open profile hides (MCP-10): its name, "Hidden for …", and Unhide (or Undo of a pending hide). */
export function McpHiddenRow({ serverKey, pending, blocksUse, onUnhide }: t.McpHiddenRowProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const scopeName = sourceLabel('scope', localize, scope);
  const label = localize(pending ? 'com_config_ctl_entry_undo' : 'com_config_mcp_unhide');
  return (
    <div
      data-mcp-hidden={serverKey}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--cui-color-stroke-default) px-3 py-2.5"
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm">
        <span className="flex shrink-0 text-(--cui-color-text-muted)">
          <DecorativeIcon name="eye-closed" size="sm" />
        </span>
        <span className="truncate text-(--cui-color-text-muted)" title={serverKey}>
          {serverKey}
        </span>
        <span className="text-xs text-(--cui-color-text-muted)">
          {localize(HIDDEN_KEYS[pending ? 'pending' : 'saved'][blocksUse ? 'boundary' : 'list'], {
            scope: scopeName,
          })}
        </span>
      </span>
      {onUnhide && (
        <button
          type="button"
          onClick={onUnhide}
          aria-label={localize(
            pending ? 'com_config_mcp_hide_undo_a11y' : 'com_config_mcp_unhide_a11y',
            {
              name: serverKey,
            },
          )}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-solid border-(--cui-color-stroke-default) bg-transparent p-1.5 text-xs text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)"
        >
          <DecorativeIcon name={pending ? 'history' : 'eye'} size="sm" />
          <span>{label}</span>
        </button>
      )}
    </div>
  );
}
