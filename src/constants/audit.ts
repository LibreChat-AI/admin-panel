import type {
  AuditAction,
  AuditActorType,
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
} from '@librechat/data-schemas';
import type * as t from '@/types';
import { OBJECT_ID_PATTERN } from './scope';

/**
 * Client-safe mirrors of the audit enums from `@librechat/data-schemas`.
 *
 * These are defined as local literals rather than imported from the package's
 * main barrel: that barrel pulls Node-only modules (mongoose, winston, …) and
 * must never reach the client bundle (see AGENTS.md). `src/server/capabilities.ts`
 * is reached by browser components via `@/server`, so its zod validators source
 * these arrays here instead of the barrel.
 *
 * The `satisfies` clauses fail `tsc` if a member drifts from the published
 * unions, and `audit.test.ts` fails if the package lists one these don't; the
 * type-only imports above are fully erased at build time so nothing from the
 * barrel reaches the bundle.
 */
export const AUDIT_ACTIONS = [
  'grant.assigned',
  'grant.removed',
  'permission.insights_assigned',
  'permission.insights_removed',
  'role.created',
  'role.updated',
  'role.permissions_updated',
  'role.deleted',
  'role.member_added',
  'role.member_removed',
  'role.synced',
  'group.created',
  'group.updated',
  'group.deleted',
  'group.member_added',
  'group.member_removed',
  'config.created',
  'config.updated',
  'config.deleted',
  'config.toggled',
  'config.reloaded',
  'user.deleted',
  'user.role_changed',
  'acl.granted',
  'acl.revoked',
  'acl.public_changed',
  'mcp_server.created',
  'mcp_server.updated',
  'mcp_server.deleted',
  'code_worker.paired',
  'code_worker.revoked',
  'langfuse.updated',
  'skill_credential.set',
  'skill_credential.deleted',
  'passkey.registered',
  'passkey.removed',
  'audit.read',
  'audit.exported',
  'audit.purged',
] as const satisfies readonly AuditAction[];

/**
 * The actions the audit log tab names (filters, badges, summaries); it shows
 * any other action by its own name.
 */
export const LABELED_AUDIT_ACTIONS = [
  'grant.assigned',
  'grant.removed',
  'permission.insights_assigned',
  'permission.insights_removed',
] as const satisfies readonly t.LabeledAuditAction[];

export const AUDIT_CATEGORIES = [
  'grant',
  'agent_run',
  'tool_call',
  'mcp',
  'config',
  'permission',
  'auth',
  'approval',
  'role',
  'group',
  'user',
  'acl',
  'credential',
  'audit',
] as const satisfies readonly AuditCategory[];

/**
 * The categories LibreChat files the tab's actions under (its
 * `AUDIT_ACTION_CATEGORY`): capability grants under `grant`, Insights
 * permission changes under `permission`. The tab asks for these alone, and
 * LibreChat's query matches a category filter and an action filter both, so
 * an action filter finds nothing outside them.
 */
export const AUDIT_LOG_CATEGORIES = [
  'grant',
  'permission',
] as const satisfies readonly AuditCategory[];

export const AUDIT_OUTCOMES = [
  'success',
  'failure',
  'denied',
  'pending',
] as const satisfies readonly AuditOutcome[];

export const AUDIT_SEVERITIES = [
  'info',
  'warning',
  'critical',
] as const satisfies readonly AuditSeverity[];

export const AUDIT_ACTOR_TYPES = [
  'user',
  'system',
  'agent',
  'service',
  'schedule',
  'webhook',
  'api',
] as const satisfies readonly AuditActorType[];

/**
 * Client guard for the backend's audit-entry id shape (a Mongo ObjectId, as the BFF validator
 * requires), so a crafted `?entryId=` deep link is rejected.
 */
export function isAuditEntryId(id: string | undefined | null): id is string {
  return typeof id === 'string' && OBJECT_ID_PATTERN.test(id);
}
