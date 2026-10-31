import type { AdminAuditLogEntry, AuditAction } from '@librechat/data-schemas';
import type { PrincipalType, ResourceType } from 'librechat-data-provider';
import type { Ref } from 'react';
import type { IconName } from './scope';

/**
 * An audit entry as the panel parses it: its `action` and `category` may be
 * ones a newer LibreChat adds, so they are any text.
 */
export interface AuditLogEntryWithDiff extends Omit<AdminAuditLogEntry, 'action' | 'category'> {
  action: string;
  category: string;
  before?: readonly string[];
  after?: readonly string[];
}

/** Audit actions the audit log tab names (`LABELED_AUDIT_ACTIONS`): capability grants and Insights. */
export type LabeledAuditAction = Extract<
  AuditAction,
  | 'grant.assigned'
  | 'grant.removed'
  | 'permission.insights_assigned'
  | 'permission.insights_removed'
>;

/** How an audit action's badge reads: granted, revoked, or (an action the tab doesn't name) neutral. */
export type AuditBadgeState = 'success' | 'danger' | 'neutral';

/** `target.type` values the audit log can filter on: principals for grants, agents for Insights. */
export type AuditTargetType =
  PrincipalType.USER | PrincipalType.GROUP | PrincipalType.ROLE | ResourceType.AGENT;

/** How an audit entry's target type reads on its badge: an icon and a name. */
export interface AuditTargetBadge {
  icon: IconName;
  label: string;
}

/** What an audit entry changed: a system capability, or an agent-level permission. */
export interface AuditSubject {
  label: string;
  value: string;
}

/** Principal whose agent-level permission an `permission.*` audit entry changed. */
export interface AuditGrantee {
  type: string;
  id: string;
}

export interface PrincipalRow {
  principalType: PrincipalType;
  principalId: string;
  name: string;
  grantCount: number;
  isActive: boolean;
}

export interface CapabilityPanelProps {
  capabilities: Record<string, boolean>;
  onChange: (capabilities: Record<string, boolean>) => void;
  disabled?: boolean;
}

export interface EditCapabilitiesDialogProps {
  principalType: PrincipalType | null;
  principalId: string | null;
  principalName: string;
  onClose: () => void;
}

export interface GrantsPageProps {
  activeTab: 'management' | 'audit-log';
  onTabChange: (tab: string) => void;
}

export interface GrantTableRowProps {
  row: PrincipalRow;
  isLast: boolean;
  /** Opens the row's Edit capabilities dialog. */
  onOpen: () => void;
  /** The row's button, which takes focus back when the dialog closes. */
  buttonRef: Ref<HTMLButtonElement>;
}

export interface AuditLogTableRowProps {
  entry: AuditLogEntryWithDiff;
  isLast: boolean;
  /** Opens the entry's detail drawer. */
  onOpen: () => void;
  /** The row's button, which takes focus when a drawer opened from a permalink closes. */
  buttonRef?: Ref<HTMLButtonElement>;
}

export interface DateFilterProps {
  /** The id of the picker's trigger button, which the label names. */
  id: string;
  label: string;
  date?: Date;
  /** Changes when the filters are cleared, so the picker remounts without its own selection. */
  resetKey: number;
  onSelectDate: (date: Date) => void;
}

export interface AuditLogDetailDrawerProps {
  entry: AuditLogEntryWithDiff | null;
  open: boolean;
  onClose: () => void;
  /** Resolves to `true` when the clipboard write succeeded so the drawer only
   * flips to its "Copied!" affordance after a real success. */
  onCopyPermalink: (entryId: string) => Promise<boolean>;
  /** Invoked with the copied field's name ("actor ID") after an inline copy
   * succeeded, so the caller can announce it. */
  onCopied?: (field: string) => void;
  /** Invoked when any inline `CopyableMono` (timestamp, actor/target/entry IDs,
   * capability) fails to write to the clipboard. The caller is responsible for
   * surfacing the failure — typically via the same screen-reader announcement
   * used for the permalink-copy failure path so the drawer's copy controls are
   * not silent on clipboard error. */
  onCopyFailed?: () => void;
  /** Render a "no entry found" message instead of the detail body when the
   * deep-linked id couldn't be located (e.g. the entry was purged). */
  notFound?: boolean;
  /** Render a loading shell while the single-entry deep-link query is in flight
   * for an entry that is not on the current page. Without this, the drawer
   * would either flicker shut during the fetch or never appear on cold load. */
  loading?: boolean;
  /** Render a load-error message + close affordance when the single-entry
   * fetch failed for reasons other than not-found (network failure, 5xx). The
   * caller is responsible for distinguishing this from `notFound` (which is
   * the 404 case where the request itself succeeded but the entry is gone). */
  loadError?: boolean;
  /** Where focus goes on close when nothing on the page opened the drawer
   * (it opened from a permalink). */
  returnFocusTo?: () => HTMLElement | null;
}

/** A value in the audit log drawer that copies itself when pressed. */
export interface CopyableMonoProps {
  value: string;
  /** What the value is, in a sentence ("actor ID"). */
  field: string;
  onCopied?: (field: string) => void;
  onCopyFailed?: () => void;
}
