import type { ReactNode } from 'react';
import type {
  ConfigValue,
  FlatConfigMap,
  SchemaField,
  ReadOnlyReason,
  UnsafeConfigKey,
  FieldValidationError,
} from './config';
import type {
  ConfigScope,
  IconName,
  ScopeSelection,
  FieldProfileValue,
  ScopePermissions,
} from './scope';

export interface ConfigTab {
  id: string;
  labelKey: string;
  permission?: string;
}

export interface TocItem {
  id: string;
  label: string;
  /** Config path prefix for configured-only filtering. Falls back to
   *  stripping "section-" from `id` if not set. */
  dataPath?: string;
}

export interface ConfigSectionConfig {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  learnMoreUrl?: string;
  icon?: string;
  fields: SchemaField[];
  sectionField?: SchemaField;
  /** When set, use this key for config value lookup and field path prefixing
   *  instead of `id`. Used by virtual sections that share another section's
   *  schema data but render under a different tab/renderer. */
  schemaKey?: string;
  /** When set, the TOC renders these items instead of deriving children from
   *  the schema fields. Used by tabs like Custom Endpoints where the TOC
   *  should show configured entry names rather than field structure. */
  tocItems?: TocItem[];
  /** Optional info banner displayed at the top of the section content. */
  bannerText?: string;
  /** Literal title for sections without a locale key (e.g. newer schema sections). */
  title?: string;
  /** Set for sections the panel must not write; the section renders read-only. */
  readOnlyReason?: ReadOnlyReason;
  /** The section is a record keyed by entry name, so its keys are entries, not settings. */
  isRecord?: boolean;
}

export interface ConfigPageProps {
  initialTab?: string;
  highlightField?: string;
  initialScope?: string;
}

export interface ConfigTabBarProps {
  tabs: ConfigTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  tabCounts?: Record<string, number>;
  children?: ReactNode;
}

export interface ConfigTabContentProps {
  sections: ConfigSectionConfig[];
  configValues: Record<string, ConfigValue> | null;
  editedValues: FlatConfigMap;
  onFieldChange: (path: string, value: ConfigValue) => void;
  onResetField?: (path: string) => void;
  /** See `SingleFieldRendererProps.onDiscardField`. */
  onDiscardField?: (path: string) => void;
  profileMap?: Record<string, string[]>;
  previewMode?: boolean;
  previewScope?: ConfigScope;
  previewChangedPaths?: string[] | null;
  resolvedValues?: FlatConfigMap | null;
  permissions?: ScopePermissions;
  onProfileChange?: () => void;
  showChangedOnly?: boolean;
  readOnly?: boolean;
  configuredPaths?: Set<string>;
  dbOverridePaths?: Set<string>;
  touchedPaths?: Set<string>;
  pendingResets?: Set<string>;
  sectionPermissions?: Record<string, { canView: boolean; canEdit: boolean }>;
  schemaDefaults?: FlatConfigMap;
  showConfiguredOnly?: boolean;
  isEditingScope?: boolean;
  /** YAML-defined entry keys per section, keyed by parent path. */
  baseRecordKeys?: Record<string, Set<string>>;
  onValidationError?: (message: string) => void;
  /** See `SingleFieldRendererProps.editSessionId`. */
  editSessionId?: number;
  /** Top-level config object whose schema-unknown keys are listed read-only after the sections. */
  unknownSettings?: Pick<UnknownSettingsProps, 'fields' | 'value'>;
}

export interface ConfigTableOfContentsProps {
  sections: ConfigSectionConfig[];
  scrollContainer: HTMLElement | null;
  tocRef: (el: HTMLElement | null) => void;
  showConfiguredOnly?: boolean;
  configuredPaths?: Set<string>;
  onNavigate?: (sectionId: string) => void;
}

export interface ConfigRowProps {
  title: string;
  description?: string;
  learnMoreUrl?: string;
  badge?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  hidden?: boolean;
  fieldId?: string;
  fieldPath?: string;
  previewMode?: boolean;
  previewScope?: ConfigScope;
  previewChangedPaths?: string[] | null;
  resolvedValues?: FlatConfigMap | null;
  permissions?: ScopePermissions;
  onProfileChange?: () => void;
  onResetField?: (path: string) => void;
  isConfigured?: boolean;
  isDbOverride?: boolean;
  isTouched?: boolean;
  isPendingReset?: boolean;
  defaultHint?: string | null;
}

export interface ConfigSectionProps {
  sectionId?: string;
  title: string;
  description?: string;
  learnMoreUrl?: string;
  children: ReactNode;
  hidden?: boolean;
  configuredCount?: number;
  totalCount?: number;
  defaultExpanded?: boolean;
  inline?: boolean;
  showConfiguredOnly?: boolean;
}

export interface ConfirmSaveDialogProps {
  open: boolean;
  /** Names the target being written (base or the open profile). */
  title: string;
  editedValues: FlatConfigMap;
  originalValues: FlatConfigMap;
  /** Pending edits that will not be sent, with the reason. */
  skipped?: SkippedChange[];
  /** Keys the admin API would drop; while any exist the save is blocked. */
  unsafeKeys?: UnsafeConfigKey[];
  saving: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface ContentToolbarProps {
  scrollContainer: HTMLElement | null;
  showConfiguredOnly: boolean;
  onShowConfiguredOnlyChange: (v: boolean) => void;
  showConfiguredToggle: boolean;
}

export interface DeleteProfileValueModalProps {
  scope: ConfigScope | null;
  fieldLabel: string;
  saving: boolean;
  onConfirm: (scope: ConfigScope) => void;
  onCancel: () => void;
}

export interface ResetBaseConfigDialogProps {
  open: boolean;
  resetting: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface FieldProfilePopoverProps {
  fieldPath: string;
  fieldLabel: string;
  fieldSchema?: SchemaField;
  profileValues: FieldProfileValue[];
  permissions: ScopePermissions;
  onProfileChange?: () => void;
  baseValue?: ConfigValue;
  onBaseValueChange?: (value: ConfigValue) => void;
}

export interface CascadeItemProps {
  label: string;
  icon: IconName;
  color: string;
  sublabel: string;
}

export interface SingleFieldRendererProps {
  field: SchemaField;
  value: ConfigValue;
  path: string;
  getValue: (path: string, fallback: ConfigValue) => ConfigValue;
  onChange: (path: string, value: ConfigValue) => void;
  onResetField?: (path: string) => void;
  /**
   * Removes `path` from `editedValues`/`touchedPaths` directly, bypassing
   * the baseline-match diffing `onChange` goes through. Used by SecretField's
   * Cancel: abandoning an in-progress replacement is never a real edit, so it
   * must not be representable as a pending reset (`onChange(path, undefined)`)
   * whenever a scope-resolved baseline happens to also read as empty.
   */
  onDiscardField?: (path: string) => void;
  /**
   * Source of truth for whether a secret field currently has a queued
   * replacement (`SecretField`'s `hasPendingEdit`). Membership in this map,
   * not `touchedPaths`, since a replacement typed then cleared back to a
   * baseline that itself reads as an empty string gets removed from here by
   * `applyConfigEdit`'s baseline-match diffing, while `touchedPaths` keeps
   * the path forever — using the latter would keep showing an open, empty
   * replace input for a field with nothing actually queued to save.
   */
  editedValues?: FlatConfigMap;
  disabled?: boolean;
  permissions?: ScopePermissions;
  onProfileChange?: () => void;
  previewMode?: boolean;
  previewScope?: ConfigScope;
  previewChangedPaths?: string[] | null;
  resolvedValues?: FlatConfigMap | null;
  configuredPaths?: Set<string>;
  dbOverridePaths?: Set<string>;
  touchedPaths?: Set<string>;
  pendingResets?: Set<string>;
  schemaDefaults?: FlatConfigMap;
  showConfiguredOnly?: boolean;
  isSoleField?: boolean;
  /** Masked preview of a set-but-redacted secret, from the sibling `<field>Preview` companion. */
  secretPreviewValue?: string;
  /**
   * Bumped by the parent on Discard, a successful save, a confirmed scope
   * change, or a reset-to-default success — every bulk `editedValues`/
   * `touchedPaths` clear. Used as part of `SecretField`'s `key` so an
   * in-progress (possibly untyped) replacement doesn't survive past the
   * edit session that started it.
   */
  editSessionId?: number;
}

export interface FieldRendererProps {
  fields: SchemaField[];
  parentValue: ConfigValue;
  parentPath: string;
  getValue: (path: string, fallback: ConfigValue) => ConfigValue;
  onChange: (path: string, value: ConfigValue) => void;
  onResetField?: (path: string) => void;
  /** See `SingleFieldRendererProps.onDiscardField`. */
  onDiscardField?: (path: string) => void;
  editedValues?: FlatConfigMap;
  disabled?: boolean;
  profileMap?: Record<string, string[]>;
  previewMode?: boolean;
  previewScope?: ConfigScope;
  previewChangedPaths?: string[] | null;
  resolvedValues?: FlatConfigMap | null;
  permissions?: ScopePermissions;
  onProfileChange?: () => void;
  showChangedOnly?: boolean;
  configuredPaths?: Set<string>;
  dbOverridePaths?: Set<string>;
  touchedPaths?: Set<string>;
  pendingResets?: Set<string>;
  schemaDefaults?: FlatConfigMap;
  showConfiguredOnly?: boolean;
  isEditingScope?: boolean;
  /** YAML-defined entry keys for the section being rendered. */
  yamlBaseKeys?: Set<string>;
  onValidationError?: (message: string) => void;
  /** See `SingleFieldRendererProps.editSessionId`. */
  editSessionId?: number;
}

/** Where an import is written: base (all users) or one profile. */
export type ImportTarget = { type: 'base' } | { type: 'scope'; scope: ConfigScope };

export interface ImportYamlDialogProps {
  open: boolean;
  onClose: () => void;
  /** The profile open on the page, offered (and preselected) as the import target. */
  currentScope?: ConfigScope;
  /** Writes the imported values to `target`; rejects with the reason when nothing was written. */
  onImport: (appConfig: Record<string, ConfigValue>, target: ImportTarget) => Promise<void>;
}

export type ImportTab = 'upload' | 'paste';
export type ImportStep = 'input' | 'target';
export type TargetMode = 'current' | 'base' | 'existing' | 'create';

export interface ImportValidationError {
  path: string;
  message: string;
}

export interface ImportParseResult {
  success: boolean;
  error?: string;
  validationErrors?: ImportValidationError[];
  /** The parsed YAML exactly as written: no schema defaults, unknown keys kept. */
  appConfig: Record<string, ConfigValue> | null;
  /** Leaf paths the panel's bundled schema does not describe (kept on import). */
  unknownPaths: string[];
}

export interface InfoBannerProps {
  text: string;
  dismissible?: boolean;
  variant?: 'info' | 'scope-preview' | 'scope-edit';
  scopeSelection?: ScopeSelection;
  onBackToBase?: () => void;
}

export interface PreviewProfileActionsProps {
  fieldPath: string;
  fieldLabel: string;
  fieldSchema?: SchemaField;
  scope: ConfigScope;
  currentValue: ConfigValue;
  onProfileChange?: () => void;
}

export interface ProfileIndicatorProps {
  fieldPath: string;
  fieldLabel: string;
  fieldSchema?: SchemaField;
  profileTypes?: string[];
  permissions: ScopePermissions;
  onProfileChange?: () => void;
  baseValue?: ConfigValue;
  onBaseValueChange?: (value: ConfigValue) => void;
}

export interface ProfileValueModalProps {
  open: boolean;
  fieldSchema?: SchemaField;
  controlType: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  scopeName: string;
  scopeType: string;
  mode: 'edit' | 'add';
}

export interface ModalValueControlProps {
  fieldSchema?: SchemaField;
  controlType: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  onSubmit: () => void;
}

export interface ScopeSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSelection: ScopeSelection;
  onSelect: (selection: ScopeSelection) => void;
  permissions: ScopePermissions;
  onError?: (message: string) => void;
}

export interface ScopeItemProps {
  scope: ConfigScope;
  isSelected: boolean;
  onSelect: (scope: ConfigScope) => void;
  localize: (key: string, interpolation?: Record<string, string | number>) => string;
}

export interface ScopeTriggerButtonProps {
  currentSelection: ScopeSelection;
  onClick: () => void;
}

export interface SectionControlsProps {
  children: ReactNode;
}

export interface SectionHeaderProps {
  title: string;
  description?: string;
  learnMoreUrl?: string;
  htmlFor?: string;
  titleAdornment?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}

export interface SaveEntry {
  fieldPath: string;
  value: ConfigValue;
}

/** A pending edit the panel will not send, and why. */
export interface SkippedChange {
  fieldPath: string;
  reason: ReadOnlyReason | 'permission';
}

export interface SavePayload {
  touched: string[];
  saves: SaveEntry[];
  resets: string[];
  skipped: SkippedChange[];
}

/** What `buildSavePayload` needs to tell a real change from a blank or unchanged one. */
export interface SaveContext {
  /** Schema tree used to tell record and list fields apart. */
  fields: SchemaField[];
  /** Current saved value at a path in the edit target (base or the open profile). */
  baselineAt: (path: string) => ConfigValue;
  /** Whether the edit target holds its own override at (or under) a path. */
  hasOverride: (path: string) => boolean;
}

/** Result of the server-side pre-flight that runs before any write. */
export interface ConfigCheckResult {
  errors: FieldValidationError[];
  skipped: SkippedChange[];
}

/** Outcome of a save call: how many entries the backend applied and which were dropped. */
export interface ConfigWriteResult {
  success: boolean;
  applied: number;
  skipped: SkippedChange[];
}

export interface ManagedNoticeProps {
  /** The edit target holds its own (ignored) override for the field. */
  hasOverride: boolean;
  /** Removal of that override is already queued for the next save. */
  pendingRemoval: boolean;
  onRemoveOverride?: () => void;
}

export interface UnknownSettingsProps {
  /** Every schema field of the object (the full list, not a filtered subset). */
  fields: SchemaField[];
  value: ConfigValue;
  path: string;
}
