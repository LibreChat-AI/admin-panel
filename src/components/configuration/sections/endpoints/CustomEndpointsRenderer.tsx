import { Button } from '@clickhouse/click-ui';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type * as t from '@/types';
import {
  useLocalize,
  useValuesScope,
  useEndpointRows,
  useHiddenEntries,
  useConfigContract,
  useEntryOverrideNotes,
} from '@/hooks';
import {
  isRowVisible,
  isConfigRecord,
  formatKeyedPath,
  entryIdentityOf,
  getKeyedCollection,
  getSecretCarry,
  isAddressableEntryKey,
  findHiddenEndpointUses,
} from '@/utils';
import { EndpointList, SourceBadge, StatusBadge, Badge, isDeletable } from './List';
import { RevealTargetContext } from '@/contexts/RevealTargetContext';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { ConfigErrorsContext } from '@/contexts/ConfigErrorsContext';
import { describeOverrideNotes, sourceLabel } from '../../values';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { EndpointHiddenList } from './Hidden';
import { endpointHost, modelNames } from './model';
import { SearchInput } from '@/components/shared';
import { revealConfigPath } from '../../reveal';
import { EndpointCreator } from './Create';
import { EndpointDrawer } from './Drawer';
import { EndpointEditor } from './Editor';
import { Banner } from './Banner';

/** Shown once the list is long enough that scanning it is slower than typing. */
const FILTER_THRESHOLD = 6;

/** Whether every word of the query appears in the name, host or a model of an endpoint. */
function matchesFilter(
  item: t.EndpointRemoval | t.EndpointRow | t.EndpointHiddenItem,
  query: string,
): boolean {
  if (query === '') return true;
  const { title, value } = 'entry' in item ? { title: item.entry.name, value: undefined } : item;
  const baseURL = isConfigRecord(value) ? value.baseURL : undefined;
  const haystack = [title, endpointHost(baseURL) ?? '', ...modelNames(value)]
    .join('\n')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** The first field inside an entry the tab filter matched (`baseURL`), to open the editor at. */
function filterMatchIn(filter: t.PathIndex | null, entryPath: string): string | undefined {
  if (!filter) return undefined;
  const prefix = `${entryPath}.`;
  for (const path of filter.paths) {
    if (path.startsWith(prefix)) return path.slice(prefix.length);
  }
  return undefined;
}

/** `endpoints.custom.3.baseURL` → index 3 and field `baseURL`, for a path inside the list. */
function locateEntry(path: string, listPath: string): { index: number; field?: string } | null {
  if (!path.startsWith(`${listPath}.`)) return null;
  const [segment, ...rest] = path.slice(listPath.length + 1).split('.');
  if (!/^\d+$/.test(segment)) return null;
  return { index: Number(segment), field: rest.length > 0 ? rest.join('.') : undefined };
}

/**
 * Custom endpoints tab (WS10): a compact, filterable list of the endpoints
 * with where each comes from and whether it is served, and an editor drawer
 * per endpoint. Edits are staged on the page like every other setting and
 * saved per endpoint by name. Endpoints librechat.yaml (or, in a profile,
 * Base) defines can be overridden but not renamed or deleted (D1); in a
 * profile they open read-only until "Override for <profile>" (CE-8).
 */
export function CustomEndpointsRenderer(props: t.FieldRendererProps) {
  const { fields, parentPath, parentValue, getValue, onChange, disabled, editSessionId } = props;
  const { onHideField, onUnhideField } = props;
  const localize = useLocalize();
  const scope = useValuesScope();
  const { features, limits } = useConfigContract();
  const rowFilter = useContext(RowFilterContext);
  const revealTarget = useContext(RevealTargetContext);
  const effective = useContext(ConfigValuesContext)?.layers?.effective ?? null;
  const pageErrors = useContext(ConfigErrorsContext);
  const path = `${parentPath}.custom`;
  const collection = getKeyedCollection(path);
  const hiddenEntries = useHiddenEntries(path);
  const carriesKey = getSecretCarry(features).endpointRename;
  const overrideNotes = useEntryOverrideNotes(path);
  const customField = fields.find((field) => field.key === 'custom');
  const parentObj = isConfigRecord(parentValue) ? parentValue : {};
  const listValue = getValue(path, parentObj.custom ?? []);
  const items = useMemo(() => (Array.isArray(listValue) ? listValue : []), [listValue]);
  const { rows, removals, lowerEntry } = useEndpointRows({ path, items });
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [overriding, setOverriding] = useState<ReadonlySet<string>>(() => new Set());
  const [revealField, setRevealField] = useState<string | undefined>();
  const [openAfterCreate, setOpenAfterCreate] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<t.ConfigRecord>({});
  const lastRowIdRef = useRef('');
  const createButtonRef = useRef<HTMLDivElement>(null);
  const idPrefix = `section-${parentPath}-custom`;
  const scopeName = scope ? sourceLabel('scope', localize, scope) : '';

  /**
   * Names in the list, and those the profile hides or shows again on save: a new endpoint can't
   * take one (LibreChat would show it again, or the save would add it twice).
   */
  const names = useMemo(
    () => [
      ...rows.flatMap((row) => (row.identity ? [row.identity] : [])),
      ...[...hiddenEntries.hidden.values(), ...hiddenEntries.unhiding.values()].map(
        (entry) => entry.name,
      ),
    ],
    [rows, hiddenEntries],
  );
  /** Whether the profile hides the row's endpoint, as LibreChat matches names. */
  const isHiddenRow = (row: t.EndpointRow): boolean =>
    collection !== undefined &&
    row.loadedName !== undefined &&
    hiddenEntries.hidden.has(entryIdentityOf(collection, row.loadedName));
  /** The endpoints the profile hides or shows again, with the model specs that go with each. */
  const hiddenItems = useMemo((): t.EndpointHiddenItem[] => {
    const none: t.HiddenEndpointUses = {
      specs: [],
      addedEndpoints: 'none',
      allowedProviders: 'none',
    };
    const allHidden = new Set(hiddenEntries.hidden.keys());
    return [
      ...[...hiddenEntries.hidden].map(([identity, entry]) => ({
        identity,
        entry,
        unhiding: false,
        uses: findHiddenEndpointUses(effective, new Set([identity]), allHidden),
      })),
      ...[...hiddenEntries.unhiding].map(([identity, entry]) => ({
        identity,
        entry,
        unhiding: true,
        uses: none,
      })),
    ];
  }, [hiddenEntries, effective]);
  const modelsOf = useMemo(() => {
    const byName = new Map(rows.map((row) => [row.identity ?? '', modelNames(row.value)]));
    return (endpoint: string): readonly string[] => byName.get(endpoint) ?? [];
  }, [rows]);
  /** The names the endpoints were loaded with, the ones a pending edit removes included. */
  const loadedNames = useMemo(
    () =>
      new Set([
        ...rows.flatMap((row) => (row.loadedName === undefined ? [] : [row.loadedName])),
        ...removals.flatMap(({ value }) =>
          isConfigRecord(value) && typeof value.name === 'string' ? [value.name] : [],
        ),
      ]),
    [rows, removals],
  );
  const inheritedNames = useMemo(
    () => rows.filter((row) => row.origin === 'inherited').map((row) => row.loadedName ?? ''),
    [rows],
  );

  useEffect(() => {
    setOverriding(new Set());
  }, [editSessionId]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  /**
   * After a delete, keyboard focus goes to the pending deletion's Undo, else
   * (an endpoint never saved just goes) to the row that took its place, the
   * one before it, or Create. A frame later (not cancelled by the re-renders
   * that stage the delete), so the closing menu doesn't move it.
   */
  const focusAfterDeleteRef = useRef<t.EndpointRow | null>(null);
  useEffect(() => {
    const deleted = focusAfterDeleteRef.current;
    if (!deleted) return;
    focusAfterDeleteRef.current = null;
    requestAnimationFrame(() => {
      const list = listRef.current;
      const undo = deleted.loadedName
        ? list?.querySelector<HTMLElement>(
            `[data-removal-undo="${CSS.escape(`removed-${deleted.loadedName}`)}"]`,
          )
        : null;
      const rowButtons = [
        ...(list?.querySelectorAll<HTMLElement>('button[aria-haspopup="dialog"]') ?? []),
      ];
      const neighbour = rowButtons[Math.min(deleted.index, rowButtons.length - 1)];
      const fallback = createButtonRef.current?.querySelector<HTMLElement>('button');
      (undo ?? neighbour ?? fallback)?.focus();
    });
  }, [rows]);
  /** After Undo, focus goes to the restored row (its Undo button is gone), once it is back in the list. */
  const focusAfterUndoRef = useRef<string | null>(null);
  useEffect(() => {
    const name = focusAfterUndoRef.current;
    if (name == null) return;
    const restored = listRef.current?.querySelector<HTMLElement>(
      `[data-endpoint-row="${CSS.escape(name)}"] button[aria-haspopup="dialog"]`,
    );
    if (!restored) return;
    focusAfterUndoRef.current = null;
    requestAnimationFrame(() => restored.focus());
  }, [rows]);
  useEffect(() => {
    if (!revealTarget) return;
    const located = locateEntry(revealTarget, path);
    const row = located ? rowsRef.current[located.index] : undefined;
    if (!located || !row) return;
    setCreating(false);
    setOpenKey(row.key);
    setRevealField(located.field);
  }, [revealTarget, path]);

  useEffect(() => {
    if (!openAfterCreate) return;
    const row = rows.find((candidate) => candidate.isNew && candidate.identity === openAfterCreate);
    if (!row) return;
    setOpenAfterCreate(null);
    setOpenKey(row.key);
  }, [openAfterCreate, rows]);

  if (!customField) return null;
  const entryFields = customField.children ?? [];
  const open = openKey ? rows.find((row) => row.key === openKey) : undefined;
  if (open) {
    latestRef.current = open.value;
    lastRowIdRef.current = `${idPrefix}-${open.index}`;
  }
  const rowButton = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(
      `#${CSS.escape(lastRowIdRef.current)} button[aria-haspopup="dialog"]`,
    );

  const configuredOnly = Boolean(props.showConfiguredOnly) && scope != null;
  const trimmedQuery = query.trim();
  const visible = rows.filter(
    (row) =>
      !isHiddenRow(row) &&
      isRowVisible(rowFilter, `${path}.${row.index}`) &&
      matchesFilter(row, trimmedQuery) &&
      (!configuredOnly || row.overridden || row.edited || row.origin === 'scope'),
  );
  const shownRemovals = removals.filter((removal) => matchesFilter(removal, trimmedQuery));
  const shownHidden = hiddenItems.filter((item) => matchesFilter(item, trimmedQuery));

  const closeDrawer = () => {
    setOpenKey(null);
    setRevealField(undefined);
  };

  const handleFieldChange = (key: string, value: t.ConfigValue) => {
    if (!open) return;
    const next = { ...latestRef.current, [key]: value };
    if (value === undefined) delete next[key];
    latestRef.current = next;
    onChange(`${path}.${open.index}`, next);
  };

  const handleDelete = (row: t.EndpointRow) => {
    if (!isDeletable(row)) return;
    if (row.key === openKey) closeDrawer();
    focusAfterDeleteRef.current = row;
    onChange(
      path,
      items.filter((_, index) => index !== row.index),
    );
  };

  /** Back to what the layer beneath defines: the target's override of the endpoint is dropped on save. */
  const handleRevert = (row: t.EndpointRow) => {
    const lower = row.loadedName ? lowerEntry(row.loadedName) : undefined;
    if (!lower) return;
    onChange(`${path}.${row.index}`, lower);
  };

  /**
   * Hides an endpoint Base defines for the profile (`keyedTombstones`). Its
   * pending edits go first: LibreChat removes what the profile sets for it.
   */
  const handleHide = (row: t.EndpointRow) => {
    if (!onHideField || row.loadedName === undefined) return;
    if (row.key === openKey) closeDrawer();
    if (row.edited && row.saved) onChange(`${path}.${row.index}`, row.saved);
    onHideField(formatKeyedPath(path, row.loadedName));
  };

  const hide: t.EndpointHideAction | undefined =
    features.keyedTombstones && scope && onHideField && onUnhideField
      ? {
          label: localize('com_config_ce_action_hide', { scope: scopeName }),
          offers: (row) => row.origin === 'inherited' && !row.isNew,
          disabledReason: (row) =>
            isAddressableEntryKey(row.loadedName ?? '', limits.maxEntryKeyLength)
              ? undefined
              : localize('com_config_ce_hide_unaddressable'),
          onSelect: handleHide,
        }
      : undefined;

  /** Unhides a saved hide, or drops a pending hide or unhide (a second visibility edit of a path undoes the first). */
  const toggleHidden =
    onHideField && onUnhideField && !disabled
      ? (item: t.EndpointHiddenItem) =>
          item.unhiding ? onHideField(item.entry.path) : onUnhideField(item.entry.path)
      : undefined;

  const handleUndoRemoval = (removal: t.EndpointRemoval) => {
    const name = isConfigRecord(removal.value) ? removal.value.name : undefined;
    focusAfterUndoRef.current = typeof name === 'string' ? name : null;
    const at = Math.min(removal.restoreIndex, items.length);
    onChange(path, [...items.slice(0, at), removal.value, ...items.slice(at)]);
  };

  const handleCreate = (entry: t.ConfigRecord) => {
    onChange(path, [...items, entry]);
    setCreating(false);
    setOpenAfterCreate(typeof entry.name === 'string' ? entry.name : null);
  };

  const handleOverrideInstead = (name: string) => {
    setCreating(false);
    const row = rows.find((candidate) => candidate.loadedName === name);
    if (!row) return;
    setOverriding((prev) => new Set(prev).add(row.key));
    setOpenKey(row.key);
  };

  const readOnlyInherited =
    open != null && open.origin === 'inherited' && !open.overridden && !overriding.has(open.key);
  const editable = open != null && !disabled && !readOnlyInherited;

  const removalNotes = (removal: t.EndpointRemoval): string[] => {
    const name = isConfigRecord(removal.value) ? removal.value.name : undefined;
    return typeof name === 'string'
      ? describeOverrideNotes(overrideNotes.left(name), localize)
      : [];
  };

  /**
   * What an endpoint's pending change in Base does to the profiles that
   * override endpoints by name (`useEntryOverrideNotes`): a rename leaves
   * their overrides under the saved name, a rename or new endpoint onto a
   * name they still override takes theirs, and a moved destination stops the
   * keys of their own they store for it.
   */
  const profileNotesOf = (row: t.EndpointRow): t.EntryOverrideNote[] => {
    const { identity, loadedName } = row;
    if (identity === undefined) return [];
    const isSaved = loadedNames.has(identity);
    if (loadedName !== undefined && loadedName !== identity) {
      const taken = names.includes(loadedName);
      const left = overrideNotes.left(loadedName, { next: identity, taken });
      return isSaved ? left : [...left, ...overrideNotes.took(identity)];
    }
    if (!isSaved) return overrideNotes.took(identity);
    return overrideNotes.moved(identity, {
      lower: lowerEntry(identity),
      before: row.saved,
      after: row.value,
    });
  };

  /** The notes of a pending change on the profiles that override the endpoint by name. */
  const profileNotice = (row: t.EndpointRow) => {
    const notes = describeOverrideNotes(profileNotesOf(row), localize);
    if (notes.length === 0) return undefined;
    return (
      <Banner tone="warning" role="status">
        <span className="flex flex-col gap-1">
          {notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </span>
      </Banner>
    );
  };

  /**
   * A renamed endpoint whose stored key the save moves to its new name (a
   * batch `rename`, or the PATCH's `renames` hint with `renameHints`); none
   * while the entry has a problem of its own (a swap the save can't carry).
   */
  const renameNotice = (row: t.EndpointRow) => {
    const { loadedName, identity } = row;
    if (!carriesKey || !row.storedSecret || loadedName === undefined || identity === loadedName) {
      return undefined;
    }
    if (pageErrors?.[`${path}.${row.index}`] !== undefined) return undefined;
    return (
      <Banner tone="info" role="status">
        {localize(
          scope ? 'com_config_ce_renamed_key_moves_scope' : 'com_config_ce_renamed_key_moves',
          {
            name: loadedName,
            scope: scopeName,
          },
        )}
      </Banner>
    );
  };

  const drawerNotice = (row: t.EndpointRow) => {
    const notices = [originNotice(row), renameNotice(row), profileNotice(row)].filter(Boolean);
    if (notices.length <= 1) return notices[0];
    return <>{notices}</>;
  };

  const originNotice = (row: t.EndpointRow) => {
    if (row.origin === 'yaml') {
      return (
        <Banner
          tone="neutral"
          action={
            row.overridden && !disabled ? (
              <Button
                type="secondary"
                htmlType="button"
                iconLeft="history"
                label={localize('com_config_ce_action_revert')}
                onClick={() => handleRevert(row)}
              />
            ) : undefined
          }
        >
          {localize(
            row.overridden ? 'com_config_ce_notice_yaml_overridden' : 'com_config_ce_notice_yaml',
          )}
        </Banner>
      );
    }
    if (row.origin !== 'inherited') return undefined;
    if (readOnlyInherited) {
      return (
        <Banner
          tone="info"
          action={
            disabled ? undefined : (
              <Button
                type="primary"
                htmlType="button"
                label={localize('com_config_ce_override_for', { scope: scopeName })}
                onClick={() => setOverriding((prev) => new Set(prev).add(row.key))}
              />
            )
          }
        >
          {localize('com_config_ce_notice_inherited', { scope: scopeName })}
        </Banner>
      );
    }
    /** Overriding started but nothing changed yet: Cancel goes back to the read-only view. */
    const canCancel = !row.overridden && !row.edited && overriding.has(row.key);
    const action = (() => {
      if (disabled) return undefined;
      if (row.overridden) {
        return (
          <Button
            type="secondary"
            htmlType="button"
            iconLeft="history"
            label={localize('com_config_ce_remove_scope_overrides', { scope: scopeName })}
            onClick={() => handleRevert(row)}
          />
        );
      }
      if (!canCancel) return undefined;
      return (
        <Button
          type="secondary"
          htmlType="button"
          label={localize('com_ui_cancel')}
          onClick={() =>
            setOverriding((prev) => {
              const next = new Set(prev);
              next.delete(row.key);
              return next;
            })
          }
        />
      );
    })();
    return (
      <Banner tone="info" action={action}>
        {localize('com_config_ce_notice_inherited_override', { scope: scopeName })}
      </Banner>
    );
  };

  const drawerFooter = (row: t.EndpointRow) => (
    <>
      {!disabled && isDeletable(row) && (
        <Button
          type="danger"
          htmlType="button"
          iconLeft="trash"
          label={localize('com_config_ce_action_delete')}
          onClick={() => handleDelete(row)}
        />
      )}
      <span className="ml-auto text-xs text-(--cui-color-text-muted)">
        {editable ? localize('com_config_ce_drawer_staged') : null}
      </span>
      <Button
        type="primary"
        htmlType="button"
        label={localize('com_config_ce_done')}
        onClick={closeDrawer}
      />
    </>
  );

  const isEmpty = rows.length === 0 && removals.length === 0 && hiddenItems.length === 0;

  return (
    <div ref={listRef} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 py-1">
        {rows.length >= FILTER_THRESHOLD && (
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={localize('com_config_ce_filter_placeholder')}
            ariaLabel={localize('com_config_ce_filter_a11y')}
            className="w-full min-w-0 sm:w-auto sm:flex-1"
          />
        )}
        {!disabled && (
          <div className="ml-auto" ref={createButtonRef}>
            <Button
              type="secondary"
              htmlType="button"
              iconLeft="plus"
              label={localize('com_config_create_endpoint')}
              onClick={() => {
                closeDrawer();
                setCreating(true);
              }}
            />
          </div>
        )}
      </div>
      {isEmpty ? (
        <p className="m-0 py-3 text-sm text-(--cui-color-text-muted)">
          {localize(scope ? 'com_config_ce_empty_scope' : 'com_config_no_custom_endpoints')}
        </p>
      ) : (
        <>
          <EndpointList
            rows={visible}
            removals={shownRemovals}
            openKey={openKey}
            disabled={disabled}
            onOpen={(row) => {
              setRevealField(filterMatchIn(rowFilter, `${path}.${row.index}`));
              setOpenKey(row.key);
            }}
            onReveal={(row) => {
              setCreating(false);
              setOpenKey(row.key);
            }}
            onDelete={handleDelete}
            onRevert={handleRevert}
            override={
              scope
                ? {
                    label: localize('com_config_ce_override_for', { scope: scopeName }),
                    onSelect: (row) => {
                      setOverriding((prev) => new Set(prev).add(row.key));
                      setCreating(false);
                      setOpenKey(row.key);
                    },
                  }
                : undefined
            }
            hide={hide}
            onUndoRemoval={handleUndoRemoval}
            removalNotes={removalNotes}
            idPrefix={idPrefix}
          />
          <EndpointHiddenList items={shownHidden} onToggle={toggleHidden} />
          {visible.length === 0 && shownRemovals.length === 0 && shownHidden.length === 0 && (
            <p className="m-0 py-2 text-sm text-(--cui-color-text-muted)" role="status">
              {configuredOnly && trimmedQuery === ''
                ? localize('com_config_ce_none_set_in_scope', { scope: scopeName })
                : localize('com_config_ce_filter_empty', { query: trimmedQuery })}
            </p>
          )}
        </>
      )}
      <EndpointDrawer
        open={open != null}
        onClose={closeDrawer}
        title={open?.title ?? ''}
        badges={
          open ? (
            <>
              <SourceBadge row={open} />
              {open.isNew && (
                <Badge tone="edited" dot label={localize('com_config_ce_state_new')} />
              )}
              <StatusBadge issues={open.issues} />
            </>
          ) : undefined
        }
        subtitle={open?.host ?? undefined}
        notice={open ? drawerNotice(open) : undefined}
        footer={open ? drawerFooter(open) : null}
        bodyRef={bodyRef}
        returnFocus={rowButton}
      >
        {open && (
          <EndpointEditor
            key={open.key}
            path={`${path}.${open.index}`}
            fields={entryFields}
            value={open.value}
            onFieldChange={handleFieldChange}
            issues={open.issues}
            origin={open.origin}
            disabled={!editable}
            storedSecret={open.storedSecret}
            lowerEntry={open.loadedName ? lowerEntry(open.loadedName) : undefined}
            savedEntry={open.saved}
            ownEntry={open.own}
            modelsOf={modelsOf}
            showChips={!open.isNew}
            revealField={revealField}
            onRevealed={(fieldPath) => {
              const body = bodyRef.current;
              if (body) revealConfigPath(body, { path: fieldPath }, { align: 'center' });
            }}
            editSessionId={editSessionId}
            loadedName={open.loadedName}
            onHideField={onHideField}
            onUnhideField={onUnhideField}
          />
        )}
      </EndpointDrawer>
      <EndpointCreator
        open={creating}
        fields={entryFields}
        names={names}
        inheritedNames={inheritedNames}
        onCreate={handleCreate}
        onOverride={handleOverrideInstead}
        onClose={() => setCreating(false)}
        returnFocus={() => createButtonRef.current?.querySelector('button') ?? null}
      />
    </div>
  );
}
