import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { BUNDLED_WRITE_RULES, DEDICATED_CONFIG_SECTIONS, getConfigSection } from './config';
import { BASE_CONFIG_PRINCIPAL_ID } from './capabilities';

export const SCOPE_TYPE_CONFIG: Record<t.ScopePrincipalType | 'BASE', t.ScopeTypeConfigEntry> = {
  BASE: {
    icon: 'settings',
    color: 'var(--cui-color-accent-success)',
    labelKey: 'com_scope_base_config',
    badgeClass: '',
  },
  [PrincipalType.ROLE]: {
    icon: 'briefcase',
    color: 'var(--cui-color-accent-warning)',
    labelKey: 'com_scope_roles',
    badgeClass: 'badge-role',
  },
  [PrincipalType.GROUP]: {
    icon: 'users',
    color: 'var(--cui-color-accent-info)',
    labelKey: 'com_scope_groups',
    badgeClass: 'badge-group',
  },
  [PrincipalType.USER]: {
    icon: 'user',
    color: 'var(--cui-color-accent-user)',
    labelKey: 'com_scope_users',
    badgeClass: 'badge-user',
  },
};

/** Safe lookup — falls back to BASE config if the type has no scope entry (e.g. PUBLIC). */
export function getScopeTypeConfig(type: PrincipalType | 'BASE'): t.ScopeTypeConfigEntry {
  return SCOPE_TYPE_CONFIG[type as t.ScopePrincipalType | 'BASE'] ?? SCOPE_TYPE_CONFIG.BASE;
}

/**
 * Priority each kind of profile is created with. Higher priority wins, so by
 * default users override groups, groups override roles, and roles override Base.
 */
export const DEFAULT_SCOPE_PRIORITY: Readonly<Record<t.ScopePrincipalType, number>> = {
  [PrincipalType.ROLE]: 10,
  [PrincipalType.GROUP]: 20,
  [PrincipalType.USER]: 100,
};

/** The highest priority the panel sets (the admin API takes any number of 0 or more). */
export const MAX_SCOPE_PRIORITY = 1_000_000;

/** Sections LibreChat reads before sign-in, when no role, group or user profile can apply. */
const PRE_AUTH_SECTIONS: ReadonlySet<string> = new Set(['registration']);

/**
 * Why `path` (or its section) cannot be set per profile, if it can't (WS8):
 * a section read before sign-in, a tenant-wide one, or one read-only
 * everywhere (by the server's write `rules`). In a profile they render as an
 * "Applies to everyone — edit in Base" card and their paths are never sent.
 */
export function getScopeGateReason(
  path: string,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
): t.ScopeGateReason | undefined {
  const section = getConfigSection(path);
  if (PRE_AUTH_SECTIONS.has(section)) return 'preAuth';
  if (DEDICATED_CONFIG_SECTIONS.has(section)) return 'tenantWide';
  return rules.readOnlySections.get(section);
}

/** The admin user search needs at least this many characters. */
export const MIN_USER_SEARCH_LENGTH = 2;

/** A Mongo ObjectId, the shape of the admin API's group, user and audit-entry ids. */
export const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

/** The principal of the Base document: the admin overrides that apply to everyone. */
export const BASE_PRINCIPAL: t.ConfigPrincipal = {
  principalType: PrincipalType.ROLE,
  principalId: BASE_CONFIG_PRINCIPAL_ID,
};

/** The kinds of principal a profile can be for, in the order pickers list them, with their headings. */
export const SCOPE_PRINCIPAL_GROUPS: ReadonlyArray<t.ScopePrincipalGroup> = [
  { type: PrincipalType.ROLE, headingKey: 'com_scope_roles' },
  { type: PrincipalType.GROUP, headingKey: 'com_scope_groups' },
  { type: PrincipalType.USER, headingKey: 'com_scope_users' },
];
