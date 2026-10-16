import type { WriteTarget } from './config-ui';
import type { RevertTarget } from './values';
import type { ConfigValue } from './config';

/** One write operation of the save pipeline (WS1). */
export type ConfigChange =
  | { op: 'set'; path: string; value: ConfigValue }
  /** Removes the target's own override. */
  | { op: 'reset'; path: string }
  /** Hides (or unhides) a lower-layer value in the target. */
  | { op: 'tombstone' | 'untombstone'; path: string }
  /** Creates or updates a keyed collection entry; `identity` is null for a new entry. */
  | {
      op: 'upsertEntry';
      path: string;
      key: string;
      identity: string | null;
      value: ConfigValue;
    }
  | { op: 'removeEntry'; path: string; key: string; identity: string };

/** A validation or apply problem reported for a path (WS1). */
export interface ConfigIssue {
  path: string;
  code?: string;
  message: string;
}

/** Input of `applyConfigChangesFn` (WS1). */
export interface ApplyConfigChangesRequest {
  target: WriteTarget;
  ops: ConfigChange[];
  expectedVersion?: number;
}

/** Warning attached to a change in the review (WS1 produces, WS7 renders). */
export type ChangeWarning =
  | 'ownershipChange'
  | 'emptyAllowlist'
  | 'yamlOnly'
  | 'baseOnly'
  | 'unsafeKey';

/** Result of `applyConfigChangesFn` (WS1). */
export interface ApplyConfigChangesResult {
  applied: number;
  failed: ConfigIssue[];
  warnings: Array<{ path: string; warning: ChangeWarning }>;
  issues: ConfigIssue[];
}

/** How a change reads in the review (WS1). */
export type ChangeKind = 'added' | 'changed' | 'reverted' | 'removed' | 'hidden' | 'renamed';

/** One human-readable row of the change review (WS1 produces, WS7 renders). */
export interface ChangeSummaryItem {
  path: string;
  /** Identity (e.g. name) of the collection entry the change belongs to. */
  entryIdentity?: string;
  kind: ChangeKind;
  before: ConfigValue;
  after: ConfigValue;
  revertTarget?: RevertTarget;
  secret?: boolean;
  warnings?: ChangeWarning[];
}
