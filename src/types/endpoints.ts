import type { SettingDefinition } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { ConfigRecord, ConfigValue, SchemaField } from './config';

/**
 * Where a custom endpoint comes from, seen from the edit target (WS10): in
 * Base, librechat.yaml (`yaml`) or the admin panel (`admin`); in a profile,
 * Base (`inherited`) or the profile itself (`scope`).
 */
export type EndpointOrigin = 'yaml' | 'admin' | 'inherited' | 'scope';

/** What is wrong with a custom endpoint, by field (WS10 CE-3/CE-4). */
export type EndpointIssueCode =
  | 'nameRequired'
  | 'nameWhitespace'
  | 'nameTaken'
  | 'nameSimilar'
  | 'nameMerged'
  | 'nameReserved'
  | 'nameUnaddressable'
  | 'apiKeyRequired'
  | 'baseUrlRequired'
  | 'baseUrlInvalid'
  | 'modelsRequired'
  | 'modelBlank'
  | 'modelDuplicate'
  | 'renameNeedsKey';

export interface EndpointIssue {
  /** Field inside the entry (`name`, `models.default`). */
  field: string;
  code: EndpointIssueCode;
  /** `error` blocks the save; `warning` is shown but saves. */
  severity: 'error' | 'warning';
  /** LibreChat skips the endpoint at runtime while this is unresolved ("Incomplete – not served"). */
  unserved?: boolean;
  params?: Record<string, string>;
}

/** Inputs of `validateEndpoint`. */
export interface EndpointValidationInput {
  entry: ConfigValue;
  /** Names of the other endpoints in the list (pending), to catch duplicates. */
  otherNames: readonly string[];
  /** The layer beneath defines this endpoint (its literal key is redacted on read). */
  fromLowerLayer: boolean;
  /** The target stores an encrypted key for it, readable only as a preview. */
  storedSecret: boolean;
  /** The name the entry was loaded with, when it was renamed since. */
  loadedName?: string;
  /** A rename keeps the stored key: the server moves it to the new name (`getSecretCarry`). */
  carriesKey?: boolean;
  /**
   * Where the server removes and hides entries by name (`keyedTombstones`), the longest name it
   * addresses (`limits.maxEntryKeyLength`): a name it can't address could not be removed later.
   */
  maxKeyLength?: number;
}

/** One custom endpoint as the list shows it (WS10 CE-7). */
export interface EndpointRow {
  /** Stable React key across edits, renames and removals. */
  key: string;
  /** Position in the pending list. */
  index: number;
  value: ConfigRecord;
  title: string;
  /** The entry's name, when it has one. */
  identity?: string;
  /** The name it was loaded with (differs after a pending rename); undefined for a new entry. */
  loadedName?: string;
  origin: EndpointOrigin;
  /** The target stores its own override of an endpoint the layer beneath defines. */
  overridden: boolean;
  /** Added since the page loaded (not saved yet). */
  isNew: boolean;
  /** Differs from its saved value. */
  edited: boolean;
  /** The endpoint as saved (what Undo goes back to); undefined for a new one. */
  saved?: ConfigRecord;
  /** The target's own stored override of the endpoint, as the admin API reads it back. */
  own?: ConfigRecord;
  host: string | null;
  modelCount: number;
  fetchesModels: boolean;
  /** An encrypted key is stored for it; the read shows only its preview. */
  storedSecret: boolean;
  issues: EndpointIssue[];
}

/**
 * How hiding custom endpoints changes a list that allows endpoints by name
 * (`modelSpecs.addedEndpoints`, `endpoints.agents.allowedProviders`): it
 * names none of them (`none`); it loses their names (`dropped`); or it names
 * only endpoints the profile hides (`only`), which LibreChat keeps whole,
 * since an empty list allows every endpoint, so it allows none.
 */
export type HiddenNameUse = 'none' | 'dropped' | 'only';

/**
 * What LibreChat hides along with custom endpoints a profile hides
 * (`findHiddenEndpointUses`): the model specs that select one (by title),
 * and how the added endpoints and the agents' allowed providers change.
 */
export interface HiddenEndpointUses {
  specs: string[];
  addedEndpoints: HiddenNameUse;
  allowedProviders: HiddenNameUse;
}

/** The lists of `HiddenEndpointUses` that allow endpoints by name. */
export type HiddenNameList = Exclude<keyof HiddenEndpointUses, 'specs'>;

/** An entry of a keyed collection the open profile hides whole (`keyedTombstones`), saved or pending. */
export interface HiddenEntry {
  /** The entry's name, as the layer beneath spells it when it has the entry. */
  name: string;
  /** The keyed path of its tombstone (`endpoints.custom["Name"]`). */
  path: string;
  /** Hidden by a pending edit, not saved yet. */
  pending: boolean;
}

/** The entries of a collection the open profile hides, and the hidden ones it is about to show again, by identity. */
export interface HiddenEntries {
  hidden: ReadonlyMap<string, HiddenEntry>;
  unhiding: ReadonlyMap<string, HiddenEntry>;
}

/** A keyed tombstone inside an entry's record, as the record's editor reads it: its path, and whether it is pending. */
export interface RecordRemovalRef {
  /** The keyed path (`endpoints.custom["Name"].headers.X-Team`). */
  path: string;
  /** Removed by a pending hide, not saved yet. */
  pending: boolean;
}

/** What `useEntryKeyRemoval` needs of the open endpoint. */
export interface EntryKeyRemovalOptions {
  /** `endpoints.custom` */
  collectionPath: string;
  /** The entry's data path on the page (`endpoints.custom.3`). */
  entryPath: string;
  /** The name it was loaded with; undefined for a new endpoint. */
  name?: string;
  /** The endpoint as the layer beneath defines it; undefined for one the target adds. */
  lowerEntry?: ConfigRecord;
  onHide?: (path: string) => void;
  onUnhide?: (path: string) => void;
}

/** A saved endpoint a pending edit removes; Undo puts it back at `restoreIndex`. */
export interface EndpointRemoval {
  key: string;
  title: string;
  value: ConfigValue;
  /** Position in the collection as loaded. */
  index: number;
  /** Where Undo puts it back in the pending list: before the first surviving entry loaded after it. */
  restoreIndex: number;
}

/** The custom endpoint list of the open target, with pending edits (WS10). */
export interface EndpointRows {
  rows: EndpointRow[];
  removals: EndpointRemoval[];
  /** The value of an endpoint in the layer beneath (librechat.yaml, or Base in a profile). */
  lowerEntry: (name: string) => ConfigRecord | undefined;
}

export interface EndpointRowsOptions {
  /** `endpoints.custom` */
  path: string;
  items: ConfigValue[];
}

/** A field of the endpoint editor: its key inside the entry, which may be nested (`models.default`). */
export interface EndpointFieldDef {
  key: string;
  /** Shown only when set, or once added from "Add setting". */
  optional?: boolean;
}

/** One section of the endpoint editor (WS10 CE-7). */
export interface EndpointSectionDef {
  id: string;
  labelKey: string;
  descriptionKey?: string;
  fields: EndpointFieldDef[];
  /** Unknown and remaining schema keys land here. */
  catchAll?: boolean;
}

export interface EndpointDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Chips beside the title (source, state). */
  badges?: ReactNode;
  /** Short line under the title (base URL host, origin). */
  subtitle?: ReactNode;
  /** Shown above the body, below the header (banners). */
  notice?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  /** Close requests (Esc, overlay, ×) go here instead, e.g. to confirm discarding a draft. */
  onRequestClose?: () => void;
  bodyRef?: React.Ref<HTMLDivElement>;
  /** The element focus goes back to on close (there is no Radix trigger). */
  returnFocus?: () => HTMLElement | null;
}

export interface EndpointEditorProps {
  /** Data path of the entry (`endpoints.custom.3`), or the draft's while creating. */
  path: string;
  fields: SchemaField[];
  value: ConfigRecord;
  /** Writes one key of the entry; `undefined` removes it. */
  onFieldChange: (key: string, value: ConfigValue) => void;
  issues: EndpointIssue[];
  origin: EndpointOrigin;
  disabled?: boolean;
  storedSecret: boolean;
  /** The endpoint as the layer beneath defines it (librechat.yaml, or Base in a profile). */
  lowerEntry?: ConfigRecord;
  /** The endpoint as saved, which a field's Undo goes back to. */
  savedEntry?: ConfigRecord;
  /** The target's own stored override of the endpoint (a key it restates is read from it). */
  ownEntry?: ConfigRecord;
  /** Default models of another custom endpoint, for model pickers that name it. */
  modelsOf?: (endpoint: string) => readonly string[];
  /** Only the essentials (creating): Connection and Models. */
  essentialsOnly?: boolean;
  /** Field rows carry Edited/Undo and override/Revert chips (saved endpoints). */
  showChips?: boolean;
  /** Entry field to bring into view (`baseURL`, `customParams.paramDefinitions.0`). */
  revealField?: string;
  /** Called with the full path once `revealField` is rendered, to scroll to and focus it. */
  onRevealed?: (path: string) => void;
  editSessionId?: number;
  /** The name the endpoint was loaded with, which keyed tombstones name it by. */
  loadedName?: string;
  /** Hides or unhides a path (`keyedTombstones`: an inherited key of a record, by key). */
  onHideField?: (path: string) => void;
  onUnhideField?: (path: string) => void;
}

/** A starting point offered when creating a custom endpoint (WS10 CE-10). */
export interface EndpointTemplate {
  id: string;
  /** Display name, also the suggested endpoint name. */
  name: string;
  descriptionKey: string;
  /** The entry the template starts from (name included). */
  entry: ConfigRecord;
}

/** Props of the chips an editor row carries: unsaved change with Undo, admin override with Revert. */
export interface EntryFieldChipsProps {
  /** Data path of the field (`endpoints.custom.3.baseURL`). */
  path: string;
  label: string;
  /** The value shown in the control (the pending one). */
  value: ConfigValue;
  /** Writes the field (Undo puts the saved value back). */
  onChange: (value: ConfigValue) => void;
  /** Goes back to the value of the layer beneath (default: writes that value). */
  onRevert?: () => boolean | void;
  /**
   * False where going back restores nothing: a secret the target stores over
   * one the layer beneath holds hidden, which only the entry's own revert
   * takes back.
   */
  revertable?: boolean;
  disabled?: boolean;
}

/** Props of the endpoint editor's field chips. */
export interface FieldChipsProps extends EntryFieldChipsProps {
  /** The field's saved value: the pending one differs from it while Edited. */
  saved: ConfigValue;
  /** The endpoint comes from the layer beneath, so a value it sets can be an override. */
  showOverride: boolean;
}

/** Renders the extra chips of an entry field row, provided by a collection editor (WS10). */
export type EntryFieldChipsRenderer = (props: EntryFieldChipsProps) => ReactNode;

/** Tone of a notice in the endpoint editor. */
export type EndpointBannerTone = 'info' | 'warning' | 'danger' | 'neutral';

/** Props of the custom endpoint list (WS10 CE-7). */
export interface EndpointListProps {
  rows: EndpointRow[];
  removals: EndpointRemoval[];
  /** Read-only: rows open the editor for viewing; no revert or delete. */
  disabled?: boolean;
  /** The row whose editor is open. */
  openKey?: string | null;
  onOpen: (row: EndpointRow) => void;
  /** A reveal (table of contents, search, review) asks for the row: open its editor, keeping any field target. */
  onReveal: (row: EndpointRow) => void;
  onDelete: (row: EndpointRow) => void;
  /** Reverts every override of the endpoint (to librechat.yaml, or to Base in a profile). */
  onRevert: (row: EndpointRow) => void;
  /** In a profile: starts overriding an endpoint Base defines ("Override for Role: USER"). */
  override?: { label: string; onSelect: (row: EndpointRow) => void };
  /** In a profile (`keyedTombstones`): hides an endpoint Base defines for the profile's members. */
  hide?: EndpointHideAction;
  onUndoRemoval: (removal: EndpointRemoval) => void;
  /** What a removal leaves in the profiles that override the endpoint by name (`describeEntryOverrides`). */
  removalNotes?: (removal: EndpointRemoval) => readonly string[];
  /** Row ids are `${idPrefix}-${index}`, the ids the table of contents and deep links target. */
  idPrefix: string;
}

/** "Hide for Role: USER" of an endpoint's menu (`keyedTombstones`). */
export interface EndpointHideAction {
  label: string;
  /** Whether the row offers Hide: an endpoint the layer beneath defines. */
  offers: (row: EndpointRow) => boolean;
  /** Why an offered Hide is unavailable (a name LibreChat can't hide by key), if it is. */
  disabledReason: (row: EndpointRow) => string | undefined;
  onSelect: (row: EndpointRow) => void;
}

/** One endpoint the open profile hides, or is about to show again, with what goes with it. */
export interface EndpointHiddenItem {
  identity: string;
  entry: HiddenEntry;
  /** A pending unhide: it is shown again once saved. */
  unhiding: boolean;
  uses: HiddenEndpointUses;
}

/** One row of `EndpointHiddenListProps`. */
export interface EndpointHiddenRowProps extends Pick<EndpointHiddenListProps, 'onToggle'> {
  item: EndpointHiddenItem;
}

/** The endpoints the open profile hides (`keyedTombstones`), listed under the others. */
export interface EndpointHiddenListProps {
  items: EndpointHiddenItem[];
  /** Unhides a saved hide, or undoes a pending hide or unhide; absent when read-only. */
  onToggle?: (item: EndpointHiddenItem) => void;
}

/** Props of a saved endpoint a pending edit removes, listed with Undo (D9). */
export interface EndpointRemovalRowProps {
  removal: EndpointRemoval;
  disabled?: boolean;
  onUndo: (removal: EndpointRemoval) => void;
  notes?: readonly string[];
}

/** Props of the create flow (WS10 CE-3, CE-10). */
export interface EndpointCreatorProps {
  open: boolean;
  /** Schema fields of a custom endpoint entry. */
  fields: SchemaField[];
  /** Names of the endpoints in the list (pending), to keep the new name unique. */
  names: readonly string[];
  /** In a profile: names Base defines, which are overridden rather than created (CE-8). */
  inheritedNames: readonly string[];
  onCreate: (entry: ConfigRecord) => void;
  /** Opens the inherited endpoint `name` to override it instead. */
  onOverride: (name: string) => void;
  onClose: () => void;
  /** Where focus goes when the flow closes without creating (the Create button). */
  returnFocus?: () => HTMLElement | null;
}

/** Props of an endpoint's "Parameters from" row: the built-in parameter set its users get. */
export interface ParamSetRowProps {
  path: string;
  field: SchemaField;
  value: ConfigValue;
  chips?: ReactNode;
  disabled?: boolean;
  onChange: (value: ConfigValue) => void;
  /** Unset, LibreChat uses OpenRouter's parameter set for this endpoint (`customParamsExpansion`). */
  openRouter?: boolean;
}

/** Props of an endpoint's parameter definitions (WS10 CE-6). */
export interface ParamDefinitionsRowProps {
  /** Data path of the list (`endpoints.custom.3.customParams.paramDefinitions`). */
  path: string;
  field: SchemaField;
  value: ConfigValue;
  /** Keys of the definitions the layer beneath defines: they keep their key and can't be removed. */
  lowerKeys: ReadonlySet<string>;
  /** The parameter set whose built-in parameters can be overridden (`custom`, `anthropic`, …). */
  paramSet?: string;
  /**
   * LibreChat completes each definition from the parameter set
   * (`customParamsExpansion`), an override's too: a built-in parameter is
   * added as `{ key, default }`, as librechat.yaml writes it.
   */
  compact?: boolean;
  /** LibreChat adds OpenRouter's parameters to this endpoint (`customParamsExpansion`). */
  openRouterDefaults?: boolean;
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  editSessionId?: number;
  chips?: ReactNode;
}

/** Props of one parameter definition's fields (WS10 CE-6). */
export interface ParamDefinitionEntryProps {
  fields: SchemaField[];
  value: ConfigRecord;
  /** Data path of the definition. */
  path: string;
  onChange: (key: string, value: ConfigValue) => void;
  disabled?: boolean;
  builtIns: Map<string, SettingDefinition>;
  /** The layer beneath defines this definition: its key can't change. */
  keyLocked: boolean;
}

/** Props of a list of names edited as tags (`dropParams`). */
export interface TagListFieldProps {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** Called instead of emitting an empty list when the last tag is removed. */
  onClear: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Props of an endpoint's token pricing table (WS10 CE-7). */
export interface PricingRowProps {
  /** Data path of `tokenConfig`. */
  path: string;
  /** The schema of `tokenConfig`: its entries' fields name the rates. */
  field?: SchemaField;
  value: ConfigValue;
  /** The endpoint's models, suggested when adding a row. */
  models: readonly string[];
  /** Models the layer beneath prices: their rows can change but not be removed. */
  lockedModels: ReadonlySet<string>;
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  chips?: ReactNode;
}

/** Props of a list row's "Not served" chip, from the scope catalog. */
export interface EndpointServedBadgeProps {
  row: Pick<EndpointRow, 'identity' | 'isNew' | 'edited' | 'issues'>;
}

/** Props of one row of the endpoint list. */
export interface EndpointListRowProps extends Pick<
  EndpointListProps,
  'idPrefix' | 'disabled' | 'onOpen' | 'onReveal' | 'onDelete' | 'onRevert' | 'override' | 'hide'
> {
  row: EndpointRow;
  isOpen: boolean;
}

/** The Global shadow chip of one endpoint reference row (D11). */
export interface ShadowChipProps {
  path: string;
  /** The endpoint's own value; nothing is shadowed while it sets none. */
  value: ConfigValue;
}

/** One link of the endpoint editor's section nav (WS10). */
export interface EndpointNavSection {
  id: string;
  label: string;
  /** Problems in the section that block saving. */
  errorCount: number;
}

/** The endpoint editor's sticky section links (WS10). */
export interface EndpointSectionNavProps {
  sections: EndpointNavSection[];
  /** Sections have the ids `<idPrefix>-section-<id>`. */
  idPrefix: string;
}

/** A schema field of the endpoint editor by entry key; nested ones (`models.default`) name their parent. */
export interface EndpointResolvedField {
  key: string;
  field: SchemaField;
  parentKey?: string;
}

/** One section of the endpoint editor as laid out: its rows shown and to add, and its warnings. */
export interface EndpointSectionLayout {
  section: EndpointSectionDef;
  visible: EndpointFieldDef[];
  hidden: EndpointFieldDef[];
  warnings: string[];
}

/** One row of the endpoint editor (WS10): label and help from the field, the control, chips and a note. */
export interface EndpointEditorRowProps {
  /** Data path of the field. */
  path: string;
  /** Its schema field (label meta and help text). */
  field: SchemaField;
  required?: boolean;
  chips?: ReactNode;
  control: ReactNode;
  /** Shown under the control, muted (a non-blocking warning, a lock note). */
  note?: ReactNode;
}
