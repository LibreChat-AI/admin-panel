import type {
  ConfigIssue,
  EntryKeyMove,
  StoredSecret,
  CredentialRef,
  VisibilityEdit,
  CollectionEdits,
  ConfigWarning,
  ChangeSummaryItem,
  ApplyConfigChangesResult,
} from './changes';
import type {
  ConfigTab,
  SaveEntry,
  SavePayload,
  WriteTarget,
  SkippedChange,
  SectionPermissionMap,
} from './config-ui';
import type {
  ConfigValue,
  ConfigRecord,
  SchemaField,
  FlatConfigMap,
  UnsafeConfigKey,
} from './config';
import type { ConfigScope, ScopeSelection, ScopePermissions } from './scope';
import type { ImportRequest } from './review';
import type { ValueLayers } from './values';

export type LocalizeFn = (key: string, options?: Record<string, string | number>) => string;

export type TranslationKeys = string;

/** The viewer's effective capabilities; `available` is false when LibreChat has no grants API. */
export interface CapabilitiesData {
  available: boolean;
  capabilities: string[];
}

export interface ReorderVoiceover {
  item: (position: number) => string;
  lifted: (position: number) => string;
  moved: (position: number, up: boolean) => string;
  dropped: (from: number, to: number) => string;
  canceled: (position: number) => string;
}

/** Options for `useConfigTabs` (WS5: page shell). */
export interface ConfigTabsOptions {
  schemaTree: SchemaField[];
  initialTab?: string;
}

/** Tabs the viewer can see, the active tab, and per-section permissions (WS5). */
export interface ConfigTabsState {
  sectionPermissions: SectionPermissionMap;
  visibleTabs: ConfigTab[];
  activeTab: string;
  handleTabChange: (tabId: string) => void;
  canManageConfig: boolean;
  canEditActiveTab: boolean;
  /** Route-level gating ensures canView; canEdit reflects the active tab's manage capability. */
  permissions: ScopePermissions;
}

/** Options for `useScopeSelection` (WS8: scopes and profiles). */
export interface ScopeSelectionOptions {
  /** `?scope=`: `role:USER`, `group:<id>`, `user:<id>` or a legacy `_id`; absent = Base (D7). */
  initialScope?: string;
}

/** The open profile (scope) and the scope selector dialog state (WS8). */
export interface ScopeSelectionState {
  selectedScope: ScopeSelection;
  /** Opens a scope by writing `?scope=` (and clearing `customized`/`field`). */
  selectScope: (selection: ScopeSelection) => void;
  isEditingScope: boolean;
  editingScope?: ConfigScope;
  scopeSelectorOpen: boolean;
  setScopeSelectorOpen: (open: boolean) => void;
  /** `?scope=` is set but the profile list is still loading (WS5). */
  isResolvingScope?: boolean;
  /** `?scope=` names no existing profile: the raw value, shown in a banner (WS5). */
  scopeNotFound?: string;
  /** The profile list `?scope=` is looked up in failed to load. */
  scopeLoadError?: Error | null;
  /** Loads the profile list again after `scopeLoadError`. */
  retryScopes: () => void;
}

/** Options for `useConfigLayers` (WS4: effective values). */
export interface ConfigLayersOptions {
  schemaTree: SchemaField[];
  selectedScope: ScopeSelection;
  sectionPermissions: SectionPermissionMap;
}

/** The config layers the page reads: base, librechat.yaml, overrides and the open profile (WS4). */
export interface ConfigLayers {
  /** Effective base config: librechat.yaml merged with the base admin overrides. */
  configValues: Record<string, ConfigValue> | null;
  /** The base (`__base__`) admin overrides. */
  dbOverrides?: Record<string, ConfigValue>;
  /** librechat.yaml alone (no admin overrides): what a base field reverts to (`yamlEffective`). */
  yamlConfig?: ConfigRecord;
  /** MCP servers defined in librechat.yaml. */
  yamlMcpServers?: Record<string, ConfigValue>;
  schemaDefaults: FlatConfigMap;
  /** The edit target's effective values, flattened: Base, or Base merged with the open profile. */
  flatBaseline: FlatConfigMap;
  fieldPaths: string[];
  schemaPathSet: Set<string>;
  /** Paths the base admin overrides set (`{}` leaves ignored). */
  dbOverridePaths: Set<string>;
  /** YAML-defined entry keys per section. */
  baseRecordKeys: Record<string, Set<string>>;
  /**
   * The open profile's effective values (Base merged with its overrides),
   * flattened; null in base mode. Edits are diffed against it, so a value equal
   * to the inherited one is no change.
   */
  scopeResolvedValues: FlatConfigMap | null;
  /** The open profile's own overrides, flattened (null in base mode). */
  scopeOverrideValues: FlatConfigMap | null;
  /** The open profile's overridden paths (null in base mode). */
  scopeChangedPaths: string[] | null;
  /** The edit target's effective values: the base config, or Base merged with the open profile. */
  baseActiveConfigValues: Record<string, ConfigValue> | null;
  /** What the page shows before pending edits are overlaid. */
  displayConfigValues: Record<string, ConfigValue> | null;
  /** Base: set in librechat.yaml or by a base override. Profile: set by the profile. */
  activeConfiguredPaths: Set<string>;
  /** Paths the edit target (base or the open profile) holds its own override for. */
  overridePaths: Set<string>;
  /**
   * Entries the base overrides add or change, per keyed list (`endpoints.custom`,
   * `modelSpecs.list`): such a list is stored as one value, so `overridePaths`
   * names none of its entries.
   */
  listOverrideCounts: ReadonlyMap<string, number>;
  /** Every layer `useFieldState` derives provenance and revert targets from. */
  valueLayers: ValueLayers | null;
  /**
   * The edit target's stored revision as loaded (`expectedRevision`): `null`
   * when it has no document, absent when the server reports none.
   */
  targetRevision?: string | null;
}

/** Options for `useTabBadges` (WS4). */
export interface TabCountsOptions {
  schemaTree: SchemaField[];
  visibleTabs: ConfigTab[];
  activeConfiguredPaths: Set<string>;
  activeConfigValues: Record<string, ConfigValue> | null;
  /** Pending edits, for the per-tab pending count. */
  editedValues?: FlatConfigMap;
  /** The edit target's override paths: Base's admin overrides, or the open profile's own. */
  overridePaths?: ReadonlySet<string>;
  /** Overridden entries of the keyed lists, which `overridePaths` cannot name (`ConfigLayers`). */
  listOverrideCounts?: ReadonlyMap<string, number>;
  /**
   * A profile is open: its settings tabs already count only what it sets, so
   * only collection tabs add the entries it overrides or adds.
   */
  isEditingScope?: boolean;
}

/** Options for `useConfigEdits` (WS1: save pipeline). */
export interface ConfigEditsOptions {
  isEditingScope: boolean;
  flatBaseline: FlatConfigMap;
  scopeResolvedValues: FlatConfigMap | null;
  baseActiveConfigValues: Record<string, ConfigValue> | null;
  /**
   * The schema tree: with it, an edit is compared with the saved value the way
   * Save stores it (so reverting any field, entry or record clears the unsaved
   * state) and numeric path segments are indices only under array settings.
   */
  schemaTree?: SchemaField[];
  schemaPathSet?: Set<string>;
}

/** The pending edits of the open target (WS1). */
export interface PendingEdits {
  values: FlatConfigMap;
  /** How each edited keyed collection's items map to the entries they were loaded as. */
  collections: CollectionEdits;
  /** The saved value of each edited path when it was first edited (drift detection). */
  baselines: FlatConfigMap;
  /** Pending hides/unhides of inherited values. */
  visibility: Record<string, VisibilityEdit>;
  /** Record entries renamed this session: each new entry path → the saved entry path it was renamed from. */
  renames: Readonly<Record<string, string>>;
  /** Record entries duplicated this session: each new entry path → the saved entry path it copies. */
  copies: Readonly<Record<string, string>>;
  /** Inherited credentials restated this session, by `credentialKey` (see the `restate` change). */
  restates: Readonly<Record<string, CredentialRef>>;
}

/** Record entries renamed and duplicated this session, as the pending edits hold them. */
export type EntryRenames = Pick<PendingEdits, 'renames' | 'copies'>;

/** The pending edits of the open target and the paths they touch, as Discard drops them. */
export interface EditsSnapshot {
  pending: PendingEdits;
  touched: ReadonlySet<string>;
}

/** Pending edits of the open target and the handlers that change them (WS1). */
export interface ConfigEditsState {
  editedValues: FlatConfigMap;
  touchedPaths: Set<string>;
  pendingResets: Set<string>;
  /** See `SingleFieldRendererProps.editSessionId`. */
  editSessionId: number;
  isDirty: boolean;
  saveError: string | null;
  setSaveError: (error: string | null) => void;
  /** See `PendingEdits.collections`. */
  collectionEdits: CollectionEdits;
  /** See `PendingEdits.baselines`. */
  editBaselines: FlatConfigMap;
  /** See `PendingEdits.visibility`. */
  visibilityEdits: Record<string, VisibilityEdit>;
  /** See `PendingEdits.renames`. */
  renameEdits: Readonly<Record<string, string>>;
  /** See `PendingEdits.copies`. */
  copyEdits: Readonly<Record<string, string>>;
  /** See `PendingEdits.restates`. */
  restateEdits: Readonly<Record<string, CredentialRef>>;
  handleFieldChange: (path: string, value: ConfigValue) => void;
  handleResetField: (path: string) => void;
  /** Queues hiding an inherited value in the open profile (an explicit tombstone). */
  handleHideField: (path: string) => void;
  /** Queues unhiding a value the open profile hides. */
  handleUnhideField: (path: string) => void;
  /** Records that the record entry at `from` was renamed (or, with `copy`, duplicated) to `to`; its edits are written separately. */
  handleRenameEntry: (from: string, to: string | null, copy?: boolean) => void;
  /** Restates an inherited credential the target's overrides move (see the `restate` change), or takes that back. */
  handleRestateCredential: (ref: CredentialRef, restated: boolean) => void;
  /** See `SingleFieldRendererProps.onDiscardField`. */
  handleDiscardField: (path: string) => void;
  /** Drops every pending edit without starting a new edit session. */
  discardEdits: () => void;
  startNewSession: () => void;
  /** Drops every pending edit and starts a new edit session. */
  resetEdits: () => void;
  /** The unsaved-changes bar's Discard. */
  handleDiscard: () => void;
  /** The pending edits as they stand, which `handleRestoreEdits` puts back (Discard's Undo). */
  snapshot: EditsSnapshot;
  /** Puts back the edits of a snapshot, renames and restates included, over any made since. */
  handleRestoreEdits: (snapshot: EditsSnapshot) => void;
}

/**
 * Writes saves and resets to a target through the validated, all-or-nothing
 * apply; rejects with a readable summary when anything is invalid, and
 * resolves to the changes that were not stored or did not take effect
 * (`skipped`), apart from the parts of written ones the server reported
 * (`reported`).
 */
export type WriteChangesFn = (
  target: WriteTarget,
  saves: SaveEntry[],
  resets: string[],
) => Promise<Pick<ApplyConfigChangesResult, 'skipped' | 'reported'>>;

/** Toast for a finished write, listing anything that was not stored. */
export type AnnounceWriteFn = (
  skipped: SkippedChange[],
  written: number,
  successMessage: string,
) => void;

/** Options for `useConfigSave` (WS1). */
export interface ConfigSaveOptions {
  schemaTree: SchemaField[];
  schemaPathSet: Set<string>;
  editingScope?: ConfigScope;
  layers: Pick<
    ConfigLayers,
    | 'configValues'
    | 'dbOverrides'
    | 'yamlConfig'
    | 'yamlMcpServers'
    | 'schemaDefaults'
    | 'overridePaths'
    | 'valueLayers'
    | 'baseActiveConfigValues'
    | 'targetRevision'
  >;
  edits: Pick<
    ConfigEditsState,
    | 'editedValues'
    | 'touchedPaths'
    | 'resetEdits'
    | 'setSaveError'
    | 'collectionEdits'
    | 'editBaselines'
    | 'visibilityEdits'
    | 'renameEdits'
    | 'copyEdits'
    | 'restateEdits'
    | 'handleRestateCredential'
  >;
}

/** The save plan, the review dialog state and the write path shared with import (WS1). */
export interface ConfigSaveState {
  confirmSaveOpen: boolean;
  saving: boolean;
  /** The last save failed because the admin session ended; signing in again and saving keeps the edits. */
  sessionExpired: boolean;
  /** The last save was refused until this admin accepts LibreChat's terms: where to accept them (`''` when unknown), else `null`. */
  termsUrl: string | null;
  savePlan: SavePayload;
  unsafeKeys: UnsafeConfigKey[];
  /** One row per pending change, by entry identity for collections (WS7 renders them). */
  changes: ChangeSummaryItem[];
  warnings: ConfigWarning[];
  /** The stored secrets the save takes away (`findRemovedSecrets`). */
  removedSecrets: StoredSecret[];
  /** In Base, the entries the save keeps while moving where their keys go (`findEntryKeyMoves`). */
  keyMoves: EntryKeyMove[];
  /** Problems that block saving: found in the pending edits, or returned by the last save. */
  issues: ConfigIssue[];
  /** Displayed path → readable message, for inline field errors (`FieldState.error`). */
  fieldErrors: Record<string, string>;
  /** One readable line per issue ("GPT › Provider must be "anthropic""). */
  issueSummaries: string[];
  handleConfirmSave: () => Promise<void>;
  /** Ends a save the review shows nothing for: the edits are dropped and nothing is sent. */
  finishWithoutWrites: () => void;
  /** The revision the pending edits were made against (see `ApplyConfigChangesRequest.expectedRevision`). */
  editRevision: Revision;
  /** Holds `revision` as the one the pending edits were made against (edits restored with it). */
  holdRevision: (revision: Revision) => void;
  /**
   * The last save found the target saved elsewhere since the edits were
   * loaded (`expectedRevision`), and wrote nothing.
   */
  conflict: boolean;
  /** Re-reads the target after a conflict; the edits stay, and the review marks what changed. */
  reloadLatest: () => Promise<void>;
  /** Saves the edits over the target as it is stored now: what others saved elsewhere stays. */
  saveOverLatest: () => Promise<void>;
  openReview: () => void;
  cancelReview: () => void;
  closeReview: () => void;
  writeChanges: WriteChangesFn;
  announceWrite: AnnounceWriteFn;
  /** One labelled line per skipped change, for toasts. */
  describeSkipped: (skipped: SkippedChange[]) => string;
}

/** A target's stored revision as loaded: `null` without a document, `undefined` when not reported. */
export type Revision = string | null | undefined;

/** The revision pending edits were made against, and how to hold another (`useEditRevision`). */
export interface HeldRevision {
  revision: Revision;
  hold: (revision: Revision) => void;
}

/** Options for `useResetBaseConfig` (WS1). */
export interface ResetBaseConfigOptions {
  /** Called after the base overrides were deleted, to drop pending edits. */
  onReset: () => void;
}

/** State of the "Reset base config" dialog (WS1). */
export interface ResetBaseConfigState {
  resetBaseOpen: boolean;
  resettingBase: boolean;
  resetBaseError: string | null;
  /** Where to accept LibreChat's terms, when it refused the reset until the admin does. */
  resetBaseTermsUrl: string | null;
  openResetBase: () => void;
  cancelResetBase: () => void;
  handleResetBaseConfig: () => Promise<void>;
}

/** Options for `useConfigImport` (WS7: review and import). */
export interface ConfigImportOptions {
  writeChanges: WriteChangesFn;
  describeSkipped: (skipped: SkippedChange[]) => string;
}

/** The import dialog and its write (WS7). */
export interface ConfigImportState {
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
  /** Writes the chosen leaves; rejects with the reason when nothing was written. */
  handleImport: (request: ImportRequest) => Promise<void>;
}

/** Options for `useTabSections` (WS5). */
export interface TabSectionsOptions {
  schemaTree: SchemaField[];
  activeTab: string;
  activeConfigValues: Record<string, ConfigValue> | null;
  sectionPermissions: SectionPermissionMap;
  /** Pending edits, so created/deleted record entries (MCP servers) show in the TOC. */
  editedValues?: FlatConfigMap;
}
