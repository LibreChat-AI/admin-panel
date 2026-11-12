import type { ReactNode } from 'react';
import type { ConfigRecord, ConfigValue, FlatConfigMap, SchemaField } from './config';
import type { PathErrors, MovedCredential } from './changes';
import type { FieldDefault } from './controls';

/**
 * How LibreChat connects to an MCP server (WS12). `http` is librechat.yaml's
 * alias of `streamable-http`, kept as written; `''` when nothing says.
 */
export type McpTransport = 'streamable-http' | 'http' | 'sse' | 'websocket' | 'stdio' | '';

/** How an MCP server authenticates (WS12, MCP-4): one method at a time. */
export type McpAuthMethod = 'none' | 'apiKey' | 'oauth' | 'obo';

/** A saved server a pending Delete removes, shown with Undo until Save (D9). */
export interface McpPendingDeletion {
  key: string;
  /** Position in the saved list, so the ghost row stays where the server was. */
  index: number;
  value: ConfigValue;
}

/** The server list as the page shows it: saved servers with pending edits applied. */
export interface McpServerList {
  record: ConfigRecord;
  /** Saved servers a pending Delete removes. */
  deleted: McpPendingDeletion[];
  /** Saved servers a pending revert returns to what the layer beneath defines. */
  reverted: ReadonlySet<string>;
}

/** Inputs of `buildServerList`. */
export interface McpServerListInput {
  /** Saved servers (effective for the edit target). */
  saved: ConfigRecord;
  /** Servers the layer beneath defines: librechat.yaml in Base, Base in a profile. */
  lower: ConfigRecord;
  /** Pending edits of the page (flat paths). */
  editedValues: FlatConfigMap;
  /** Data path of the record (`mcpServers`). */
  path: string;
}

/** Writes that switch a server to another transport or auth method. */
export interface McpSwitchPlan {
  /** Keys whose value goes away. */
  prune: string[];
  /** Keys to set (the new type, an auth method's prefilled defaults). */
  set: Array<[string, ConfigValue]>;
  /** Keys of the old choice the layer beneath sets: they can't be removed, so the switch is blocked. */
  locked: string[];
  /**
   * Keys of the chosen auth method the entry lacks: where the saved server
   * stores one a pending switch removed, the switch back keeps it as saved
   * (a stored key included) instead of starting it over.
   */
  restore?: string[];
}

/** Where a server comes from, for its card's source badge (MCP-5). */
export type McpServerSource = 'yaml' | 'admin' | 'inherited' | 'scope';

/** Header facts of one server card (MCP-5, MCP-10). */
export interface McpServerBadges {
  source: McpServerSource;
  /** Values the edit target stores in a server defined beneath it (Base overrides, or the open profile's). */
  overrides: number;
  /** Unsaved edits under the server. */
  edited: boolean;
  /** Created in this edit session. */
  isNew: boolean;
}

/** A menu action of a server card (MCP-10, MCP-12). */
export interface McpServerAction {
  id: 'rename' | 'duplicate' | 'delete' | 'revert' | 'hide' | 'override';
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Why it is disabled (tooltip). */
  reason?: string;
  danger?: boolean;
}

/** Props of the MCP server card (WS12). */
export interface McpServerCardProps {
  serverKey: string;
  /** Data path of the record (`mcpServers`). */
  path: string;
  value: ConfigRecord;
  badges: McpServerBadges;
  actions: McpServerAction[];
  /** Fields can't change here (no permission, a legacy dotted name, an inherited server not overridden yet). */
  readOnly: boolean;
  /** Shown at the top of the body: why the card is read-only, and how to change that. */
  readOnlyNote?: ReactNode;
  /** The card's rename input is open. */
  renaming: boolean;
  /** Renames the server; returns the reason when the name can't be used. */
  onRenameCommit: (next: string) => string | null;
  onRenameCancel: () => void;
  defaultExpanded: boolean;
  children: ReactNode;
}

/** What a field row hands a custom control: its id and name, its default, and "go back to it". */
export interface McpControlContext {
  id: string;
  label: string;
  fieldDefault: FieldDefault;
  /** Removes the own value; false when a value the layer beneath sets remains. */
  clear: () => boolean;
}

/** Props of one MCP server field row (WS12). */
export interface McpFieldRowProps {
  field: SchemaField;
  /** Data path of the object holding the field (`mcpServers.github`, `mcpServers.github.oauth`, the create dialog's draft). */
  entryPath: string;
  /** That object's shown value (pending edits applied). */
  entry: ConfigRecord;
  /** Writes one key of the object (`undefined` removes the own value). */
  onChange: (key: string, value: ConfigValue) => void;
  disabled?: boolean;
  /** Read-only because only librechat.yaml can set it (process fields, a YAML server's type). */
  lockReason?: string;
  /** Marks the label as required (inside a chosen auth method, a remote server's URL). */
  required?: boolean;
  /** Replaces the schema-driven control. */
  control?: ReactNode;
  /** Replaces the schema-driven control with one that needs the row's default handling. */
  renderControl?: (context: McpControlContext) => ReactNode;
  /** Shown under the control (icon preview, a format hint). */
  extra?: ReactNode;
  /** Discards a pending edit at a path (Undo on the row). */
  onDiscard?: (path: string) => void;
  /** No state chips: a server created in this session, or the create dialog. */
  quiet?: boolean;
  /** The edit target added the server: every value is its own, so no provenance chip or Revert. */
  owned?: boolean;
}

/** Props of a collapsible group inside a server card. */
export interface McpFieldGroupProps {
  title: string;
  description?: string;
  /** Data paths inside the group: it opens while the tab filter matches one, and is left out when none matches. */
  paths: string[];
  defaultExpanded: boolean;
  /** Fields with a value in the group, for the "N of M set" badge. */
  configured?: number;
  /** Whether a field in the group holds a value "Set values only" keeps; false hides the group then. */
  hasValues?: boolean;
  /** Fields in the group; `0` hides the badge. */
  total?: number;
  children: ReactNode;
}

/** Props of the purpose-built editor of one server (WS12). */
export interface McpEditorProps {
  fields: SchemaField[];
  entryPath: string;
  entry: ConfigRecord;
  /** What the layer beneath sets for this server: its record keys and auth method can't be removed. */
  lower: ConfigRecord | undefined;
  /** Writes one leaf of the server (`oauth.client_id`); `undefined` removes the own value. */
  onChange: (leaf: string, value: ConfigValue) => void;
  /** Applies a transport or auth-method switch. */
  onSwitch: (plan: McpSwitchPlan) => void;
  onDiscard?: (path: string) => void;
  disabled?: boolean;
  /** The server's transport can't change: librechat.yaml (or Base, in a profile) defines it. */
  typeLocked: boolean;
  /** The transport is chosen outside the editor (the create dialog's cards). */
  hideType?: boolean;
  /** Creating a server: Connection, Authentication and Display start open. */
  isDraft?: boolean;
  quiet?: boolean;
  /** See `McpFieldRowProps.owned`. */
  owned?: boolean;
  /** In a profile: the server keys the profile sets or edits, for "Set values only". */
  ownKeys?: ReadonlySet<string>;
  /**
   * Inherited secrets LibreChat no longer sends for this target
   * (`secretRebinding`), by where they are in the server (`apiKey.key`).
   */
  movedCredentials?: ReadonlyMap<string, MovedCredential>;
  /**
   * The saved server whose stored secrets this one takes along on save (a
   * rename or copy the server carries): its masked previews show on the
   * secret rows this one leaves unset.
   */
  carriedFrom?: ConfigRecord;
  /** Whether a pending edit writes the server's `leaf` whole (a record such as `customUserVars`). */
  isPendingWhole?: (leaf: string) => boolean;
  editSessionId?: number;
}

/** Props of the Add MCP server dialog (WS12, MCP-9). */
export interface CreateMcpServerDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, entry: ConfigRecord) => void;
  /** In a profile: open the inherited server of that name for overriding instead. */
  onOverride: (name: string) => void;
  /** In a profile: unhide the server of that name instead. */
  onUnhide: (name: string) => void;
  fields: SchemaField[];
  /** Every server name in the list. */
  existingKeys: ReadonlySet<string>;
  /** Servers the profile inherits from Base (empty in Base). */
  inheritedKeys: ReadonlySet<string>;
  /** Servers the profile hides. */
  hiddenKeys: ReadonlySet<string>;
}

/** The look of a note inside a server card: read-only (lock), information, or a warning. */
export type McpNoteTone = 'lock' | 'info' | 'warning';

/** Why a server's fields can't be edited here. */
export type McpReadOnlyReason = 'dotted' | 'process' | 'inherited';

/** One row of the MCP servers list: a server, one pending deletion, or one the profile hides. */
export type McpListRow =
  | { kind: 'server'; key: string; value: ConfigRecord }
  | { kind: 'deleted'; key: string }
  | { kind: 'hidden'; key: string; pending: boolean };

/** How a server's `serverInstructions` is set: LibreChat's default, off, the server's own, or custom text. */
export type McpInstructionsMode = 'default' | 'off' | 'server' | 'custom';

/** What a new server's draft still needs before Create (MCP-9). */
export interface McpDraftCheck {
  /** Labels of required fields still empty ("URL", "Scopes"). */
  missing: string[];
  /** Inline errors of fields that hold a value. */
  errors: PathErrors;
}

/** One pending edit of an MCP server: where in the server, and the value (WS12). */
export interface McpEntryEdit {
  segments: string[];
  value: ConfigValue;
}

/** An MCP server with its pending edits applied (WS12). */
export interface McpResolvedServer {
  value: ConfigValue | undefined;
  /** The latest whole-server edit reverts it to what the layer beneath defines. */
  reset: boolean;
}

/** A problem a save would leave an MCP server with, found before anything is sent. */
export interface McpCrossFieldError {
  entryKey: string;
  /** The field the server lacks, inside it (`url`, `apiKey.key`). */
  missingField: string;
  /** The saved server a renamed one comes from, whose stored secret the save can't move. */
  renamedFrom?: string;
}

/** Props of a saved server a pending edit deletes, listed with Undo (D9). */
export interface McpDeletedRowProps {
  serverKey: string;
  onUndo: () => void;
  focusUndo: boolean;
  /** What the deletion leaves in the profiles that override the server by name (`describeEntryOverrides`). */
  notes?: readonly string[];
}

/** Props of a server the open profile hides (MCP-10). */
export interface McpHiddenRowProps {
  serverKey: string;
  /** The hide is unsaved: the button undoes it. */
  pending: boolean;
  /** LibreChat refuses the server to the profile's members, not only lists it (`yamlMcpHide`). */
  blocksUse?: boolean;
  onUnhide?: () => void;
}
