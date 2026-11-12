import type { ReactNode } from 'react';
import type { ConfigRecord, SchemaField, OptionSource, FieldMetaGroup } from './config';
import type { ProvenanceSource, SettingRow } from './values';
import type { FieldRendererProps } from './config-ui';
import type { FieldControlProps } from './controls';

/** What an allowlist entry may look like, and the copy its control shows (WS13 FX-16). */
export interface DomainListPolicy {
  /** URL schemes an entry may name; others are rejected (Actions only call http(s)). */
  protocols: readonly string[];
  /** Status line while the list is empty: no restriction. */
  emptyKey: string;
  /** Status line while the list restricts (`{{count}}` entries). */
  activeKey: string;
  /** Question asked before the last entry is removed. */
  confirmKey: string;
}

/** Why a typed allowlist entry is rejected. */
export type DomainIssue = 'invalid' | 'wildcard' | 'path' | 'protocol' | 'duplicate';

/** A list of domains (`actions.allowedDomains`): chips, validated entry, and what empty means. */
export interface DomainListFieldProps {
  id: string;
  /** Data path of the list; picks its `DomainListPolicy`. */
  path: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** Removes the target's own list: no restriction, or the list beneath when there is one. */
  onClear: () => boolean | void;
  /** The list the layer beneath sets (librechat.yaml in Base, Base in a profile), if any. */
  lowerValues?: string[];
  /** The edit target holds its own list (an override or a pending edit). */
  hasOwnValue?: boolean;
  /** `inherited` when the list beneath is Base's (in a profile), else librechat.yaml's. */
  lowerSource?: ProvenanceSource;
  disabled?: boolean;
  'aria-label'?: string;
}

/** A web search service the panel can configure (WS13 FX-2). */
export type WebSearchCategory = 'providers' | 'scrapers' | 'rerankers';

/** One setting a web search service reads its credentials or endpoint from. */
export interface WebSearchCredential {
  /** Key under `webSearch` (`serperApiKey`). */
  key: string;
  /** LibreChat cannot use the service without it. */
  required: boolean;
  /** A key: typed into a masked input. */
  secret: boolean;
  /**
   * LibreChat stores it encrypted and returns a masked preview (`<key>Preview`)
   * only once it reports `webSearchStoredKeys` (Keenable); otherwise always, when `secret`.
   */
  encryptedSince?: 'webSearchStoredKeys';
  /** The environment variable LibreChat reads when the key is not set (`SERPER_API_KEY`). */
  env: string;
}

/** A search provider, scraper or reranker and the settings it uses. */
export interface WebSearchService {
  /** Enum value of the selecting field (`serper`). */
  value: string;
  /** Locale key of its proper name. */
  labelKey: string;
  credentials: WebSearchCredential[];
  /** Key of its options object under `webSearch` (`firecrawlOptions`). */
  optionKeys: string[];
}

/** Where a credential's value comes from, as the editor reports it. */
export type CredentialStatus = 'env' | 'stored' | 'set' | 'pending' | 'missing' | 'default';

/** The status of one credential and what it shows. */
export interface CredentialState {
  status: CredentialStatus;
  /** Environment variable referenced (`SERPER_API_KEY`), for `env` and `default`. */
  env?: string;
  /** Masked preview of a stored secret, for `stored`. */
  preview?: string;
}

/** Props of a credential's control: the field control props plus the credential definition. */
export interface CredentialControlProps extends FieldControlProps {
  credential: WebSearchCredential;
  /** Name of the service that reads it, for the "Required" hint. */
  serviceName: string;
  /** The service is selected, so a missing required value breaks web search. */
  inUse: boolean;
}

/** A web search service as the editor shows it: the roles it is selected for, merged. */
export interface WebSearchServiceView {
  value: string;
  labelKey: string;
  /** Categories it is selected for (empty when shown through "Show all services"). */
  roles: WebSearchCategory[];
  credentials: WebSearchCredential[];
  optionKeys: string[];
}

/** One service group of the web search editor. */
export interface WebSearchServiceProps extends FieldRendererProps {
  service: WebSearchServiceView;
}

/** A group of a feature section's fields under a heading (Interface: "Chat controls"). */
export interface FeatureGroupDef extends FieldMetaGroup {
  labelKey: string;
  descriptionKey?: string;
  /** Child fields of these object fields are shown flat under a sub-heading (`privacyPolicy`). */
  flatten?: string[];
}

/** One renderer-chosen control per field key, for `FeatureFields`. */
export type FeatureControls = Partial<Record<string, (props: FieldControlProps) => ReactNode>>;

/** Fields of a feature section rendered in order, with optional custom controls per key. */
export interface FeatureFieldsProps extends FieldRendererProps {
  controls?: FeatureControls;
}

/** A field group of a feature section with its heading and counts. */
export interface FeatureGroupProps extends FieldRendererProps {
  group: FeatureGroupDef;
  /** Every field of the section (the group picks its own). */
  allFields: SchemaField[];
  controls?: FeatureControls;
}

/** How the memory agent is defined (WS13 FX-3). */
export type MemoryAgentMode = 'id' | 'inline';

/** The memory agent's state as the editor reads it. */
export interface MemoryAgentState {
  /** The agent as users get it, without keys hidden (or pending to be hidden). */
  value: ConfigRecord;
  mode: MemoryAgentMode | undefined;
  /** Keys the layer beneath sets (librechat.yaml in Base, Base in a profile). */
  lowerKeys: string[];
  /** Keys already hidden or queued to be hidden. */
  hiddenKeys: ReadonlySet<string>;
}

/** The edits that switch the memory agent between an ID and an inline model, by path. */
export interface MemoryAgentSwitch {
  /** Keys the layer beneath sets: hidden (tombstoned) so they stop applying. */
  hide: string[];
  /** Keys only the edit target stores: their override is removed. */
  reset: string[];
  /** Keys of the chosen definition hidden earlier in this edit: shown again. */
  unhide: string[];
  /** Keys of the chosen definition the edit target already hides (a saved tombstone): unhidden. */
  show: string[];
  /** Values typed for the other definition in this edit: dropped. */
  discard: string[];
}

/** One surface of the content filters summary (WS13 FX-1). */
export interface FilterSurfaceSummary {
  key: string;
  label: string;
  /** `block` or `audit`, else undefined (the surface is not filtered). */
  action?: string;
  /** Fields scanned, as labels. */
  fields: string[];
  /** Built-in patterns, as labels; null when unset (every built-in pattern applies). */
  starterPatterns: string[] | null;
  /** Custom patterns, by label. */
  customPatterns: string[];
  /** Surface settings outside `pii` (`unattributedAssistantContent`), as label/value. */
  extras: SettingRow[];
}

/** The summarization trigger as the editor reads it (WS13 FX-4). */
export interface TriggerValue {
  type?: string;
  value?: number;
}

/** Limits of a trigger type's value. */
export interface TriggerRule {
  min: number;
  max?: number;
  int: boolean;
  step: number;
  /** Suggested value when the type is chosen. */
  suggested: number;
}

/** A provider or model picker in a feature editor (memory agent, summarization). */
export interface RefPickerProps extends FieldControlProps {
  source?: OptionSource;
  /** Flags an empty value: the definition it belongs to needs it. */
  requiredHint?: boolean;
}

/** The memory agent editor: the `memory.agent` schema field and the section's renderer props. */
export interface MemoryAgentProps extends FieldRendererProps {
  field: SchemaField;
}

/** How a status line under a feature control reads: neutral, all good, or a warning. */
export type StatusTone = 'muted' | 'ok' | 'warn';

/** The status line of a web search credential. */
export interface CredentialStatusLine {
  tone: StatusTone;
  icon: 'key' | 'lock' | 'warning' | 'user';
  text: string;
}

/** A note under the memory agent's definition choice. */
export interface AgentNoteProps {
  tone?: Exclude<StatusTone, 'ok'>;
  children: string;
}

/** "Enable memory": the field control props plus whether a memory block exists. */
export interface EnableMemoryControlProps extends FieldControlProps {
  /** librechat.yaml (or an override) sets something under `memory`, which turns memory on. */
  hasMemoryBlock: boolean;
}

/** An object field shown flat inside a feature group, under its own sub-heading. */
export interface FlatObjectProps extends FieldRendererProps {
  field: SchemaField;
  controls?: FeatureControls;
  /** Show the object's name above its rows (several objects share the group). */
  titled: boolean;
}

/** One surface card of the content filters summary. */
export interface SurfaceCardProps {
  summary: FilterSurfaceSummary;
}
