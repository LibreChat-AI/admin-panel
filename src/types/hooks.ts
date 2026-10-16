import type { UseMutationResult } from '@tanstack/react-query';
import type { PrincipalType } from 'librechat-data-provider';
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

export interface CommandItem {
  id: string;
  label: string;
  keywords: string[];
  category: 'config-section';
  tab?: string;
}

export type LocalizeFn = (key: string, options?: Record<string, string | number>) => string;

export type TranslationKeys = string;

export interface UseProfileMutationsOptions {
  fieldPath: string;
  onProfileChange?: () => void;
}

export interface UseProfileMutationsReturn {
  saveMutation: UseMutationResult<
    { success: boolean },
    Error,
    { principalType: PrincipalType; principalId: string; value: unknown }
  >;
  removeMutation: UseMutationResult<
    { success: boolean },
    Error,
    { principalType: PrincipalType; principalId: string }
  >;
  saving: boolean;
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
  /** Scope from the URL (`_id` or `type:principalId`); otherwise the last-used scope is restored. */
  initialScope?: string;
}

/** The open profile (scope) and the scope selector dialog state (WS8). */
export interface ScopeSelectionState {
  selectedScope: ScopeSelection;
  /** Opens a scope: updates the selection, the remembered scope and the URL. */
  selectScope: (selection: ScopeSelection) => void;
  isEditingScope: boolean;
  editingScope?: ConfigScope;
  scopeSelectorOpen: boolean;
  setScopeSelectorOpen: (open: boolean) => void;
}

/** Which profiles override each field (WS8). */
export interface ProfileMapState {
  /** Field path → principal types of the profiles that override it. */
  profileMap: Record<string, string[]>;
  handleProfileChange: () => void;
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
  /** librechat.yaml alone (no admin overrides): what a base field reverts to. */
  yamlConfig?: ConfigRecord;
  /** MCP servers defined in librechat.yaml. */
  yamlMcpServers?: Record<string, ConfigValue>;
  schemaDefaults: FlatConfigMap;
  flatBaseline: FlatConfigMap;
  fieldPaths: string[];
  schemaPathSet: Set<string>;
  /** Paths the base admin overrides set. */
  dbOverridePaths: Set<string>;
  /** YAML-defined entry keys per section. */
  baseRecordKeys: Record<string, Set<string>>;
  /** The open profile's own overrides, flattened (null in base mode). */
  scopeResolvedValues: FlatConfigMap | null;
  /** The open profile's overridden paths (null in base mode). */
  scopeChangedPaths: string[] | null;
  /** The edit target's stored values: the base config, or the open profile's overrides. */
  baseActiveConfigValues: Record<string, ConfigValue> | null;
  /** What the page shows before pending edits are overlaid. */
  displayConfigValues: Record<string, ConfigValue> | null;
  activeConfiguredPaths: Set<string>;
  /** Paths the edit target (base or the open profile) holds its own override for. */
  overridePaths: Set<string>;
}

/** Options for `useTabCounts` (WS4). */
export interface TabCountsOptions {
  schemaTree: SchemaField[];
  visibleTabs: ConfigTab[];
  activeConfiguredPaths: Set<string>;
  activeConfigValues: Record<string, ConfigValue> | null;
}

/** Options for `useConfigEdits` (WS1: save pipeline). */
export interface ConfigEditsOptions {
  isEditingScope: boolean;
  flatBaseline: FlatConfigMap;
  scopeResolvedValues: FlatConfigMap | null;
  baseActiveConfigValues: Record<string, ConfigValue> | null;
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
  handleFieldChange: (path: string, value: ConfigValue) => void;
  handleResetField: (path: string) => void;
  /** See `SingleFieldRendererProps.onDiscardField`. */
  handleDiscardField: (path: string) => void;
  /** Drops every pending edit without starting a new edit session. */
  discardEdits: () => void;
  startNewSession: () => void;
  /** Drops every pending edit and starts a new edit session. */
  resetEdits: () => void;
  /** The unsaved-changes bar's Discard. */
  handleDiscard: () => void;
}

/** Writes saves and resets to a target after the server pre-flight; resolves to what was not stored. */
export type WriteChangesFn = (
  target: WriteTarget,
  saves: SaveEntry[],
  resets: string[],
  inheritedMcpKeys?: Set<string>,
) => Promise<SkippedChange[]>;

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
    | 'baseActiveConfigValues'
  >;
  edits: Pick<ConfigEditsState, 'editedValues' | 'touchedPaths' | 'resetEdits' | 'setSaveError'>;
}

/** The values the change review shows, keyed by path. */
export interface ConfigReviewValues {
  /** What Save sends: a value for each save, undefined for each reset. */
  editedValues: FlatConfigMap;
  originalValues: FlatConfigMap;
  /** For each reset: the value the field falls back to. */
  revertValues: FlatConfigMap;
}

/** The save plan, the review dialog state and the write path shared with import (WS1). */
export interface ConfigSaveState {
  confirmSaveOpen: boolean;
  saving: boolean;
  savePlan: SavePayload;
  unsafeKeys: UnsafeConfigKey[];
  review: ConfigReviewValues;
  handleConfirmSave: () => Promise<void>;
  openReview: () => void;
  cancelReview: () => void;
  closeReview: () => void;
  writeChanges: WriteChangesFn;
  announceWrite: AnnounceWriteFn;
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
  openResetBase: () => void;
  cancelResetBase: () => void;
  handleResetBaseConfig: () => Promise<void>;
}

/** Options for `useConfigImport` (WS7: review and import). */
export interface ConfigImportOptions {
  schemaTree: SchemaField[];
  schemaPathSet: Set<string>;
  writeChanges: WriteChangesFn;
  announceWrite: AnnounceWriteFn;
}

/** The import dialog and its success banner (WS7). */
export interface ConfigImportState {
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
  importSuccess: boolean;
  importSuccessMessage: string | null;
  handleImport: (appConfig: ConfigRecord, target: WriteTarget) => Promise<void>;
}

/** Options for `useTabSections` (WS5). */
export interface TabSectionsOptions {
  schemaTree: SchemaField[];
  activeTab: string;
  activeConfigValues: Record<string, ConfigValue> | null;
  sectionPermissions: SectionPermissionMap;
}
