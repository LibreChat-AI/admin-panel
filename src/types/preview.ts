import type { BaseConfigData, ResolvedConfigData } from './values';
import type { ConfigScope, ScopeCandidate } from './scope';
import type { ConfigWriteRules } from './contract';
import type { ConfigPrincipal } from './catalog';
import type { ConfigRecord } from './config';

/**
 * Why the merge leaves out part of a config document, or applies it otherwise
 * than written (`AdminConfigLayerIgnoreReason` of newer `@librechat/data-schemas`).
 * `unknown`: a reason a newer server adds.
 */
export type PreviewIgnoreReason =
  | 'unknown_section'
  | 'invalid_override'
  | 'base_only_section'
  | 'base_principal_section'
  | 'base_only_path'
  | 'process_mcp_server'
  | 'interface_permission'
  | 'runtime_stop'
  | 'azure_groups_unresolved'
  | 'endpoint_rederive_off'
  | 'azure_unserved'
  | 'secret_rebinding'
  | 'destination_restored'
  | 'env_reference_not_allowed'
  | 'invalid_theme'
  | 'tenant_hidden'
  | 'unknown';

/** Part of a document the merge does not apply as written, located in librechat.yaml keys. */
export interface PreviewIgnored {
  /** librechat.yaml keys; a custom endpoint is named by its name, list items by index. */
  segments: string[];
  reason: PreviewIgnoreReason;
  /** The schema issue code of an `invalid_override`. */
  code?: string;
  /** One of the document's tombstones (a hidden value) rather than an override. */
  tombstone: boolean;
}

/** One config document of a preview, in merge order. */
export interface PreviewLayer extends ConfigPrincipal {
  priority: number;
  /** An inactive document is listed but not merged. */
  isActive: boolean;
  overrides: ConfigRecord;
  tombstones: string[];
  ignored: PreviewIgnored[];
}

/**
 * The config one principal gets, in merge order: librechat.yaml, the documents
 * that merge over it, and the result. `server`: resolved by LibreChat
 * (`resolvedApi`), which reports what it leaves out of each document; `panel`:
 * estimated by the panel from Base and the principal's own profile.
 */
export interface ConfigPreview {
  source: 'server' | 'panel';
  /** librechat.yaml as the server reads it, without admin overrides. */
  yaml: ConfigRecord;
  layers: PreviewLayer[];
  resolved: ConfigRecord;
  /** For a user resolved by the server: the role and groups their requests resolve to. */
  principals?: ConfigPrincipal[];
}

/** What the panel estimates a preview from, without `resolvedApi` (`estimateConfigPreview`). */
export interface PreviewEstimateInput {
  base: BaseConfigData;
  /** The principal's profile, when it has one. */
  scope?: ConfigScope;
  /** That profile's own overrides and tombstones. */
  own?: ResolvedConfigData;
  rules?: ConfigWriteRules;
  /** The server applies tombstones that name an entry by its key (`keyedTombstones`). */
  keyedTombstones?: boolean;
}

/** `getConfigPreviewFn`: the preview, or why the server refused it. */
export type ConfigPreviewResult =
  | { ok: true; preview: ConfigPreview }
  | { ok: false; status: number; code?: string; message?: string };

/** Who a preview shows the config of: everyone (Base), or one role, group or user. */
export type PreviewTarget = { type: 'BASE' } | { type: 'PRINCIPAL'; principal: ScopeCandidate };

/** A preview as the drawer reads it. */
export interface PreviewState {
  preview?: ConfigPreview;
  isLoading: boolean;
  /** Locale key of why it could not be loaded. */
  errorKey?: string;
  retry: () => void;
}

/** One top-level section of a previewed config. */
export interface PreviewSection {
  key: string;
  label: string;
  /** The result differs from librechat.yaml: an admin override changes it. */
  changed: boolean;
}

export interface PreviewDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Who the preview opens on: the open profile's principal, or Base. */
  initialTarget: PreviewTarget;
}

/** Props of a part of the preview that depends only on whose config it shows. */
export interface PreviewTargetProps {
  target: PreviewTarget;
}

export interface PreviewPickerProps {
  target: PreviewTarget;
  onPick: (target: PreviewTarget) => void;
  onCancel: () => void;
}

export interface PreviewLayersProps {
  preview: ConfigPreview;
  target: PreviewTarget;
}

export interface PreviewLayerRowProps {
  layer: PreviewLayer;
  /** "Base", "Role: USER", "Group: Design". */
  label: string;
}

export interface PreviewIgnoredListProps {
  ignored: PreviewIgnored[];
}

export interface PreviewConfigProps {
  preview: ConfigPreview;
}
