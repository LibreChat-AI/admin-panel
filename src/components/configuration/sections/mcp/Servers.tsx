import { Button } from '@clickhouse/click-ui';
import { isProcessMCPServerConfig } from 'librechat-data-provider';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type * as t from '@/types';
import {
  isRowVisible,
  getSecretCarry,
  asConfigRecord,
  getValueAtPath,
  isConfigRecord,
  setValueAtPath,
  removeValueAtPath,
  isCarriableRename,
  findMovedServerCredentials,
} from '@/utils';
import { useLocalize, useValuesScope, useConfigFeatures, useEntryOverrideNotes } from '@/hooks';
import { previewedSecret, storedSecrets, usesSecret } from './validation';
import { ConfiguredOnlyContext } from '@/contexts/ConfiguredOnlyContext';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { McpDeletedRow, McpHiddenRow, McpServerCard } from './Card';
import { describeOverrideNotes, sourceLabel } from '../../values';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { RestatesContext } from '@/contexts/RestatesContext';
import { INSPECTOR_DERIVED, transportOf } from './transport';
import { RenamesContext } from '@/contexts/RenamesContext';
import { copyName, serverNameProblem } from './names';
import { buildServerList, leafEntries } from './list';
import { CreateMcpServerDialog } from './Create';
import { McpServerEditor } from './Editor';
import { labelForPath } from '../../meta';
import { McpNote } from './Note';

const EMPTY_RECORD: t.ConfigRecord = Object.freeze({}) as t.ConfigRecord;
const EMPTY_KEYS: ReadonlySet<string> = new Set();
const NO_MOVED_CREDENTIALS: ReadonlyMap<string, ReadonlyMap<string, t.MovedCredential>> = new Map();

/** A server's source badge, by edit target and whether the layer beneath defines it. */
const SOURCES: Readonly<
  Record<'base' | 'scope', Readonly<Record<'lower' | 'own', t.McpServerSource>>>
> = {
  base: { lower: 'yaml', own: 'admin' },
  scope: { lower: 'inherited', own: 'scope' },
};

/**
 * Leaves worth copying into a new server: values, not empty objects,
 * inspector data, or the masked preview the admin API returns for a stored
 * secret (the secret itself is never sent to the panel, so it can't be copied).
 */
function copyableLeaves(value: t.ConfigRecord): Array<[string[], t.ConfigValue]> {
  return leafEntries(value).filter(
    ([segments, leaf]) =>
      !INSPECTOR_DERIVED.has(segments[0]) &&
      leaf !== undefined &&
      leaf !== null &&
      !(isConfigRecord(leaf) && Object.keys(leaf).length === 0) &&
      previewedSecret(segments) == null,
  );
}

function countLeaves(value: t.ConfigValue): number {
  return isConfigRecord(value) ? leafEntries(value).length : 0;
}

/**
 * The servers a record of renamed or duplicated entries (`mcpServers.b` →
 * `mcpServers.a`) says each pending server comes from, by key, where
 * `isSource` accepts the server it names.
 */
function sourcesByServer(
  record: Readonly<Record<string, string>>,
  prefix: string,
  pending: ReadonlySet<string>,
  isSource: (key: string) => boolean,
): Readonly<Record<string, string>> {
  const sources: Record<string, string> = {};
  for (const [to, from] of Object.entries(record)) {
    if (!to.startsWith(prefix) || !from.startsWith(prefix)) continue;
    const key = to.slice(prefix.length);
    const source = from.slice(prefix.length);
    if (pending.has(key) && isSource(source)) sources[key] = source;
  }
  return sources;
}

/** The note of a renamed server: saved as a new one, or with the stored secrets the target (Base or the profile) moves. */
function renamedNoteKey(carried: boolean, inScope: boolean): string {
  if (!carried) return 'com_config_mcp_renamed_from';
  return inScope
    ? 'com_config_mcp_renamed_from_carried_scope'
    : 'com_config_mcp_renamed_from_carried';
}

/** Keys of the servers a set of tombstone paths hides (`mcpServers.github` → `github`). */
function hiddenServerKeys(paths: Iterable<string>, prefix: string): string[] {
  const keys: string[] = [];
  for (const tombstone of paths) {
    if (!tombstone.startsWith(prefix)) continue;
    const key = tombstone.slice(prefix.length);
    if (key !== '' && !key.includes('.')) keys.push(key);
  }
  return keys;
}

/**
 * The MCP servers editor (WS12): one card per server with a purpose-built
 * form, its provenance and an actions menu (Rename, Duplicate, Delete, and in
 * a profile Override fields, Hide, Remove overrides). Deletions stay listed
 * with Undo until Save (D9); servers librechat.yaml (or, in a profile, Base)
 * defines can be overridden but not renamed or deleted (D1); stdio servers
 * are defined only in librechat.yaml (D10). Field edits are written per leaf,
 * so a profile override stays sparse.
 */
export function McpServersRenderer({
  fields,
  parentPath: path,
  parentValue,
  getValue,
  onChange,
  onDiscardField,
  onHideField,
  onUnhideField,
  onRenameEntry,
  disabled,
  editedValues,
  yamlBaseKeys,
  isEditingScope,
  showConfiguredOnly,
  editSessionId,
}: t.FieldRendererProps) {
  const localize = useLocalize();
  const features = useConfigFeatures();
  const { dottedKeys, yamlMcpHide } = features;
  const carry = getSecretCarry(features);
  const scope = useValuesScope();
  const overrideNotes = useEntryOverrideNotes(path);
  const rowFilter = useContext(RowFilterContext);
  const valuesData = useContext(ConfigValuesContext);
  const { restates } = useContext(RestatesContext);
  const { renames, copies } = useContext(RenamesContext);
  const layers = valuesData?.layers ?? null;
  const inScope = Boolean(isEditingScope) && layers?.scope != null;
  const prefix = `${path}.`;
  const edits = editedValues ?? EMPTY_RECORD;
  /** The saved servers: the page's values already show pending edits, which the list applies itself. */
  const saved = asConfigRecord(
    layers ? getValueAtPath(layers.effective, path) : getValue(path, parentValue ?? EMPTY_RECORD),
  );
  const lower = useMemo(
    () => asConfigRecord(getValueAtPath(inScope ? layers?.base : layers?.yamlEffective, path)),
    [inScope, layers, path],
  );
  const stored = useMemo(
    () =>
      asConfigRecord(
        getValueAtPath(inScope ? layers?.scope?.overrides : layers?.baseOverrides, path),
      ),
    [inScope, layers, path],
  );
  const lowerKeys = useMemo<ReadonlySet<string>>(
    () => (inScope ? new Set(Object.keys(lower)) : (yamlBaseKeys ?? EMPTY_KEYS)),
    [inScope, lower, yamlBaseKeys],
  );
  const yamlKeys = yamlBaseKeys ?? EMPTY_KEYS;
  const list = useMemo(
    () => buildServerList({ saved, lower, editedValues: edits, path }),
    [saved, lower, edits, path],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const [lastDeleted, setLastDeleted] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [focusHiddenKey, setFocusHiddenKey] = useState<string | null>(null);
  const stash = useRef(new Map<string, Array<[string, t.ConfigValue]>>());
  /** A deleted server's pending rename (original → new name), restored with Undo. */
  const renameStash = useRef(new Map<string, string>());
  const createRef = useRef<HTMLSpanElement>(null);

  /**
   * Keyboard focus follows a server whose control went away (a rename, an
   * undone delete, a new or unhidden server); with no server left to focus
   * (the last unsaved one deleted), it goes to Create MCP server.
   */
  useEffect(() => {
    if (focusKey == null) return;
    const frame = requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(
        `[data-mcp-server="${CSS.escape(focusKey)}"] button[aria-expanded]`,
      );
      const target = card ?? createRef.current?.querySelector<HTMLElement>('button');
      target?.focus({ preventScroll: true });
      setFocusKey(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);

  /** A server hidden from its menu leaves focus on its Unhide (Undo) button. */
  useEffect(() => {
    if (focusHiddenKey == null) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-mcp-hidden="${CSS.escape(focusHiddenKey)}"] button`)
        ?.focus({ preventScroll: true });
      setFocusHiddenKey(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusHiddenKey]);

  /** A new edit session (Save, Discard) starts clean: no Undo of an earlier session's deletion survives. */
  useEffect(() => {
    setRenaming(null);
    setUnlocked(EMPTY_KEYS);
    setJustAdded(null);
    setLastDeleted(null);
    stash.current.clear();
    renameStash.current.clear();
  }, [editSessionId]);

  const discard = (editPath: string) => {
    if (onDiscardField) onDiscardField(editPath);
    else onChange(editPath, undefined);
  };
  const pendingUnder = (fullPath: string) =>
    Object.keys(edits).filter((p) => p === fullPath || p.startsWith(`${fullPath}.`));

  const pendingByServer = useMemo(() => {
    const keys = new Set<string>();
    for (const editPath of Object.keys(edits)) {
      if (!editPath.startsWith(prefix)) continue;
      keys.add(editPath.slice(prefix.length).split('.')[0]);
    }
    return keys;
  }, [edits, prefix]);

  /** The saved server each renamed server is, from the pending renames (so Discard → Undo keeps it). */
  const renamedFrom = useMemo(
    () => sourcesByServer(renames, prefix, pendingByServer, (key) => Object.hasOwn(saved, key)),
    [renames, prefix, pendingByServer, saved],
  );
  /** The server each duplicate copies, from the pending copies (so Discard → Undo keeps it). */
  const copiedFrom = useMemo(
    () => sourcesByServer(copies, prefix, pendingByServer, () => true),
    [copies, prefix, pendingByServer],
  );

  /**
   * A renamed or duplicated server whose edits went from outside the card (a
   * change review Revert) is gone: so is the record of what it comes from,
   * so a server created later under its name isn't taken for it.
   */
  useEffect(() => {
    for (const to of [...Object.keys(renames), ...Object.keys(copies)]) {
      if (to.startsWith(prefix) && !pendingByServer.has(to.slice(prefix.length))) {
        onRenameEntry?.(to, null);
      }
    }
  }, [pendingByServer, renames, copies, prefix, onRenameEntry]);

  /**
   * Inherited secrets LibreChat no longer sends for the target
   * (`secretRebinding`): its overrides, pending edits included, move them
   * somewhere new without entering them. By server, then secret.
   */
  const movedByServer = useMemo(() => {
    if (!features.secretRebinding) return NO_MOVED_CREDENTIALS;
    let own: t.ConfigRecord = stored;
    for (const [editPath, value] of Object.entries(edits)) {
      if (!editPath.startsWith(prefix)) continue;
      const rest = editPath.slice(prefix.length);
      own = value === undefined ? removeValueAtPath(own, rest) : setValueAtPath(own, rest, value);
    }
    return findMovedServerCredentials(own, lower, restates);
  }, [features.secretRebinding, stored, edits, prefix, lower, restates]);

  const visibility = valuesData?.visibilityEdits ?? EMPTY_RECORD;
  /** Servers the profile hides (true while the hide is unsaved), and hidden ones it is about to show again. */
  const { hidden, unhiding } = useMemo(() => {
    const hiddenKeys = new Map<string, boolean>();
    const unhidingKeys = new Set<string>();
    if (!inScope) return { hidden: hiddenKeys, unhiding: unhidingKeys };
    for (const key of hiddenServerKeys(layers?.scope?.tombstones ?? [], prefix)) {
      if (visibility[`${prefix}${key}`] === 'unhide') unhidingKeys.add(key);
      else hiddenKeys.set(key, false);
    }
    for (const [visibilityPath, edit] of Object.entries(visibility)) {
      if (edit !== 'hide') continue;
      for (const key of hiddenServerKeys([visibilityPath], prefix)) hiddenKeys.set(key, true);
    }
    return { hidden: hiddenKeys, unhiding: unhidingKeys };
  }, [inScope, layers, prefix, visibility]);

  const allKeys = useMemo(
    () => new Set([...Object.keys(list.record), ...hidden.keys()]),
    [list.record, hidden],
  );

  const writeLeaves = (key: string, value: t.ConfigRecord) => {
    for (const [segments, leaf] of copyableLeaves(value)) {
      onChange(`${prefix}${key}.${segments.join('.')}`, leaf);
    }
  };

  /** Removes one key of a server: its pending edits go, and a saved value is reset. */
  const removeLeafKey = (key: string, leaf: string) => {
    const fullPath = `${prefix}${key}.${leaf}`;
    pendingUnder(fullPath).forEach(discard);
    if (getValueAtPath(saved[key], leaf) !== undefined) onChange(fullPath, undefined);
  };

  /**
   * Drops the pending removal of a setting the saved server stores, so it is
   * kept as saved, stored secrets included. False when nothing was removed.
   */
  const restoreSaved = (key: string, leaf: string): boolean => {
    const fullPath = `${prefix}${key}.${leaf}`;
    if (!Object.hasOwn(edits, fullPath) || edits[fullPath] !== undefined) return false;
    if (getValueAtPath(saved[key], leaf) === undefined) return false;
    pendingUnder(fullPath).forEach(discard);
    return true;
  };

  /**
   * Applies a transport or authentication switch. Switching back to a
   * method whose settings the saved server stores (an API key or OAuth after
   * None) drops their pending removal, so they are kept as saved.
   */
  const applyPlan = (key: string, plan: t.McpSwitchPlan) => {
    plan.prune.forEach((leaf) => removeLeafKey(key, leaf));
    const restored = new Set((plan.restore ?? []).filter((leaf) => restoreSaved(key, leaf)));
    for (const [leaf, value] of plan.set) {
      if (restored.has(leaf)) continue;
      if (isConfigRecord(value)) {
        for (const [segments, child] of leafEntries(value)) {
          onChange(`${prefix}${key}.${leaf}.${segments.join('.')}`, child);
        }
      } else {
        onChange(`${prefix}${key}.${leaf}`, value);
      }
    }
  };

  /** Drops a server's pending edits and, for a saved one, stages its removal (D9). */
  const removeServer = (key: string, keepForUndo: boolean) => {
    const entryPath = `${prefix}${key}`;
    const pending = pendingUnder(entryPath);
    if (keepForUndo)
      stash.current.set(
        key,
        pending.map((p) => [p, edits[p]]),
      );
    pending.forEach(discard);
    if (Object.hasOwn(saved, key)) onChange(entryPath, undefined);
  };

  /** The server listed next to `key` (after it, else before it), for focus once it goes. */
  const neighbourOf = (key: string): string | null => {
    const keys = rows.flatMap((row) => (row.kind === 'server' ? [row.key] : []));
    const at = keys.indexOf(key);
    return keys[at + 1] ?? keys[at - 1] ?? null;
  };

  /**
   * Deletes a server (D9). A saved one stays listed with Undo. A server
   * renamed in this session is deleted under its saved name, so the saved
   * server's row (and its Undo, which brings the rename back) shows. An
   * unsaved one is simply gone, and focus moves to its neighbour.
   */
  const handleDelete = (key: string) => {
    if (key.includes('.')) return;
    const original = renamedFrom[key];
    if (original !== undefined) {
      const entryPath = `${prefix}${original}`;
      stash.current.set(original, [
        [entryPath, undefined],
        ...pendingUnder(`${prefix}${key}`).map((p): [string, t.ConfigValue] => [p, edits[p]]),
      ]);
      renameStash.current.set(original, key);
      pendingUnder(`${prefix}${key}`).forEach(discard);
      onRenameEntry?.(`${prefix}${key}`, null);
      setLastDeleted(original);
      return;
    }
    if (!Object.hasOwn(saved, key)) setFocusKey(neighbourOf(key) ?? '');
    if (copiedFrom[key] !== undefined) onRenameEntry?.(`${prefix}${key}`, null);
    removeServer(key, true);
    setLastDeleted(key);
  };

  const handleUndoDelete = (key: string) => {
    pendingUnder(`${prefix}${key}`).forEach(discard);
    for (const [editPath, value] of stash.current.get(key) ?? []) onChange(editPath, value);
    stash.current.delete(key);
    const renamed = renameStash.current.get(key);
    renameStash.current.delete(key);
    if (renamed !== undefined) onRenameEntry?.(`${prefix}${key}`, `${prefix}${renamed}`);
    setLastDeleted(null);
    setFocusKey(renamed ?? key);
  };

  const handleRevertAll = (key: string) => {
    pendingUnder(`${prefix}${key}`).forEach(discard);
    onChange(`${prefix}${key}`, undefined);
  };

  /**
   * The highest location of `segments` that `value` leaves empty
   * (`apiKey` for `apiKey.source` once API key authentication is gone).
   */
  const removedAt = (value: t.ConfigRecord, segments: string[]): string | undefined => {
    for (let depth = 1; depth <= segments.length; depth++) {
      const location = segments.slice(0, depth).join('.');
      if (getValueAtPath(value, location) === undefined) return location;
    }
    return undefined;
  };

  /**
   * A server renamed back to the saved name it started from is that saved
   * server again: its pending removal goes, and only what changed since
   * stays an edit (nothing, after a rename and back), so it keeps its stored
   * secrets where they are.
   */
  const restoreRenamed = (key: string, original: string, value: t.ConfigRecord) => {
    removeServer(key, false);
    pendingUnder(`${prefix}${original}`).forEach(discard);
    for (const [segments, leaf] of copyableLeaves(value)) {
      onChange(`${prefix}${original}.${segments.join('.')}`, leaf);
    }
    const removed = new Set(
      copyableLeaves(asConfigRecord(saved[original])).flatMap(([segments]) => {
        const location = removedAt(value, segments);
        return location === undefined ? [] : [location];
      }),
    );
    removed.forEach((location) => onChange(`${prefix}${original}.${location}`, undefined));
    onRenameEntry?.(`${prefix}${key}`, `${prefix}${original}`);
  };

  const handleRename = (key: string, next: string): string | null => {
    const others = [...allKeys].filter((name) => name !== key);
    const problem = serverNameProblem(next, others);
    if (problem) return localize(problem);
    const value = asConfigRecord(list.record[key]);
    /** The saved server this one is (a rename of). */
    const original = renamedFrom[key] ?? (Object.hasOwn(saved, key) ? key : undefined);
    if (original === next && next !== key) {
      restoreRenamed(key, original, value);
      setRenaming(null);
      setFocusKey(next);
      return null;
    }
    removeServer(key, false);
    writeLeaves(next, value);
    onRenameEntry?.(`${prefix}${key}`, `${prefix}${next}`);
    setRenaming(null);
    setJustAdded(next);
    setFocusKey(next);
    return null;
  };

  /**
   * The stored secrets of saved server `source` its rename or copy `next`
   * must enter again: none where the server carries them there
   * (`isCarriableRename`: a swap or a chain onto a name the target stores
   * can't carry), else every one it stores.
   */
  const carriedSecrets = (source: string, next: string, allowed: boolean): string[] =>
    allowed && isCarriableRename(stored, lower, source, next)
      ? []
      : storedSecrets(asConfigRecord(saved[source]));

  /**
   * The stored secrets server `key` must enter again, derived from the
   * pending renames and copies: a renamed one, those its rename can't carry;
   * a duplicate, those its copy can't carry.
   */
  const reenterOf = (key: string): readonly string[] => {
    const original = renamedFrom[key];
    if (original !== undefined) return carriedSecrets(original, key, carry.mcpRename);
    const copied = copiedFrom[key];
    return copied === undefined ? [] : carriedSecrets(copied, key, carry.mcpCopy);
  };

  /** The saved server whose stored secrets server `key` takes along on save (a carried rename or copy). */
  const carriedSourceOf = (key: string): string | undefined => {
    const renamed = renamedFrom[key];
    if (renamed !== undefined) {
      return carry.mcpRename && isCarriableRename(stored, lower, renamed, key)
        ? renamed
        : undefined;
    }
    const copied = copiedFrom[key];
    if (copied === undefined) return undefined;
    return carry.mcpCopy && isCarriableRename(stored, lower, copied, key) ? copied : undefined;
  };

  /**
   * The stored secrets server `key` has: those it reads back as previews,
   * those of the saved server it takes along on save (a carried rename or
   * copy shows none of its own), and those it still needs entered.
   */
  const secretsOf = (key: string, value: t.ConfigRecord): string[] => {
    const carriedSource = carriedSourceOf(key);
    const carried =
      carriedSource === undefined ? [] : storedSecrets(asConfigRecord(saved[carriedSource]));
    return [...new Set([...reenterOf(key), ...storedSecrets(value), ...carried])];
  };

  /**
   * Duplicates a server under a free name. A copy of a server with stored
   * secrets is recorded (`copies`): they come along only where the server
   * copies them (`mcpCopy`) from a server the target stores itself, and
   * otherwise must be entered again (`reenterOf`).
   */
  const handleDuplicate = (key: string) => {
    const value = asConfigRecord(list.record[key]);
    const name = copyName(key, allKeys);
    const title = typeof value.title === 'string' ? `${value.title} copy` : undefined;
    writeLeaves(name, title ? { ...value, title } : value);
    if (secretsOf(key, value).length > 0) {
      onRenameEntry?.(`${prefix}${key}`, `${prefix}${name}`, true);
    }
    setJustAdded(name);
    setFocusKey(name);
  };

  /** The secrets a duplicate still needs entered (none once each one has a value, or its authentication is gone). */
  const missingSecretsOf = (key: string, value: t.ConfigRecord): string[] =>
    reenterOf(key).filter((secret) => {
      const current = getValueAtPath(value, secret);
      return usesSecret(value, secret) && (typeof current !== 'string' || current === '');
    });

  const handleCreate = (name: string, entry: t.ConfigRecord) => {
    writeLeaves(name, entry);
    setJustAdded(name);
    setFocusKey(name);
  };

  /** Back to the read-only inherited card, before anything was changed. */
  const handleCancelOverride = (key: string) => {
    setUnlocked((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setFocusKey(key);
  };

  const handleOverride = (key: string) => {
    setUnlocked((prev) => new Set(prev).add(key));
    setJustAdded(key);
    setFocusKey(key);
  };

  const scopeName = sourceLabel('scope', localize, scope);
  const renamedAway = useMemo(() => new Set(Object.values(renamedFrom)), [renamedFrom]);

  /**
   * What a server's pending change in Base does to the profiles that override
   * servers by name (`useEntryOverrideNotes`): a rename leaves their
   * overrides under the saved name, a rename or new server onto a name they
   * still override takes theirs, and a moved destination stops the keys of
   * their own they store for it.
   */
  const profileNotesOf = (
    key: string,
    value: t.ConfigRecord,
    original?: string,
  ): t.EntryOverrideNote[] => {
    const isSaved = Object.hasOwn(saved, key);
    if (original !== undefined) {
      const taken = Object.hasOwn(list.record, original);
      const left = overrideNotes.left(original, { next: key, taken });
      return isSaved ? left : [...left, ...overrideNotes.took(key)];
    }
    if (!isSaved) return overrideNotes.took(key);
    return overrideNotes.moved(key, { lower: lower[key], before: saved[key], after: value });
  };

  const actionsFor = (key: string, value: t.ConfigRecord, overrides: number) => {
    const actions: t.McpServerAction[] = [];
    if (disabled || key.includes('.')) return actions;
    const isLower = lowerKeys.has(key);
    const isYaml = yamlKeys.has(key);
    const ownerReason = (() => {
      if (!inScope) return localize('com_config_mcp_locked_yaml');
      if (!isYaml) return localize('com_config_mcp_defined_in_base');
      /** With `yamlMcpHide`, a profile can hide a librechat.yaml server too. */
      return localize(
        yamlMcpHide
          ? 'com_config_mcp_defined_in_base_yaml_hide'
          : 'com_config_mcp_defined_in_base_yaml',
      );
    })();
    const isStdio = transportOf(value) === 'stdio';
    /** A stdio server from the layer beneath has nothing to offer: its read-only note says why. */
    if (isStdio && isLower) return actions;
    const isInheritedLocked =
      inScope && isLower && overrides === 0 && !unlocked.has(key) && !pendingByServer.has(key);
    if (isInheritedLocked && !isStdio) {
      actions.push({
        id: 'override',
        label: localize('com_config_mcp_override_fields', { scope: scopeName }),
        onSelect: () => handleOverride(key),
      });
    }
    actions.push({
      id: 'rename',
      label: localize('com_config_mcp_action_rename'),
      onSelect: () => setRenaming(key),
      disabled: isLower,
      reason: isLower ? ownerReason : undefined,
    });
    actions.push({
      id: 'duplicate',
      label: localize('com_config_mcp_action_duplicate'),
      onSelect: () => handleDuplicate(key),
      disabled: isStdio,
      reason: isStdio ? localize('com_config_mcp_transport_stdio_desc') : undefined,
    });
    if (isLower && overrides > 0) {
      actions.push({
        id: 'revert',
        label: localize(
          inScope ? 'com_config_mcp_action_revert_scope' : 'com_config_mcp_action_revert_yaml',
          { scope: scopeName },
        ),
        onSelect: () => handleRevertAll(key),
        disabled: list.reverted.has(key),
      });
    }
    if (inScope && isLower) {
      /** Before `yamlMcpHide`, LibreChat still lists and connects a librechat.yaml server a profile hides. */
      const yamlLocked = isYaml && !yamlMcpHide;
      actions.push({
        id: 'hide',
        label: localize('com_config_mcp_action_hide', { scope: scopeName }),
        onSelect: () => {
          onHideField?.(`${prefix}${key}`);
          setFocusHiddenKey(key);
        },
        disabled: yamlLocked || !onHideField,
        reason: yamlLocked ? localize('com_config_mcp_hide_yaml_unsupported') : undefined,
      });
    }
    actions.push({
      id: 'delete',
      label: localize('com_config_mcp_action_delete'),
      onSelect: () => handleDelete(key),
      disabled: isLower,
      reason: isLower ? ownerReason : undefined,
      danger: true,
    });
    return actions;
  };

  const badgesFor = (key: string): t.McpServerBadges => {
    const isLower = lowerKeys.has(key);
    return {
      source: SOURCES[inScope ? 'scope' : 'base'][isLower ? 'lower' : 'own'],
      overrides: isLower && !list.reverted.has(key) ? countLeaves(stored[key]) : 0,
      edited: pendingByServer.has(key) || unhiding.has(key),
      isNew: !Object.hasOwn(saved, key) && !lowerKeys.has(key),
    };
  };

  const isInheritedReadOnly = (key: string, overrides: number) =>
    inScope &&
    lowerKeys.has(key) &&
    overrides === 0 &&
    !unlocked.has(key) &&
    !pendingByServer.has(key) &&
    !unhiding.has(key);

  const rows = useMemo((): t.McpListRow[] => {
    const isShown = (key: string) => !rowFilter || isRowVisible(rowFilter, `${prefix}${key}`);
    const result: t.McpListRow[] = [];
    const deletedAt = new Map(list.deleted.map((ghost) => [ghost.index, ghost.key]));
    Object.keys(saved).forEach((key, index) => {
      const ghost = deletedAt.get(index);
      if (ghost !== undefined && !renamedAway.has(ghost) && !rowFilter) {
        result.push({ kind: 'deleted', key: ghost });
      }
      const value = list.record[key];
      if (value === undefined || hidden.has(key) || !isShown(key)) return;
      result.push({ kind: 'server', key, value: asConfigRecord(value) });
    });
    for (const [key, value] of Object.entries(list.record)) {
      if (Object.hasOwn(saved, key) || hidden.has(key) || !isShown(key)) continue;
      result.push({ kind: 'server', key, value: asConfigRecord(value) });
    }
    for (const key of unhiding) {
      if (!Object.hasOwn(list.record, key) && isShown(key)) {
        result.push({ kind: 'server', key, value: asConfigRecord(lower[key]) });
      }
    }
    if (rowFilter) {
      for (const ghost of list.deleted) {
        if (!renamedAway.has(ghost.key)) result.push({ kind: 'deleted', key: ghost.key });
      }
    }
    for (const [key, pending] of hidden) {
      if (isShown(key)) result.push({ kind: 'hidden', key, pending });
    }
    return result;
  }, [saved, list, hidden, unhiding, lower, rowFilter, prefix, renamedAway]);

  /** Under "Set values only", an inherited server the admin chose to override stays, with every field. */
  const visibleRows =
    showConfiguredOnly && inScope
      ? rows.filter(
          (row) =>
            row.kind !== 'server' ||
            !lowerKeys.has(row.key) ||
            pendingByServer.has(row.key) ||
            unlocked.has(row.key) ||
            countLeaves(stored[row.key]) > 0,
        )
      : rows;

  const isEmpty = visibleRows.length === 0;

  /** The server keys the open profile stores or edits (top-level keys of its override and edits). */
  const ownKeysOf = (key: string): ReadonlySet<string> => {
    const keys = new Set(Object.keys(asConfigRecord(stored[key])));
    const entryPrefix = `${prefix}${key}.`;
    for (const editPath of Object.keys(edits)) {
      if (editPath.startsWith(entryPrefix))
        keys.add(editPath.slice(entryPrefix.length).split('.')[0]);
    }
    return keys;
  };

  /** Unhide a saved hide, or drop a pending one; focus moves to the server's card. */
  const unhideFor = (key: string, hidePath: string, pending: boolean) => {
    if (!pending && !onUnhideField) return undefined;
    return () => {
      if (pending) discard(hidePath);
      else onUnhideField?.(hidePath);
      setFocusKey(key);
    };
  };

  /**
   * Why a card's fields are read-only: a dotted name (an older admin API drops
   * it; a newer one keeps it, but a field path can't address it), a
   * stdio server (LibreChat applies no override to it, so overrides stored
   * anyway can only be removed), or an inherited server not overridden yet.
   */
  const readOnlyNoteFor = (key: string, reason: t.McpReadOnlyReason | null, overrides: number) => {
    if (reason === 'dotted') {
      const noteKey = dottedKeys
        ? 'com_config_mcp_dotted_name_paths'
        : 'com_config_mcp_dotted_name';
      return <McpNote tone="lock">{localize(noteKey)}</McpNote>;
    }
    if (reason === 'process') {
      const canRemove = overrides > 0 && !disabled && !list.reverted.has(key);
      return (
        <McpNote
          tone="lock"
          actions={
            canRemove ? (
              <Button
                htmlType="button"
                type="secondary"
                label={localize('com_config_mcp_process_remove_overrides')}
                onClick={() => handleRevertAll(key)}
              />
            ) : undefined
          }
        >
          {localize(
            overrides > 0
              ? 'com_config_mcp_process_ignored_overrides'
              : 'com_config_mcp_process_read_only',
          )}
        </McpNote>
      );
    }
    if (disabled || !inScope || !lowerKeys.has(key)) return undefined;
    if (reason === 'inherited') {
      return (
        <McpNote
          tone="info"
          actions={
            <Button
              htmlType="button"
              type="primary"
              label={localize('com_config_mcp_override_fields', { scope: scopeName })}
              onClick={() => handleOverride(key)}
            />
          }
        >
          {localize('com_config_mcp_inherited_note', { scope: scopeName })}
        </McpNote>
      );
    }
    if (reason != null) return undefined;
    const canCancel = overrides === 0 && !pendingByServer.has(key) && unlocked.has(key);
    return (
      <McpNote
        tone="info"
        actions={
          canCancel ? (
            <Button
              htmlType="button"
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={() => handleCancelOverride(key)}
            />
          ) : undefined
        }
      >
        {localize('com_config_mcp_override_note', { scope: scopeName })}
      </McpNote>
    );
  };

  const readOnlyReason = (key: string, value: t.ConfigRecord, overrides: number) => {
    if (key.includes('.')) return 'dotted';
    if (isProcessMCPServerConfig(value)) return 'process';
    return isInheritedReadOnly(key, overrides) ? 'inherited' : null;
  };

  return (
    <ConfiguredOnlyContext.Provider value={Boolean(showConfiguredOnly)}>
      <div className="flex flex-col gap-2">
        {!disabled && (
          <div className="flex flex-wrap items-center gap-2 py-1">
            <span ref={createRef} className="ms-auto">
              <Button
                type="secondary"
                htmlType="button"
                iconLeft="plus"
                label={localize('com_config_create_mcp_server')}
                onClick={() => setCreateOpen(true)}
              />
            </span>
          </div>
        )}
        {isEmpty && (
          <p className="py-2 text-sm text-(--cui-color-text-muted)">
            {localize(
              showConfiguredOnly && inScope
                ? 'com_config_mcp_none_in_scope'
                : 'com_config_no_mcp_servers',
              { scope: scopeName },
            )}
          </p>
        )}
        {visibleRows.map((row) => {
          if (row.kind === 'deleted') {
            return (
              <McpDeletedRow
                key={`deleted-${row.key}`}
                serverKey={row.key}
                focusUndo={lastDeleted === row.key}
                onUndo={() => handleUndoDelete(row.key)}
                notes={describeOverrideNotes(overrideNotes.left(row.key), localize)}
              />
            );
          }
          if (row.kind === 'hidden') {
            const hidePath = `${prefix}${row.key}`;
            return (
              <McpHiddenRow
                key={`hidden-${row.key}`}
                serverKey={row.key}
                pending={row.pending}
                blocksUse={yamlMcpHide}
                onUnhide={disabled ? undefined : unhideFor(row.key, hidePath, row.pending)}
              />
            );
          }
          const { key, value } = row;
          const badges = badgesFor(key);
          const reason = readOnlyReason(key, value, badges.overrides);
          const readOnly = Boolean(disabled) || reason != null;
          const missingSecrets = missingSecretsOf(key, value);
          const carriedFrom = carriedSourceOf(key);
          const original = renamedFrom[key];
          const profileNotes = describeOverrideNotes(
            profileNotesOf(key, value, original),
            localize,
          );
          return (
            <McpServerCard
              key={key}
              serverKey={key}
              path={path}
              value={value}
              badges={badges}
              actions={actionsFor(key, value, badges.overrides)}
              readOnly={readOnly}
              readOnlyNote={readOnlyNoteFor(key, reason, badges.overrides)}
              renaming={renaming === key}
              onRenameCommit={(next) => handleRename(key, next)}
              onRenameCancel={() => setRenaming(null)}
              defaultExpanded={justAdded === key}
            >
              {original !== undefined && (
                <McpNote tone="info">
                  {localize(renamedNoteKey(carriedFrom !== undefined, inScope), {
                    name: original,
                    scope: scopeName,
                  })}
                </McpNote>
              )}
              {profileNotes.length > 0 && (
                <McpNote tone="warning">
                  <span className="flex flex-col gap-1">
                    {profileNotes.map((note) => (
                      <span key={note}>{note}</span>
                    ))}
                  </span>
                </McpNote>
              )}
              {copiedFrom[key] && carriedFrom !== undefined && (
                <McpNote tone="info">
                  {localize('com_config_mcp_copied_secrets', { name: copiedFrom[key] })}
                </McpNote>
              )}
              {!readOnly && missingSecrets.length > 0 && (
                <McpNote tone="info">
                  {localize('com_config_mcp_duplicate_secrets', {
                    fields: missingSecrets
                      .map((secret) => labelForPath(`${path}.{}.${secret}`, localize))
                      .join(', '),
                  })}
                </McpNote>
              )}
              <ConfiguredOnlyContext.Provider
                value={Boolean(showConfiguredOnly) && !unlocked.has(key)}
              >
                <McpServerEditor
                  fields={fields}
                  entryPath={`${prefix}${key}`}
                  entry={value}
                  lower={isConfigRecord(lower[key]) ? lower[key] : undefined}
                  onChange={(leaf, next) => onChange(`${prefix}${key}.${leaf}`, next)}
                  onSwitch={(plan) => applyPlan(key, plan)}
                  onDiscard={onDiscardField}
                  disabled={readOnly}
                  typeLocked={lowerKeys.has(key) || transportOf(value) === 'stdio'}
                  quiet={badges.isNew}
                  owned={!lowerKeys.has(key)}
                  ownKeys={inScope ? ownKeysOf(key) : undefined}
                  movedCredentials={movedByServer.get(key)}
                  carriedFrom={
                    carriedFrom === undefined ? undefined : asConfigRecord(saved[carriedFrom])
                  }
                  isPendingWhole={(leaf) => edits[`${prefix}${key}.${leaf}`] !== undefined}
                  editSessionId={editSessionId}
                />
              </ConfiguredOnlyContext.Provider>
            </McpServerCard>
          );
        })}
        <CreateMcpServerDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreate={handleCreate}
          onOverride={handleOverride}
          onUnhide={(key) => onUnhideField?.(`${prefix}${key}`)}
          fields={fields}
          existingKeys={allKeys}
          inheritedKeys={inScope ? lowerKeys : EMPTY_KEYS}
          hiddenKeys={new Set(hidden.keys())}
        />
      </div>
    </ConfiguredOnlyContext.Provider>
  );
}
