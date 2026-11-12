import type { ReactNode } from 'react';
import type { ConfigSectionConfig, FieldRendererProps, SectionCount } from './config-ui';
import type { FieldState, ProvenanceSource } from './values';
import type { SchemaField, SelectOption } from './config';

/** Which MIME list a path holds; each has its own LibreChat default (WS14, FX-7). */
export type MimeListKind = 'text' | 'ocr' | 'endpoint';

/** Why a MIME pattern cannot be saved as typed. */
export type MimePatternIssue = 'invalid' | 'unsupported' | 'duplicate';

/** A named set of MIME patterns the editor can add in one step. */
export interface MimePreset {
  key: string;
  labelKey: string;
  patterns: string[];
}

/** A MIME list change waiting for confirmation: emptying the list, or a pattern that matches every type. */
export type MimeConfirm = { kind: 'empty' } | { kind: 'matchAll'; pattern: string; next: string[] };

/** Where a MIME list that is not customized comes from. */
export type MimeListOrigin = ProvenanceSource | 'defaultEntry';

/** The list a MIME field uses while it has no value of its own, and where it comes from. */
export interface InheritedMimeList {
  patterns: string[];
  origin: MimeListOrigin;
}

export interface MimeListFieldProps {
  id: string;
  /** Data path of the list (`fileConfig.endpoints.agents.supportedMimeTypes`). */
  path: string;
  /** The target's own list (pending or saved); undefined while it inherits. */
  value: string[] | undefined;
  /** What applies without an own list: librechat.yaml, Base, the Default entry or LibreChat's built-in list. */
  inherited: InheritedMimeList;
  onChange: (patterns: string[]) => void;
  /** Removes the own list (back to the inherited one); returns false when nothing could be removed. */
  onClear: () => boolean | void;
  disabled?: boolean;
  'aria-label'?: string;
}

/** A storage backend the panel knows (`FileSources` storage values), with the server variables it needs. */
export type KnownStorageBackend = 'local' | 'firebase' | 's3' | 'azure_blob' | 'cloudfront';

/** A storage backend value: a known one, or one a newer LibreChat accepts (shown as written). */
export type StorageBackend = string;

/** What one storage backend needs on the LibreChat server. */
export interface StorageBackendInfo {
  backend: KnownStorageBackend;
  /** Environment variables the server must have for this backend. */
  envVars: string[];
  /** Locale key of the alternatives and optional variables (IAM role, managed identity). */
  noteKey?: string;
}

/** A `fileStrategies` key: the catch-all `default`, or one kind of file. */
export type StorageFileType = 'default' | 'avatar' | 'image' | 'document' | 'skills';

/** Field states of `fileStrategy` (`primary`) and each `fileStrategies` key. */
export type StorageFieldStates = Record<'primary' | StorageFileType, FieldState>;

/** The backend in effect for each kind of file; `skills` is undefined while it follows images and documents. */
export type ResolvedStorage = Record<
  'primary' | Exclude<StorageFileType, 'skills'>,
  StorageBackend
> & {
  skills: StorageBackend | undefined;
};

/** A storage change waiting for the admin's confirmation (FX-6). */
export interface StorageChangeRequest {
  /** The setting's label ("Storage backend", "Profile pictures"). */
  label: string;
  /** The `fileStrategies` key, or undefined for `fileStrategy`. */
  fileType?: StorageFileType;
  /** Where these files go now: one backend, or two for skill files split by images and documents. */
  from: readonly StorageBackend[];
  /** Where they go after the change (two when it goes back to that split). */
  to: readonly StorageBackend[];
  /** Stages the change once confirmed. */
  apply: () => void;
}

/** Props of a renderer that draws several sections as one card (`SectionMeta.group`, WS14). */
export interface SectionGroupRendererProps {
  /** The group's sections on this tab, in display order (only the visible ones). */
  sections: ConfigSectionConfig[];
  /** The field renderer props each section would get on its own. */
  propsFor: (section: ConfigSectionConfig) => FieldRendererProps;
  /** The generic content of one section (read-only and profile wrappers included). */
  renderSection: (section: ConfigSectionConfig) => ReactNode;
  counts: Record<string, SectionCount | undefined>;
  showConfiguredOnly?: boolean;
}

/** One key suggestion for a record of entries (`fileConfig.endpoints`). */
export interface KeySuggestion extends SelectOption {
  /** Shown under the option, e.g. "Custom endpoint". */
  hint?: string;
}

/** Key validation for adding or renaming a record entry: an error, or null when it may be used. */
export type KeyValidator = (key: string) => string | null;

/** One action of a confirmation dialog, besides Cancel. */
export interface ChoiceAction {
  label: string;
  onSelect: () => void;
  type?: 'primary' | 'secondary' | 'danger';
}

/** A confirmation before a risky change (switch storage, accept every or no file type, open sign-up). */
export interface ConfirmChoiceDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  /** Shown after Cancel, the last one being the main action. */
  actions: ChoiceAction[];
  onCancel: () => void;
}

/** One storage backend row of the Storage card (FX-6). */
export interface BackendRowProps {
  /** `fileStrategy` or `fileStrategies.<type>`. */
  path: string;
  label: string;
  description?: string;
  fileType?: StorageFileType;
  /**
   * The backends in effect when neither the edit target nor the layer beneath
   * sets this one: one, or skill files' image and document backends when they differ.
   */
  inherited: readonly StorageBackend[];
  /** Label of the Default choice in that case ("Inherit (Amazon S3)"). */
  inheritLabel: string;
  /** LibreChat set up CloudFront at startup, so it can be chosen. */
  cloudFrontReady: boolean;
  /** The setting's schema field, whose choices (a newer schema's included) the row offers. */
  field?: SchemaField;
  fieldProps: FieldRendererProps;
  onRequestChange: (request: StorageChangeRequest) => void;
}
