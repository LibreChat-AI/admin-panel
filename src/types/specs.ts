import type { ReactNode } from 'react';
import type { ConfigRecord, ConfigValue, ControlWidth, SchemaField, SelectOption } from './config';
import type { FieldRendererProps } from './config-ui';

/**
 * How users pick models (MS-3), stored as `modelSpecs.enforce` and
 * `modelSpecs.prioritize`: specs only, specs first, or endpoints first.
 */
export type SpecSelectionMode = 'enforce' | 'prioritize' | 'endpoints';

/** What the "Users will see" line of the spec list is worded from (`previewText`). */
export interface SpecsPreviewInput {
  /** The specs the target's members get. */
  items: ConfigValue[];
  mode: SpecSelectionMode;
  menuOn: boolean;
  /** The labels of the endpoints the menu adds that the members get. */
  added: string[];
  /** The menu's added endpoints are all hidden for the members, so it adds none (`keyedTombstones`). */
  addsNone?: boolean;
}

/** Which "new chat" default a spec is: none, the soft default, or the default (one of each per list). */
export type SpecDefaultKind = 'none' | 'soft' | 'default';

/** A problem with one spec, or with the list (`index` -1). Errors block Save; warnings don't. */
export interface SpecProblem {
  index: number;
  /** Path inside the spec (`label`, `preset.endpoint`, `default`). */
  field: string;
  /** Issue code; its message is `com_config_issue_<code>` (`required`, `spec_duplicate_name`). */
  code: string;
  level: 'error' | 'warning';
  params?: Record<string, string | number>;
}

/** What spec validation needs to know about the rest of the configuration. */
export interface SpecValidationContext {
  /** Endpoint names a spec may use: built-in providers and custom endpoint names. Empty: unknown. */
  knownEndpoints: ReadonlySet<string>;
}

/** Control a preset parameter gets, from LibreChat's own parameter settings (`paramSettings`). */
export type PresetParamKind = 'number' | 'boolean' | 'enum' | 'text' | 'textarea' | 'list';

/** One model parameter a spec's preset can set for its endpoint (MS-4). */
export interface PresetParam {
  key: string;
  kind: PresetParamKind;
  min?: number;
  max?: number;
  step?: number;
  /** Choices of an enum parameter. */
  options?: string[];
  /** What LibreChat uses when the preset leaves the parameter unset. */
  defaultValue?: ConfigValue;
}

/** The parameters an endpoint (and model) offers, as LibreChat's parameter panel resolves them. */
export interface PresetParamSet {
  /** `paramSettings` key the parameters come from (`anthropic`, `bedrock-anthropic`, `custom`). */
  settingsKey: string | null;
  params: PresetParam[];
}

/** Option lists the spec editor offers: endpoints, an endpoint's models, MCP servers, groups. */
export interface SpecOptions {
  endpoints: SelectOption[];
  /** Built-in providers and custom endpoint names the configuration defines. */
  knownEndpoints: ReadonlySet<string>;
  /** Names of custom endpoints (`endpoints.custom[].name`). */
  customEndpoints: ReadonlySet<string>;
  mcpServers: SelectOption[];
  groups: SelectOption[];
  /** Models to suggest for an endpoint (its configured list and other specs' models). */
  modelsFor: (endpoint: string) => SelectOption[];
  /** Custom endpoint settings by name (its `customParams` decide the parameter set). */
  customEndpoint: (name: string) => ConfigRecord | undefined;
}

/** List-wide actions a spec editor needs (a default is unique across the list). */
export interface SpecListActions {
  setDefault: (index: number, kind: SpecDefaultKind) => void;
}

/** Context the spec editor and summaries read (one per list). */
export interface SpecListContextValue {
  items: ConfigValue[];
  problems: SpecProblem[];
  options: SpecOptions;
  actions: SpecListActions;
  /** Names the specs had when loaded: renaming one of them breaks links and conversations. */
  savedNames: ReadonlySet<string>;
  /** Positions of the specs added in this session (by origin, so a renamed saved spec isn't one). */
  addedIndexes: ReadonlySet<number>;
  /** "Set values only": rows and groups without a value are left out. */
  configuredOnly: boolean;
}

export type ModelSpecsRendererProps = FieldRendererProps;

export interface SpecsSettingsProps extends FieldRendererProps {
  /** The specs as shown (pending edits included), for the preview line. */
  items: ConfigValue[];
  options: SpecOptions;
}

export interface SpecListProps extends FieldRendererProps {
  listField: SchemaField;
  items: ConfigValue[];
  options: SpecOptions;
  problems: SpecProblem[];
}

export interface SpecSummaryProps {
  spec: ConfigValue;
  index: number;
}

export interface SpecIconProps {
  iconURL: ConfigValue;
  label: string;
  size?: 'sm' | 'md';
}

/** One collapsible group of the spec editor (Basics, Model, Capabilities, …). */
export interface SpecGroupProps {
  title: string;
  description?: string;
  /** Data paths inside the group: it opens for a search hit or a field error there. */
  paths: string[];
  defaultExpanded?: boolean;
  /** Settings the spec sets in this group, shown as a count while collapsed. */
  configuredCount?: number;
  totalCount?: number;
  children: ReactNode;
}

export interface SpecEditorProps {
  fields: SchemaField[];
  value: ConfigValue;
  /** Data path of the spec (`modelSpecs.list.3`). */
  path: string;
  onChange: (key: string, value: ConfigValue) => void;
  disabled?: boolean;
  editSessionId?: number;
}

export interface PresetEditorProps {
  presetField: SchemaField;
  preset: ConfigRecord;
  /** The parameters the spec's endpoint and model offer (`presetParams`). */
  params: PresetParam[];
  /** Data path of the preset (`modelSpecs.list.3.preset`). */
  path: string;
  onChange: (key: string, value: ConfigValue) => void;
  /** Replaces the whole preset (the YAML escape hatch). */
  onReplace: (preset: ConfigRecord) => void;
  disabled?: boolean;
  editSessionId?: number;
}

/** A row the spec editor renders with its own control (not the generic field control). */
export interface SpecFieldRowProps {
  path: string;
  label: string;
  description?: string;
  required?: boolean;
  /** The spec problem shown under the control (falls back to the save pipeline's error). */
  problem?: SpecProblem;
  control: ReactNode;
  width?: ControlWidth;
  /**
   * The field is empty on a spec added in this session: a missing value isn't
   * flagged until the admin leaves the field (the card badge still counts it).
   */
  quietWhenEmpty?: boolean;
  /** More data paths the row stands for (the Default row is also the soft default), for the tab filter. */
  matchPaths?: string[];
}

/** A labelled group of choices (rendered as an `<optgroup>`). */
export interface SpecOptionGroup {
  label: string;
  options: SelectOption[];
}

/** Picks a set of values from known choices as removable chips (Added endpoints, MCP servers). */
export interface ChipPickerProps {
  id: string;
  values: string[];
  groups: SpecOptionGroup[];
  onChange: (values: string[]) => void;
  /** Called instead of emitting `[]` when the last chip is removed (returns false when it can't be). */
  onClear?: () => boolean;
  disabled?: boolean;
  /** Label of the add picker ("Add endpoint…"). */
  addLabel: string;
  /** Text of a chip whose value matches no choice ("Foo (not configured)"). */
  unknownLabel: (value: string) => string;
  /** The choice a value names, where several spellings name one (`Ollama` is `ollama`). */
  matchValue?: (value: string) => string;
  'aria-label': string;
  'aria-describedby'?: string;
}

/** A single choice from grouped options, keeping (and flagging) a value that matches none. */
export interface GroupedSelectProps {
  id: string;
  value: string | undefined;
  groups: SpecOptionGroup[];
  onChange: (value: string) => void;
  placeholder: string;
  unknownLabel: (value: string) => string;
  required?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
}

/** A note in the specs section: information, a warning, or the "Users will see" preview. */
export interface SpecNoteProps {
  tone: 'info' | 'warning' | 'preview';
  icon?: ReactNode;
  /** Buttons after the text (Revert list, Customize list, Open Model select). */
  action?: ReactNode;
  children: ReactNode;
}

/** Props of one spec editor field with its own control (Label, Name, Icon, Group, Default, MCP). */
export interface SpecFieldProps {
  field?: SchemaField;
  spec: ConfigRecord;
  index: number;
  /** Data path of the spec (`modelSpecs.list.3`). */
  path: string;
  onChange: (key: string, value: ConfigValue) => void;
  disabled?: boolean;
}

/** A spec field stored in its preset (Endpoint, Model, Agent). */
export interface SpecPresetFieldProps extends SpecFieldProps {
  onPresetChange: (key: string, value: ConfigValue) => void;
}

/** The icon of the spec (`iconURL`) or of its group (`groupIcon`). */
export interface SpecIconFieldProps extends Omit<SpecFieldProps, 'index'> {
  keyName?: 'iconURL' | 'groupIcon';
}

/** An interface control model specs decide (`SPEC_CONTROL_KEYS`). */
export type SpecControlKey = 'modelSelect' | 'parameters' | 'presets';
