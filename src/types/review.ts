import type { PrincipalType } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type {
  ConfigValue,
  ConfigRecord,
  SchemaField,
  FlatConfigMap,
  UnsafeConfigKey,
} from './config';
import type { LocalizeFn, ConfigLayers, ConfigSaveState, ConfigEditsState } from './hooks';
import type { ImportTab, SaveEntry, TargetMode, SkippedChange } from './config-ui';
import type { ChangeSummaryItem, ChangeWarning, EntryKeyMove, VisibilityEdit } from './changes';
import type { RevertTarget } from './values';
import type { ConfigScope } from './scope';

/** What `summarizeChanges` compares to describe a pending write (WS7). */
export interface ChangeSummaryInput {
  saves: SaveEntry[];
  resets: string[];
  /** The tree the edits were made against: the effective base config, or the open profile's own overrides. */
  baseline: ConfigRecord | null;
  /** The target's own stored value at a path (base admin override, or the profile's override). */
  ownAt: (path: string) => ConfigValue;
  /** Whether the target holds its own override at (or above) a path. */
  isOwned: (path: string) => boolean;
  /** The value a path falls back to without the target's own override, and its layer. */
  lowerAt: (path: string) => RevertTarget | undefined;
  /** Identities of a collection's entries that librechat.yaml defines (they can't be removed or renamed). */
  yamlEntries: (collectionPath: string) => ReadonlySet<string> | undefined;
  /** Whether the target is a profile (lists it saves replace the inherited list). */
  isScope: boolean;
  fields: SchemaField[];
  schemaPaths: ReadonlySet<string>;
  /** Record entries renamed in the panel: new entry path → the saved entry path it came from. */
  renames?: Readonly<Record<string, string>>;
}

/** Where a collection entry sits: its collection, data path and identity (WS7). */
export interface ChangeEntryRef {
  collectionPath: string;
  entryPath: string;
  identity?: string;
}

/**
 * Where a stored secret a save removes is, as review rows name it: inside a
 * collection entry (by identity, so a renamed or moved entry still matches)
 * at `path` within it, else at `path`; `display` is its path on the page.
 */
export interface SecretLocation {
  entry?: ChangeEntryRef;
  path: string;
  display: string;
}

/** The layers below the edit target, for `lowerValue` (WS7). */
export interface LowerLayers {
  isScope: boolean;
  /** The effective base config (what a profile inherits). */
  configValues: Record<string, ConfigValue> | null;
  /** librechat.yaml alone (what a base override reverts to). */
  yamlConfig?: ConfigRecord;
  schemaDefaults: FlatConfigMap;
}

/** The base admin overrides the revert-all action removes (WS7). */
export interface BaseOverridesState {
  count: number;
  model: ChangeReviewModel;
}

/** The collection entry a revealed path is in, for its name-based field ids (WS7). */
export type RevealEntry = Pick<ChangeEntryRef, 'entryPath' | 'identity'>;

/** The tab and section a change belongs to, with their titles (WS7). */
export interface ChangeLocation {
  tabId: string;
  tabTitle: string;
  sectionKey: string;
  sectionTitle: string;
}

/** A problem shown in the review, labelled for the admin (WS7). */
export interface ReviewIssue {
  /** Data path the issue belongs to (array indices as segments), when known. */
  path?: string;
  /** Tab › Section › Entry › Field, with entry titles instead of indices. */
  label?: string;
  message: string;
  /** A pre-flight problem: Save stays disabled until it is fixed. */
  blocking: boolean;
}

/** One rendered row of the change review (WS7). */
export interface ReviewRow {
  key: string;
  item: ChangeSummaryItem;
  /** Field breadcrumb, or the entry title for entry-level changes. */
  label: string;
  /** Collection noun for entry-level changes ("endpoint", "MCP server"). */
  noun?: string;
  /** Leaves of an added entry, or what a change deletes with it (`dropped`), listed under it. */
  details?: ReviewRow[];
  issues?: ReviewIssue[];
  /** Option labels of an enum setting by value ("remaining_tokens" → "Remaining tokens"). */
  valueLabels?: Readonly<Record<string, string>>;
}

/** Changes to one existing collection entry, grouped under its title (WS7). */
export interface ReviewEntryGroup {
  key: string;
  title: string;
  noun: string;
  rows: ReviewRow[];
}

/** Changes of one section of a tab (WS7). */
export interface ReviewSection {
  key: string;
  title: string;
  rows: ReviewRow[];
  entries: ReviewEntryGroup[];
  /** Section-wide warnings, shown once (e.g. a list becoming panel-managed). */
  notices: ChangeWarning[];
}

/** Changes of one tab (WS7). */
export interface ReviewTab {
  id: string;
  title: string;
  sections: ReviewSection[];
}

/** A pending change that will not be sent, labelled (WS7). */
export interface ReviewSkippedRow {
  key: string;
  path: string;
  label: string;
  reason: string;
}

/** The change review grouped tab › section › entry, with its count and problems (WS7). */
export interface ChangeReviewModel {
  tabs: ReviewTab[];
  /** Changes Save writes: one per field row and one per added, removed or renamed entry. */
  count: number;
  /** Titles of the tabs that have changes, in tab order. */
  tabTitles: string[];
  /** Where each change shows on the page (a removed entry: its list), for edited markers. */
  changedPaths: string[];
  issues: ReviewIssue[];
  skipped: ReviewSkippedRow[];
}

/**
 * How a review row is undone: drop pending edits, replace one with a partly
 * reverted value, or undo a record entry's rename (WS7): drop the edits under
 * its new key and the old key's removal, then write its other field changes
 * under the old key again and forget the rename.
 */
export type ReviewRevertAction =
  | { op: 'discard'; paths: string[] }
  | { op: 'set'; path: string; value: ConfigValue }
  | {
      op: 'unrename';
      /** The renamed entry's path (`mcpServers.new`), whose rename record goes. */
      entryPath: string;
      discard: string[];
      writes: Array<{ path: string; value: ConfigValue }>;
    };

/** Options of `useChangeReview` (WS7). */
export interface ChangeReviewOptions {
  schemaTree: SchemaField[];
  editingScope?: ConfigScope;
  layers: Pick<
    ConfigLayers,
    | 'configValues'
    | 'dbOverrides'
    | 'yamlConfig'
    | 'yamlMcpServers'
    | 'schemaDefaults'
    | 'schemaPathSet'
    | 'overridePaths'
    | 'baseActiveConfigValues'
    | 'valueLayers'
  >;
  edits: Pick<
    ConfigEditsState,
    | 'editedValues'
    | 'isDirty'
    | 'saveError'
    | 'handleFieldChange'
    | 'handleDiscardField'
    | 'handleDiscard'
    | 'visibilityEdits'
    | 'renameEdits'
    | 'restateEdits'
    | 'handleHideField'
    | 'handleUnhideField'
    | 'handleRenameEntry'
    | 'handleRestateCredential'
    | 'snapshot'
    | 'editSessionId'
    | 'handleRestoreEdits'
  >;
  save: Pick<
    ConfigSaveState,
    | 'savePlan'
    | 'fieldErrors'
    | 'changes'
    | 'warnings'
    | 'removedSecrets'
    | 'keyMoves'
    | 'saving'
    | 'sessionExpired'
    | 'termsUrl'
    | 'confirmSaveOpen'
    | 'openReview'
    | 'cancelReview'
    | 'handleConfirmSave'
    | 'finishWithoutWrites'
    | 'editRevision'
    | 'holdRevision'
    | 'conflict'
    | 'reloadLatest'
    | 'saveOverLatest'
  >;
  /** Switches the page to a tab (the review's "Go to field"). */
  onTabChange: (tabId: string) => void;
  /** Every profile, in the order they apply: a rename or removal in Base names those it leaves overrides behind in. */
  profiles?: readonly ConfigScope[];
}

/** The change review and unsaved-changes bar state (WS7). */
export interface ChangeReviewState {
  model: ChangeReviewModel;
  open: boolean;
  saving: boolean;
  /** The last save failed because the admin session ended (offer to sign in again). */
  sessionExpired: boolean;
  /** The last save was refused until the admin accepts LibreChat's terms: where to accept them, else `null`. */
  termsUrl: string | null;
  /**
   * The last save found the target saved elsewhere meanwhile, and wrote
   * nothing: until Reload or Merge, or the review is closed, Save is refused.
   */
  conflict: boolean;
  /** After a conflict: drops the edits (with Undo) and shows the target as it is stored now. */
  reloadLatest: () => void;
  /** After a conflict: saves the edits over the target as it is stored now. */
  mergeLatest: () => Promise<void>;
  /** Error from the last failed save, as labelled issues. */
  saveIssues: ReviewIssue[];
  /** Title naming the target: "Save 2 changes to Role: USER?". */
  title: string;
  /** The open profile, or undefined for base. */
  scope?: ConfigScope;
  /** Save is blocked while pre-flight issues exist. */
  blocked: boolean;
  isDirty: boolean;
  openReview: () => void;
  closeReview: () => void;
  confirm: () => Promise<void>;
  revertRow: (row: ReviewRow) => void;
  goToRow: (row: Pick<ReviewRow, 'item'> | ReviewIssue) => void;
  /** Drops every pending edit and offers a 5 s Undo. */
  discardAll: () => void;
}

/** Props of the change review drawer (WS7). */
export interface ChangeReviewProps {
  review: ChangeReviewState;
}

/** Props of the unsaved-changes bar (WS7). */
export interface ChangesBarProps {
  review: ChangeReviewState;
}

/** Props of the grouped review list (WS7). */
export interface ReviewListProps extends Omit<ReviewRowViewProps, 'row' | 'leading'> {
  tabs: ReviewTab[];
}

/** Props of one review row (WS7). */
export interface ReviewRowViewProps {
  row: ReviewRow;
  /** The target is a profile (BEFORE reads "inherits … from Base"). */
  isScope: boolean;
  onRevert?: (row: ReviewRow) => void;
  onGoTo?: (row: ReviewRow) => void;
  /** Extra control before the row (the import preview's include checkbox). */
  leading?: ReactNode;
  /** Shown instead of Revert/Go to (the import preview). */
  compact?: boolean;
}

/** What the review names the profiles that override Base's entries by name against (`overrideNotes`). */
export interface OverrideNoteOptions {
  profiles: readonly ConfigScope[];
  /** The entries the save keeps while moving where profiles' own keys there go (`findEntryKeyMoves`). */
  keyMoves: readonly EntryKeyMove[];
  /** LibreChat sends a profile's own key to whatever entry holds the name (no `secretRebinding`). */
  sendsKeys: boolean;
  /** The configuration before the save, where a name already in use is no leftover. */
  before: ConfigValue;
  /** Profiles hide custom endpoints, and remove values inside them, by key (`keyedTombstones`). */
  keyedTombstones?: boolean;
}

/** The layers a pending hide or unhide by key (`endpoints.custom["Name"]…`) is described from in the review. */
export interface KeyedVisibilityLayers {
  /** The layer beneath the target: librechat.yaml for Base, Base for a profile. */
  lower: ConfigValue;
  /** The target's own stored overrides. */
  own: ConfigValue;
  /** The saved config the page shows. */
  baseline: ConfigValue;
  isScope: boolean;
  /** The target's tombstones as stored. */
  tombstones: Iterable<string>;
  /** The pending hides and unhides. */
  visibility: Readonly<Record<string, VisibilityEdit>>;
  /** LibreChat applies keyed tombstones: a hide or unhide inside an entry deletes the target's own value there. */
  keyedTombstones: boolean;
}

/** What a save's rows in Base are checked against for those profiles: the options, and the entries rows write. */
export interface OverrideNoteContext extends OverrideNoteOptions {
  /** The entries a row writes under their name once the save is applied (`collection\u0000name`). */
  written: ReadonlySet<string>;
}

/** Props of a part of a review row that reads one change. */
export type ChangeItemProps = Pick<ReviewRow, 'item'>;

/** `ChangeItemProps` worded for the target: Base, or a profile (`isScope`). */
export interface ScopedChangeItemProps extends ChangeItemProps {
  isScope: boolean;
}

/** Props of a detail under a review row: a leaf of an added entry, or a part the change deletes with it. */
export interface ReviewDetailValueProps {
  detail: ReviewRow;
}

/** Why an imported key is left out (WS7). */
export type ImportSkipReason =
  | SkippedChange['reason']
  | 'unsafeKey'
  | 'reservedKey'
  | 'dottedKey'
  | 'dottedName'
  | 'processMcp';

/**
 * An imported secret an import never writes (WS7): the value is the mask
 * LibreChat shows for a hidden key (`masked`), or the key it would replace is
 * hidden from the panel, a librechat.yaml literal (`hidden`).
 */
export interface WithheldSecret {
  path: string;
  reason: 'hidden' | 'masked';
}

/**
 * What an import leaves out of the merged lists it writes: the secrets it
 * never writes, and the paths of the imported entries the target hides
 * whole (`keyedTombstones`), since writing one would show it again.
 */
export interface ImportLeftOut {
  withheld: WithheldSecret[];
  hidden: string[];
}

/** An imported leaf that will not be written, and why (WS7). */
export interface ImportSkippedKey {
  fieldPath: string;
  reason: ImportSkipReason;
  /** For `unsafeKey`, `reservedKey`, `dottedKey` and `dottedName`: the key, held by the object at `fieldPath`. */
  key?: string;
}

/** Leaves of an imported YAML, and the keys the admin API can't store (WS7). */
export interface ImportLeaves {
  leaves: FlatConfigMap;
  /** Keys the admin API can't store (`isUnsafeConfigKey`), with the path of the object holding them. */
  unsafe: UnsafeConfigKey[];
  /** With `dottedKeys`: dotted keys where the schema expects a setting name, not a free key. */
  dotted: UnsafeConfigKey[];
  /** With `dottedKeys`: dotted names in a record of setting groups (an MCP server), written field by field. */
  dottedNames: UnsafeConfigKey[];
}

/** Imported leaves split into what can be written and what is left out (WS7). */
export interface ImportPlan {
  entries: SaveEntry[];
  skipped: ImportSkippedKey[];
  /** Entry paths the bundled schema does not describe (imported as-is). */
  unknown: Set<string>;
}

/** Where an import goes, including principals that have no profile yet (WS7). */
export type ImportTarget =
  | { type: 'base' }
  | { type: 'scope'; scope: ConfigScope; exists: boolean }
  | { type: 'create'; principalType: ConfigScope['principalType']; name: string };

/** One imported leaf in the preview, with the changes it makes to the target (WS7). */
export interface ImportPreviewRow {
  fieldPath: string;
  /** Field breadcrumb within its section. */
  label: string;
  rows: ReviewRow[];
  /** The imported value equals what the target already has. */
  unchanged: boolean;
  /** Not described by the bundled schema: imported as-is. */
  unknown: boolean;
  /** Writing it replaces a whole list the target inherits (model specs). */
  replacesList?: boolean;
  /** What the endpoints the target hides take from the imported value for its members, worded (`keyedTombstones`). */
  hiddenNotes?: string[];
}

/** Imported leaves of one tab section (WS7). */
export interface ImportPreviewGroup {
  key: string;
  /** "Tab › Section". */
  title: string;
  rows: ImportPreviewRow[];
}

/** Options of `useImportPreview` (WS7). */
export interface ImportPreviewOptions {
  schemaTree: SchemaField[];
  schemaPathSet: ReadonlySet<string>;
  appConfig: ConfigRecord | null;
  target: ImportTarget | null;
}

/** The import preview: what each imported leaf changes in the target, and what is left out (WS7). */
export interface ImportPreviewState {
  plan?: ImportPlan;
  groups: ImportPreviewGroup[];
  skipped: ReviewSkippedRow[];
  /** Save entries for the chosen leaves (merged lists upserted into the target's own list). */
  entriesFor: (included: ReadonlySet<string>) => SaveEntry[];
  /** Problems the validated write would refuse the chosen leaves for, as "Entry › Field …" lines. */
  issuesFor: (included: ReadonlySet<string>) => string[];
  loading: boolean;
}

/** Principal types an import can target (WS7). */
export type ImportPrincipalKind = PrincipalType.ROLE | PrincipalType.GROUP | PrincipalType.USER;

/** A role, group or user as an import target, and whether it already has a profile (WS7). */
export interface ImportPrincipal {
  scope: ConfigScope;
  exists: boolean;
}

/** Props of the YAML syntax error frame (WS7). */
export interface ImportSyntaxFrameProps {
  text: string;
  /** 1-based. */
  mark: { line: number; column: number };
}

/** Props of the import wizard's source step (WS7). */
export interface ImportSourceProps {
  activeTab: ImportTab;
  onTabChange: (tab: ImportTab) => void;
  yamlText: string;
  onTextChange: (text: string) => void;
  fileName?: string;
  onFile: (file: File) => void;
}

/** Props of the import wizard's target step (WS7). */
export interface ImportTargetsProps {
  open: boolean;
  currentScope?: ConfigScope;
  mode: TargetMode;
  onModeChange: (mode: TargetMode) => void;
  kind: ImportPrincipalKind;
  onKindChange: (kind: ImportPrincipalKind) => void;
  selected: ImportPrincipal | null;
  onSelect: (principal: ImportPrincipal) => void;
  newType: PrincipalType.ROLE | PrincipalType.GROUP;
  onNewTypeChange: (type: PrincipalType.ROLE | PrincipalType.GROUP) => void;
  newName: string;
  onNewNameChange: (name: string) => void;
}

/** Props of the import wizard's preview step (WS7). */
export interface ImportPreviewProps {
  preview: ImportPreviewState;
  targetLabel: string;
  isScope: boolean;
  included: ReadonlySet<string>;
  onToggle: (fieldPath: string, include: boolean) => void;
}

/** What the wizard asks to write (WS7). */
export interface ImportRequest {
  target: ImportTarget;
  entries: SaveEntry[];
}

/** Shared by the review and import preview to label rows (WS7). */
export interface ReviewLabelContext {
  localize: LocalizeFn;
  fields: SchemaField[];
  /** The tree entries are titled from (pending values overlaid). */
  tree: ConfigRecord | null;
}
