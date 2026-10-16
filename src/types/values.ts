import type { ReactNode } from 'react';
import type { ConfigValue, FlatConfigMap } from './config';

/** Where a field's value comes from (WS4). */
export type ProvenanceSource =
  | 'default'
  | 'runtimeDefault'
  | 'yaml'
  | 'admin'
  | 'scope'
  | 'inherited';

/** The value a field returns to when its own override is removed, and that value's layer (WS4). */
export interface RevertTarget {
  value: ConfigValue;
  source: ProvenanceSource;
}

/** Everything a field row needs to render its value and state (WS4; `error` from WS1). */
export interface FieldState {
  /** Shown in the control: pending edit ?? own value ?? effective value. */
  value: ConfigValue;
  /** The value in effect, ignoring pending edits. */
  effective: ConfigValue;
  source: ProvenanceSource;
  revertTarget?: RevertTarget;
  isConfigured: boolean;
  /** The edit target (base or the open profile) holds its own override. */
  isOverride: boolean;
  /** A change (including a reset) is pending for this path. */
  isEdited: boolean;
  isPendingReset: boolean;
  /** Tombstoned: hidden in the open profile. */
  isHidden: boolean;
  /** Another path whose value takes precedence (e.g. `endpoints.all`). */
  shadowedBy?: { path: string; value: ConfigValue };
  error?: string;
}

/** The page's value layers that `useFieldState` derives a `FieldState` from (WS4). */
export interface ConfigValuesData {
  /** The config tree shown on the page (pending indexed-array edits overlaid). */
  configValues: Record<string, ConfigValue> | null;
  editedValues: FlatConfigMap;
  /** The open profile's own overrides, flattened (null in base mode). */
  resolvedValues?: FlatConfigMap | null;
  schemaDefaults?: FlatConfigMap;
  configuredPaths?: Set<string>;
  /** Paths the edit target holds its own override for. */
  overridePaths?: Set<string>;
  pendingResets?: Set<string>;
  isEditingScope?: boolean;
}

/** Props of `ConfigValuesProvider` (WS4). */
export interface ConfigValuesProviderProps {
  /** Memoize it: every `useFieldState` consumer re-renders when it changes. */
  value: ConfigValuesData;
  children: ReactNode;
}
