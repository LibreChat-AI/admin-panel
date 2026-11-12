import { Dropdown, Icon } from '@clickhouse/click-ui';
import { PrincipalType } from 'librechat-data-provider';
import type { AdminConfig } from '@librechat/data-schemas';
import type { ComponentProps, ReactNode } from 'react';
import type { StoredSecret, VisibilityEdit, EntryKeyMoveInput } from './changes';
import type { ConfigRecord, ConfigValue, SchemaField } from './config';

export type IconName = ComponentProps<typeof Icon>['name'];
export type MenuIconName = ComponentProps<typeof Dropdown.Item>['icon'];

export interface ConfigScope {
  _id?: string;
  principalType: PrincipalType;
  principalId: string;
  /** Role name, group name or user display name (the principal id when unresolved). */
  name: string;
  /** User profiles: the user's email, shown beside the name and matched by search. */
  email?: string;
  priority: number;
  /** Members of the role or group the profile applies to. */
  memberCount?: number;
  isActive: boolean;
  /** Leaf paths the profile overrides (an array value is one leaf). */
  overridePaths?: string[];
  /**
   * Identities of the entries the profile stores in each list LibreChat merges
   * entry by entry (`endpoints.custom` → `['Claude']`): one override each.
   */
  overrideEntries?: Record<string, string[]>;
  /**
   * The settings each of those entries sets, as leaf paths inside the entry
   * (`endpoints.custom` → `Claude` → `['baseURL']`), its name and secrets
   * left out.
   */
  overrideEntryPaths?: Record<string, Record<string, string[]>>;
  /** Paths the profile hides from the layers below it. */
  tombstones?: string[];
  /** The secrets the profile stores, read back only as their masked previews. */
  storedSecrets?: StoredSecret[];
}

/** A profile that overrides or hides a collection entry by its name (`findEntryOverrides`). */
export interface EntryOverride {
  scope: ConfigScope;
  /** It sets or adds settings of the entry. */
  overrides: boolean;
  /**
   * The secrets of its own it stores there, by where they are in the entry
   * (`apiKey.key`, `oauth.client_secret`; a custom endpoint's `apiKey`).
   */
  secrets: string[];
  /** The settings it sets there, as leaf paths inside the entry (`url`, `apiKey.authorization_type`). */
  settings: string[];
  /** It hides the entry. */
  hidden: boolean;
}

/**
 * What a save in Base does to an entry other profiles override by name
 * (`name`, the name they override it under):
 * - `renamed`: it gets the name `next`; `taken` when another entry holds the
 *   old name once the save is applied (a swap, a chain);
 * - `removed`: it goes;
 * - `moved`: it keeps its name but sends the keys they store there somewhere
 *   else (`findUnboundOverrides`);
 * - `took`: a rename or a new entry takes a name they still override, and
 *   LibreChat sends their own keys there to it unless it binds keys to where
 *   they were entered (`sendsKeys`).
 */
export type EntryOverrideChange =
  | { kind: 'renamed'; name: string; next: string; taken: boolean }
  | { kind: 'removed'; name: string }
  | { kind: 'moved'; name: string }
  | { kind: 'took'; name: string; sendsKeys: boolean };

/**
 * The notes a card in Base shows on an entry for the profiles that override
 * it by name (`useEntryOverrideNotes`), each empty when none is affected.
 */
export interface EntryOverrideNotes {
  /** A rename (`rename`) or a removal (without one) leaves their overrides of `name` under it. */
  left: (name: string, rename?: { next: string; taken: boolean }) => EntryOverrideNote[];
  /** The edits move where `name` sends the keys they store there (`entryKeyMoves`). */
  moved: (name: string, entry: EntryKeyMoveInput) => EntryOverrideNote[];
  /** A rename or a new entry takes `name`, which they still override. */
  took: (name: string) => EntryOverrideNote[];
}

/** A change in Base to an entry, and the profiles it affects that override it by name. */
export interface EntryOverrideNote {
  change: EntryOverrideChange;
  overrides: EntryOverride[];
  /** The collection of the entry (`endpoints.azureOpenAI.groups`), which words some changes its own way. */
  collection?: string;
}

export type ScopeSelection = { type: 'BASE' } | { type: 'SCOPE'; scope: ConfigScope };

export interface FieldProfileValue {
  scope: ConfigScope;
  value: NonNullable<ConfigValue>;
}

export interface ScopePermissions {
  canView: boolean;
  canEdit: boolean;
  /** Whether the user can create/delete scopes and manage profile values.
   *  Requires ASSIGN_CONFIGS or MANAGE_CONFIGS. Falls back to `canEdit` when
   *  not explicitly provided, preserving backwards compatibility. */
  canAssign?: boolean;
}

/** Principal types that can have config scopes (excludes PUBLIC). */
export type ScopePrincipalType = PrincipalType.ROLE | PrincipalType.GROUP | PrincipalType.USER;

/** A kind of principal as a picker lists it: its type and the locale key of its heading. */
export interface ScopePrincipalGroup {
  type: ScopePrincipalType;
  headingKey: string;
}

export interface ScopeTypeConfigEntry {
  icon: IconName;
  color: string;
  labelKey: string;
  badgeClass: string;
}

/**
 * Why a section cannot be set per profile, so in a profile it collapses into an
 * "Applies to everyone — edit in Base" card and its paths are never sent (WS8):
 * - `baseOnly`: the admin API strips it for every profile (e.g. content filters)
 * - `yamlOnly`: LibreChat reads it only from librechat.yaml (e.g. Turnstile)
 * - `tenantWide`: one tenant-wide setting with its own API (e.g. Langfuse)
 * - `preAuth`: read before sign-in, when no profile can apply (e.g. registration)
 */
export type ScopeGateReason = 'baseOnly' | 'yamlOnly' | 'tenantWide' | 'preAuth';

/** Another profile with the same priority that can apply to the same user. */
export interface ScopePriorityTie {
  scope: ConfigScope;
  /**
   * Paths both profiles set. Where they overlap, users in both get the value
   * of the profile that applies last: undefined before `deterministicPrecedence`.
   */
  sharedPaths: string[];
  /** Whether this profile applies after the one it ties with, so its values win (`deterministicPrecedence`). */
  appliesAfter: boolean;
}

/** Profile lookups shared by the selector, the context bar and the field cascade. */
export interface ScopeIndex {
  scopes: ConfigScope[];
  /** Profiles that override each path or something inside it. */
  byPath: ReadonlyMap<string, ConfigScope[]>;
}

/** Page-level scope actions for components rendered deep in the form (WS8). */
export interface ScopeActions {
  /** Switches profile through the page's unsaved-changes guard. */
  selectScope: (selection: ScopeSelection) => void;
  editingScope?: ConfigScope;
}

/** What the configuration page shares with the form: scope actions plus the profile index. */
export interface ScopeContextValue extends ScopeActions {
  index: ScopeIndex;
}

export interface ScopeActionsProviderProps {
  value: ScopeActions;
  children: ReactNode;
}

export interface ScopeBarProps extends Pick<
  ScopeOverridesDialogProps,
  | 'values'
  | 'pendingResets'
  | 'onRevert'
  | 'onUnhide'
  | 'visibility'
  | 'fields'
  | 'config'
  | 'onRevertEntry'
  | 'isEntryPending'
> {
  scope: ConfigScope;
  /** Switches to Base through the page's unsaved-changes guard. */
  onBackToBase: () => void;
  onError?: (message: string) => void;
  /** Whether the admin may change profile priorities (broad `manage:configs`). */
  canEditPriority?: boolean;
}

export interface ScopePriorityEditorProps {
  scope: ConfigScope;
  onError?: (message: string) => void;
}

export interface ScopeNotFoundProps {
  /** The `?scope=` value that matched no profile. */
  scopeParam: string;
  onEditBase: () => void;
  /** The profile was created; open it. */
  onCreated: (scope: ConfigScope) => void;
}

export interface ScopeGateProps {
  reason: ScopeGateReason;
  /** The section's title, named in the banner. */
  title: string;
  /** The section's config key, to count values the open profile still stores there. */
  section: string;
  /** The section's current values, rendered read-only. */
  children?: ReactNode;
}

/** One profile row in the scope selector. */
export interface ScopeRowProps {
  scope: ConfigScope;
  isSelected: boolean;
  /** Same-priority profiles that can apply to the same user. */
  ties: ScopePriorityTie[];
  onSelect: (scope: ConfigScope) => void;
  onDelete?: (scope: ConfigScope) => void;
  /** Why delete is unavailable (e.g. unsaved edits in this profile); disables the button. */
  deleteBlockedReason?: string;
  onToggleActive?: (scope: ConfigScope, isActive: boolean) => void;
  toggling?: boolean;
}

/** A role, group or user that can get a new profile, in the create picker. */
export interface ScopeCandidate {
  principalType: ScopePrincipalType;
  principalId: string;
  name: string;
  email?: string;
  description?: string;
}

/** What `createScopeFn` creates a profile for: the principal, its name and, optionally, a priority. */
export type CreateScopeInput = Pick<ConfigScope, 'principalType' | 'name' | 'email'> &
  Partial<Pick<ConfigScope, 'principalId' | 'priority'>>;

/** The "Overridden by …" link on a settings row in Base, opening the field's cascade. */
export interface ScopeCascadeProps {
  fieldPath: string;
  fieldLabel: string;
  /** Profiles that override the field, lowest priority first. */
  profiles: ConfigScope[];
}

/** The cascade of one field: Base, then each profile that overrides it, in priority order. */
export interface FieldCascadeListProps {
  fieldPath: string;
  profiles: ConfigScope[];
  onOpenProfile: (scope: ConfigScope) => void;
}

/** One setting a profile changes, as listed in its overrides summary. */
export interface ScopeOverrideItem {
  /** The setting's path (an MCP server's entry path for its fields). */
  path: string;
  /** Stored leaf paths behind the item; removing the override removes each. */
  paths: string[];
  /** The profile hides the inherited value (a tombstone) instead of setting one. */
  hidden: boolean;
  /** An entry of the list at `path` the profile overrides or adds, by identity (`Claude`). */
  entry?: string;
  /** A hide by key (`endpoints.custom["Name"].headers.X-Team`): its list, entry and path inside it. */
  keyed?: ScopeOverrideKeyed;
}

/** Where a hide by key of `ScopeOverrideItem` points: its list, the entry's name, and the path inside it. */
export interface ScopeOverrideKeyed {
  /** The list's path (`endpoints.custom`). */
  collection: string;
  name: string;
  /** The dotted path inside the entry; empty for the whole entry. */
  rest: string;
}

/** The keyed tombstones a profile holds for one entry of a list merged by key: a hide of it, removals inside it. */
export interface EntryKeyedHides {
  hidden: boolean;
  inside: boolean;
}

export interface ScopeOverridesDialogProps {
  open: boolean;
  scope: ConfigScope;
  /** The profile's own values by path, shown beside each override. */
  values?: Record<string, ConfigValue> | null;
  /** Paths already marked for removal in this edit session. */
  pendingResets?: ReadonlySet<string>;
  onClose: () => void;
  /** Marks an override's paths for removal; the change is reviewed and saved like any edit. */
  onRevert?: (paths: string[]) => void;
  /** Marks a hidden (tombstoned) value to be shown again; reviewed and saved like any edit (SV-9). */
  onUnhide?: (path: string) => void;
  /** Pending hides and unhides of this edit session, by path. */
  visibility?: Record<string, VisibilityEdit>;
  /** The schema tree, so values read like the page shows them (units, option labels). */
  fields?: SchemaField[];
  /** The page's config (pending edits included), to find where a list entry renders. */
  config?: ConfigRecord | null;
  /** Removes the profile's override of one list entry (or the entry it added); reviewed and saved like any edit. */
  onRevertEntry?: (collectionPath: string, identity: string) => void;
  /** Whether removing the override of a list entry is already pending. */
  isEntryPending?: (collectionPath: string, identity: string) => boolean;
}

/** A config document as the admin API lists it, tombstones included. */
export type ScopeConfigDoc = AdminConfig & { tombstones?: string[] };

/** What the admin directory says about a profile's principal (name, email, members). */
export interface PrincipalDetails {
  name: string;
  email?: string;
  memberCount?: number;
}
