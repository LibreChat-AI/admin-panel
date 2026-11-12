import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { PrincipalType, SystemRoles, roleDefaults } from 'librechat-data-provider';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';

const parsedPort = parseInt(process.env.MOCK_BACKEND_PORT || '3081', 10);
const PORT = Number.isNaN(parsedPort) ? 3081 : parsedPort;
const ADMIN_PANEL_URL = process.env.MOCK_ADMIN_PANEL_URL || 'http://localhost:3000';

function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('error', () => resolve({}));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
  });
}

// ── Fixtures ─────────────────────────────────────────────────────────
// What LibreChat's admin API would serve, held in memory so writes stick for
// the life of the server. Roles are addressed by name, users and groups by
// ObjectId, and system grants only ever target roles, as in LibreChat.

let lastObjectId = 0;
/** A new 24-hex-digit id: LibreChat refuses user and group ids of any other shape. */
const objectId = () => `6650a1b2c3d4e5f6${String(++lastObjectId).padStart(8, '0')}`;
const isObjectId = (id) => /^[0-9a-f]{24}$/i.test(id);

const SEEDED_AT = Date.parse('2026-01-05T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const users = [
  { name: 'Test Admin', email: 'admin@test.com', role: SystemRoles.ADMIN },
  { name: 'Alice Chen', email: 'alice.chen@example.com', role: SystemRoles.ADMIN },
  { name: 'Bob Martinez', email: 'bob.martinez@example.com', role: SystemRoles.USER },
  { name: 'Carol Nguyen', email: 'carol.nguyen@example.com', role: 'Billing' },
  { name: 'David Kim', email: 'david.kim@example.com', role: SystemRoles.USER },
  { name: 'Erin Walsh', email: 'erin.walsh@example.com', role: 'Support' },
].map((user) => ({ _id: objectId(), username: user.email.split('@')[0], ...user }));

const userNamed = (name) => users.find((user) => user.name === name);

/** The signed-in admin, who every write is attributed to. */
const CALLER = userNamed('Test Admin');

const roles = [
  { name: SystemRoles.ADMIN, permissions: roleDefaults[SystemRoles.ADMIN].permissions },
  { name: SystemRoles.USER },
  { name: 'Auditor', description: 'Reviews the audit log' },
  { name: 'Billing', description: 'Invoices and usage reports' },
  { name: 'Support', description: 'Answers user tickets' },
].map((role) => ({
  _id: objectId(),
  description: '',
  permissions: roleDefaults[SystemRoles.USER].permissions,
  ...role,
}));

const groups = [
  {
    name: 'Engineering',
    description: 'Builds the product',
    members: ['Alice Chen', 'Bob Martinez', 'Carol Nguyen', 'David Kim'],
  },
  { name: 'Marketing', description: 'Campaigns and launches', members: ['Erin Walsh'] },
].map(({ members, ...group }) => ({
  _id: objectId(),
  source: 'local',
  memberIds: members.map((name) => userNamed(name)._id),
  createdAt: new Date(SEEDED_AT).toISOString(),
  updatedAt: new Date(SEEDED_AT).toISOString(),
  ...group,
}));

function grantDoc(roleName, capability, grantedAt = SEEDED_AT) {
  const timestamp = new Date(grantedAt).toISOString();
  return {
    _id: objectId(),
    principalType: PrincipalType.ROLE,
    principalId: roleName,
    capability,
    grantedBy: CALLER._id,
    grantedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const grants = Object.entries({
  [SystemRoles.ADMIN]: Object.values(SystemCapabilities),
  Auditor: [SystemCapabilities.READ_AUDIT_LOG],
  Billing: [SystemCapabilities.READ_USAGE],
  Support: [SystemCapabilities.READ_USERS, SystemCapabilities.READ_GROUPS],
}).flatMap(([roleName, capabilities]) => capabilities.map((cap) => grantDoc(roleName, cap)));

const GENESIS_HASH = '0'.repeat(64);
const auditLog = [];

/** Appends a grant change to the audit log, hash-chained like LibreChat's. */
function recordGrantChange(actor, action, roleName, capability, at = Date.now()) {
  const entry = {
    id: objectId(),
    schemaVersion: 1,
    category: 'grant',
    action,
    outcome: 'success',
    severity: 'warning',
    actor: { type: 'user', id: actor._id, name: actor.name },
    target: { type: PrincipalType.ROLE, id: roleName, name: roleName },
    metadata: { capability },
    timestamp: new Date(at).toISOString(),
  };
  const prevHash = auditLog.at(-1)?.integrity.hash ?? GENESIS_HASH;
  const hash = createHash('sha256').update(prevHash).update(JSON.stringify(entry)).digest('hex');
  auditLog.push({ ...entry, integrity: { seq: auditLog.length + 1, hash, prevHash } });
}

[
  ['Alice Chen', 'grant.assigned', 'Billing', SystemCapabilities.READ_USAGE],
  ['Alice Chen', 'grant.assigned', 'Billing', SystemCapabilities.READ_USERS],
  ['Test Admin', 'grant.removed', 'Billing', SystemCapabilities.READ_USERS],
  ['Test Admin', 'grant.assigned', 'Support', SystemCapabilities.READ_USERS],
  ['Test Admin', 'grant.assigned', 'Support', SystemCapabilities.READ_GROUPS],
  ['Alice Chen', 'grant.assigned', 'Auditor', SystemCapabilities.READ_AUDIT_LOG],
  ['Alice Chen', 'grant.removed', SystemRoles.USER, SystemCapabilities.READ_AGENTS],
].forEach(([actor, action, roleName, capability], i) =>
  recordGrantChange(userNamed(actor), action, roleName, capability, SEEDED_AT + (i + 1) * HOUR),
);

// ── Helpers ──────────────────────────────────────────────────────────

/** LibreChat's `parsePagination`: a limit of 1 to `max` (default 50) and an offset of 0 or more. */
function paginate(items, query, max = 200) {
  const rawLimit = parseInt(query.get('limit') ?? '', 10);
  const rawOffset = parseInt(query.get('offset') ?? '', 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 50 : rawLimit, 1), max);
  const offset = Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0);
  return { page: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

/** Mongo's default order: by UTF-16 code unit, so `ADMIN` sorts before `Auditor`. */
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

const words = (text) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** LibreChat's admin user search: every word of the query starts a word of one of the fields. */
function matchesWords(query, ...fields) {
  const tokens = fields.flatMap((field) => words(field ?? ''));
  return words(query).every((word) => tokens.some((token) => token.startsWith(word)));
}

/** A case-insensitive substring match, as LibreChat's group list and audit-log text filters run. */
function containsText(query, ...fields) {
  const needle = query.toLowerCase();
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

const isSystemRole = (name) => Object.values(SystemRoles).includes(name.toUpperCase());
const findRole = (name) => roles.find((role) => role.name === name);
const findGroup = (id) => groups.find((group) => group._id === id);
const findUser = (id) => users.find((user) => user._id === id);
const findGrant = (roleName, capability) =>
  grants.find((grant) => grant.principalId === roleName && grant.capability === capability);
const toMember = (user) => ({
  userId: user._id,
  name: user.name,
  email: user.email,
  avatarUrl: user.avatar,
});

const ROLE_NOT_FOUND = [404, { error: 'Role not found' }];
const GROUP_NOT_FOUND = [404, { error: 'Group not found' }];
const USER_NOT_FOUND = [404, { error: 'User not found' }];
const INVALID_GROUP_ID = [400, { error: 'Invalid group ID format' }];
const INVALID_USER_ID = [400, { error: 'Invalid user ID format' }];
const INVALID_PRINCIPAL_TYPE = [400, { error: 'Invalid principal type' }];

/** The entry fields each audit-log filter reads: exact filters take any of their values. */
const AUDIT_EXACT_FILTERS = {
  category: (entry) => entry.category,
  action: (entry) => entry.action,
  outcome: (entry) => entry.outcome,
  severity: (entry) => entry.severity,
  actorType: (entry) => entry.actor.type,
  targetType: (entry) => entry.target.type,
};
/** Text filters match a case-insensitive substring of any of their fields. */
const AUDIT_TEXT_FILTERS = {
  actorQuery: (entry) => [entry.actor.name],
  targetQuery: (entry) => [entry.target.name],
  capability: (entry) => [entry.metadata?.capability],
  search: (entry) => [
    entry.actor.name,
    entry.target.name,
    entry.action,
    entry.metadata?.capability,
  ],
};

/** LibreChat's CSV guards: a leading formula character is quoted out, and Excel reads the BOM. */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;
const CSV_BOM = '\uFEFF';

/** A CSV cell as LibreChat's `escapeCsvCell` writes it. */
function csvCell(value) {
  if (value === '') return '';
  const guarded = CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** A metadata value as LibreChat's `stringifyMetaValue` writes it: objects are left blank. */
const metaCell = (value) =>
  ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';

/** LibreChat's audit-log export columns, in order: `CSV_COLUMNS` in its admin `auditLog.ts`. */
const AUDIT_CSV_COLUMNS = [
  ['Timestamp', (entry) => entry.timestamp],
  ['Category', (entry) => entry.category],
  ['Action', (entry) => entry.action],
  ['Outcome', (entry) => entry.outcome],
  ['Severity', (entry) => entry.severity],
  ['Actor type', (entry) => entry.actor.type],
  ['Actor', (entry) => entry.actor.name],
  ['Actor ID', (entry) => entry.actor.id ?? ''],
  ['Target type', (entry) => entry.target.type],
  ['Target', (entry) => entry.target.name ?? ''],
  ['Target ID', (entry) => entry.target.id ?? ''],
  ['Capability', (entry) => metaCell(entry.metadata?.capability)],
  ['Details', (entry) => (entry.metadata ? JSON.stringify(entry.metadata) : '')],
  ['IP', (entry) => entry.context?.ip ?? ''],
  ['Request ID', (entry) => entry.context?.requestId ?? ''],
  ['Seq', (entry) => String(entry.integrity.seq)],
  ['Hash', (entry) => entry.integrity.hash],
];

const csvLine = (cells) => `${cells.map(csvCell).join(',')}\r\n`;

/** The audit-log query's filter: an entry matches when every filter given matches it. */
function auditFilter(query) {
  const checks = [
    ...Object.entries(AUDIT_EXACT_FILTERS)
      .filter(([key]) => query.has(key))
      .map(([key, field]) => {
        const values = query.getAll(key);
        return (entry) => values.includes(field(entry));
      }),
    ...Object.entries(AUDIT_TEXT_FILTERS)
      .filter(([key]) => query.get(key)?.trim())
      .map(([key, fields]) => {
        const needle = query.get(key).trim();
        return (entry) => containsText(needle, ...fields(entry));
      }),
  ];
  const from = query.get('from');
  const to = query.get('to');
  if (from) checks.push((entry) => Date.parse(entry.timestamp) >= Date.parse(from));
  if (to) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to;
    checks.push((entry) => Date.parse(entry.timestamp) <= Date.parse(end));
  }
  return (entry) => checks.every((check) => check(entry));
}

const VALID_TEMP_TOKEN = 'valid-2fa-temp-token-for-testing';

/** The PKCE challenge each one-time exchange code was issued for, as LibreChat binds them. */
const exchangeChallenges = new Map();

/**
 * LibreChat's admin OAuth start route, with the identity provider signing the
 * admin in at once: back to the panel's callback with a one-time code.
 */
function startAdminOAuth(provider) {
  return (_body, req) => {
    const challenge = new URL(req.url, 'http://mock').searchParams.get('code_challenge');
    const code = randomBytes(32).toString('hex');
    exchangeChallenges.set(code, challenge);
    return [302, {}, { Location: `${ADMIN_PANEL_URL}/auth/${provider}/callback?code=${code}` }];
  };
}

const FEDERATED_LOGIN_BLOCKED = [
  403,
  {
    code: 'TWO_FACTOR_FEDERATED_LOGIN_BLOCKED',
    message: 'Sign in with your identity provider to continue.',
  },
];

const ADMIN_TOKENS = new Set(['test-admin-token', 'test-admin-token-2fa']);

/** The refusal LibreChat answers a request without a valid admin token with, or `null`. */
function authFailure(req) {
  const auth = req?.headers?.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return [401, { error: 'Authentication required' }];
  if (!ADMIN_TOKENS.has(auth.slice('Bearer '.length)))
    return [401, { error: 'Invalid or expired token' }];
  return null;
}

/** An admin API route: refused with LibreChat's 401 unless the request carries an admin token. */
const admin =
  (handler) =>
  (...args) =>
    authFailure(args[1]) ?? handler(...args);

// ── Routes ───────────────────────────────────────────────────────────
// Keyed `METHOD /path`. A `:param` segment matches any one segment and the
// first match in declaration order wins, so literal paths come before
// parameterized ones. Handlers take (body, req, params, query) and return
// [status, body, headers?]: a text body is sent as is with those headers,
// anything else as JSON with them (a redirect's Location, for example).

const handlers = {
  'POST /api/admin/login/local': (body, req) => {
    if (body.email === 'rejected@test.com') return [404, { message: 'Incorrect password.' }];
    if (body.email === 'unverified@test.com') return [422, { message: 'Email not verified.' }];
    if (body.email === 'member@test.com') return [403, { message: 'Forbidden', code: 'FORBIDDEN' }];
    if (body.email === 'federated@test.com') return FEDERATED_LOGIN_BLOCKED;
    if (body.email === 'tenant@test.com' && req.headers['x-tenant-id'] !== 'tenant-a')
      return [
        403,
        {
          message: 'Tenant context required in strict isolation mode',
          code: 'TENANT_CONTEXT_REQUIRED',
        },
      ];
    if (body.email === '2fa@test.com')
      return [200, { twoFAPending: true, tempToken: VALID_TEMP_TOKEN }];
    return [
      200,
      {
        token: 'test-admin-token',
        user: {
          id: 'u_test',
          email: body.email,
          name: 'Test Admin',
          role: 'ADMIN',
        },
      },
    ];
  },
  'POST /api/auth/2fa/verify-temp': (body) => {
    if (body.tempToken !== VALID_TEMP_TOKEN)
      return [401, { message: 'Invalid or expired temporary token' }];
    if (body.token === '000000') return [401, { message: 'Invalid 2FA code or backup code' }];
    if (body.token === '111111') return FEDERATED_LOGIN_BLOCKED;
    return [
      200,
      {
        token: 'test-admin-token-2fa',
        user: {
          id: 'u_2fa',
          email: '2fa@test.com',
          name: '2FA Admin',
          role: 'ADMIN',
        },
      },
    ];
  },
  'GET /api/admin/verify': admin(() => [
    200,
    {
      user: {
        id: 'u_test',
        email: 'admin@test.com',
        name: 'Test Admin',
        role: 'ADMIN',
      },
    },
  ]),
  'GET /api/admin/oauth/openid/check': () => [200, { message: 'OpenID check successful' }],

  'GET /api/admin/roles': admin((_body, _req, _params, query) => {
    const { page, ...rest } = paginate([...roles].sort(byName), query);
    const listed = page.map(({ _id, name, description }) => ({ _id, name, description }));
    return [200, { roles: listed, ...rest }];
  }),
  'POST /api/admin/roles': admin((body) => {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return [400, { error: 'name is required' }];
    if (isSystemRole(name))
      return [409, { error: `Cannot create role with reserved system name: ${name}` }];
    if (findRole(name)) return [409, { error: `Role "${name}" already exists` }];
    const role = {
      _id: objectId(),
      name,
      description: body.description ?? '',
      permissions: body.permissions ?? {},
    };
    roles.push(role);
    return [201, { role }];
  }),
  'GET /api/admin/roles/:name': admin((_body, _req, { name }) => {
    const role = findRole(name);
    return role ? [200, { role }] : ROLE_NOT_FOUND;
  }),
  'PATCH /api/admin/roles/:name': admin((body, _req, { name }) => {
    const newName = typeof body.name === 'string' ? body.name.trim() : '';
    const isRename = newName !== '' && newName !== name;
    if (isRename && isSystemRole(name)) return [403, { error: 'Cannot rename system role' }];
    if (isRename && isSystemRole(newName))
      return [403, { error: 'Cannot use a reserved system role name' }];
    const role = findRole(name);
    if (!role) return ROLE_NOT_FOUND;
    if (isRename && findRole(newName)) return [409, { error: `Role "${newName}" already exists` }];
    if (body.description !== undefined) role.description = body.description;
    if (!isRename) return [200, { role }];
    /**
     * LibreChat's `renameRole` moves the role's users and renames the role, and
     * nothing else: its grants stay keyed by the old name, so the renamed role
     * holds none and a role later created under the old name gets them back.
     */
    role.name = newName;
    users.filter((user) => user.role === name).forEach((user) => (user.role = newName));
    return [200, { role }];
  }),
  'DELETE /api/admin/roles/:name': admin((_body, _req, { name }) => {
    if (isSystemRole(name)) return [403, { error: 'Cannot delete system role' }];
    const role = findRole(name);
    if (!role) return ROLE_NOT_FOUND;
    roles.splice(roles.indexOf(role), 1);
    users.filter((user) => user.role === name).forEach((user) => (user.role = SystemRoles.USER));
    for (const grant of grants.filter((g) => g.principalId === name)) {
      grants.splice(grants.indexOf(grant), 1);
      recordGrantChange(CALLER, 'grant.removed', name, grant.capability);
    }
    return [200, { success: true }];
  }),
  'PATCH /api/admin/roles/:name/permissions': admin((body, _req, { name }) => {
    const { permissions } = body;
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions))
      return [400, { error: 'permissions object is required' }];
    const role = findRole(name);
    if (!role) return ROLE_NOT_FOUND;
    const merged = Object.entries(permissions).map(([type, bits]) => [
      type,
      { ...role.permissions[type], ...bits },
    ]);
    role.permissions = { ...role.permissions, ...Object.fromEntries(merged) };
    return [200, { role }];
  }),
  'GET /api/admin/roles/:name/members': admin((_body, _req, { name }, query) => {
    if (!findRole(name)) return ROLE_NOT_FOUND;
    const holders = users.filter((user) => user.role === name);
    const { page, ...rest } = paginate(holders, query);
    return [200, { members: page.map(toMember), ...rest }];
  }),
  'POST /api/admin/roles/:name/members': admin((body, _req, { name }) => {
    if (!isObjectId(body.userId ?? '')) return INVALID_USER_ID;
    if (isSystemRole(name))
      return [403, { error: 'Cannot directly assign members to a system role' }];
    if (!findRole(name)) return ROLE_NOT_FOUND;
    const user = findUser(body.userId);
    if (!user) return USER_NOT_FOUND;
    user.role = name;
    return [200, { success: true }];
  }),
  'DELETE /api/admin/roles/:name/members/:userId': admin((_body, _req, { name, userId }) => {
    if (!isObjectId(userId)) return INVALID_USER_ID;
    if (isSystemRole(name)) return [403, { error: 'Cannot remove members from a system role' }];
    if (!findRole(name)) return ROLE_NOT_FOUND;
    const user = findUser(userId);
    if (!user) return USER_NOT_FOUND;
    if (user.role !== name) return [400, { error: 'User is not a member of this role' }];
    user.role = SystemRoles.USER;
    return [200, { success: true }];
  }),

  'GET /api/admin/groups': admin((_body, _req, _params, query) => {
    const search = query.get('search') ?? '';
    if (search.length > 200) return [400, { error: 'search must not exceed 200 characters' }];
    const found = groups.filter(
      (group) => !search || containsText(search, group.name, group.email, group.description),
    );
    const { page, ...rest } = paginate(found.sort(byName), query);
    return [200, { groups: page, ...rest }];
  }),
  'POST /api/admin/groups': admin((body) => {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return [400, { error: 'name is required' }];
    const now = new Date().toISOString();
    const group = {
      _id: objectId(),
      name,
      description: body.description,
      source: body.source || 'local',
      memberIds: Array.isArray(body.memberIds) ? body.memberIds : [],
      createdAt: now,
      updatedAt: now,
    };
    groups.push(group);
    return [201, { group }];
  }),
  'PATCH /api/admin/groups/:id': admin((body, _req, { id }) => {
    if (!isObjectId(id)) return INVALID_GROUP_ID;
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim()))
      return [400, { error: 'name must be a non-empty string' }];
    const group = findGroup(id);
    if (!group) return GROUP_NOT_FOUND;
    if (body.name !== undefined) group.name = body.name.trim();
    if (body.description !== undefined) group.description = body.description;
    group.updatedAt = new Date().toISOString();
    return [200, { group }];
  }),
  'DELETE /api/admin/groups/:id': admin((_body, _req, { id }) => {
    if (!isObjectId(id)) return INVALID_GROUP_ID;
    const group = findGroup(id);
    if (!group) return GROUP_NOT_FOUND;
    groups.splice(groups.indexOf(group), 1);
    return [200, { success: true, id }];
  }),
  'GET /api/admin/groups/:id/members': admin((_body, _req, { id }, query) => {
    if (!isObjectId(id)) return INVALID_GROUP_ID;
    const group = findGroup(id);
    if (!group) return GROUP_NOT_FOUND;
    const { page, ...rest } = paginate([...new Set(group.memberIds)], query);
    const members = page.map((memberId) =>
      toMember(findUser(memberId) ?? { _id: memberId, name: memberId, email: '' }),
    );
    return [200, { members, ...rest }];
  }),
  'POST /api/admin/groups/:id/members': admin((body, _req, { id }) => {
    if (!isObjectId(id)) return INVALID_GROUP_ID;
    if (!isObjectId(body.userId ?? ''))
      return [400, { error: 'Only native user ObjectIds can be added via this endpoint' }];
    const group = findGroup(id);
    if (!group) return GROUP_NOT_FOUND;
    if (!findUser(body.userId)) return USER_NOT_FOUND;
    if (!group.memberIds.includes(body.userId)) group.memberIds.push(body.userId);
    return [200, { group }];
  }),
  'DELETE /api/admin/groups/:id/members/:userId': admin((_body, _req, { id, userId }) => {
    if (!isObjectId(id)) return INVALID_GROUP_ID;
    const group = findGroup(id);
    if (!group) return GROUP_NOT_FOUND;
    group.memberIds = group.memberIds.filter((memberId) => memberId !== userId);
    return [200, { success: true }];
  }),

  'GET /api/admin/users/search': admin((_body, _req, _params, query) => {
    const q = query.get('q')?.trim() ?? '';
    if (!q) return [400, { error: 'Query parameter "q" is required' }];
    if (q.length < 2) return [400, { error: 'Query must be at least 2 characters' }];
    const found = users
      .filter((user) => matchesWords(q, user.name, user.email, user.username))
      .sort(byName)
      .slice(0, 20)
      .map(({ _id, name, email, username, avatar }) => ({
        id: _id,
        name,
        email,
        username,
        avatarUrl: avatar,
      }));
    return [200, { users: found, total: found.length, capped: found.length >= 20 }];
  }),

  'GET /api/admin/grants': admin((_body, _req, _params, query) => {
    const { page, ...rest } = paginate(grants, query);
    return [200, { grants: page, ...rest }];
  }),
  'GET /api/admin/grants/effective': admin(() => [
    200,
    { capabilities: Object.values(SystemCapabilities) },
  ]),
  'GET /api/admin/grants/:principalType/:principalId': admin(
    (_body, _req, { principalType, principalId }) => {
      if (principalType !== PrincipalType.ROLE) return INVALID_PRINCIPAL_TYPE;
      return [200, { grants: grants.filter((grant) => grant.principalId === principalId) }];
    },
  ),
  'POST /api/admin/grants': admin((body) => {
    const { principalType, principalId, capability } = body;
    if (principalType !== PrincipalType.ROLE) return INVALID_PRINCIPAL_TYPE;
    if (!Object.values(SystemCapabilities).includes(capability))
      return [400, { error: 'Invalid capability' }];
    if (!findRole(principalId)) return [400, { error: 'Role not found' }];
    const grant =
      findGrant(principalId, capability) ?? grantDoc(principalId, capability, Date.now());
    if (!grants.includes(grant)) grants.push(grant);
    recordGrantChange(CALLER, 'grant.assigned', principalId, capability);
    return [201, { grant }];
  }),
  'DELETE /api/admin/grants/:principalType/:principalId/:capability': admin(
    (_body, _req, { principalType, principalId, capability }) => {
      if (principalType !== PrincipalType.ROLE) return INVALID_PRINCIPAL_TYPE;
      const grant = findGrant(principalId, capability);
      if (!grant) return [200, { success: true }];
      grants.splice(grants.indexOf(grant), 1);
      recordGrantChange(CALLER, 'grant.removed', principalId, capability);
      return [200, { success: true }];
    },
  ),

  'GET /api/admin/audit-log': admin((_body, _req, _params, query) => {
    const newestFirst = auditLog.filter(auditFilter(query)).reverse();
    const { page, total, offset } = paginate(newestFirst, query, 500);
    const nextCursor = offset + page.length < total ? page.at(-1).integrity.seq : null;
    return [200, { entries: page, total, nextCursor }];
  }),
  'GET /api/admin/audit-log/export.csv': admin((_body, _req, _params, query) => {
    const rows = auditLog
      .filter(auditFilter(query))
      .reverse()
      .map((entry) => csvLine(AUDIT_CSV_COLUMNS.map(([, cell]) => cell(entry))));
    const header = csvLine(AUDIT_CSV_COLUMNS.map(([label]) => label));
    const stamp = new Date().toISOString().slice(0, 10);
    return [
      200,
      [CSV_BOM, header, ...rows].join(''),
      {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    ];
  }),
  'GET /api/admin/audit-log/:id': admin((_body, _req, { id }) => {
    if (!isObjectId(id)) return [400, { error: 'Invalid id' }];
    const entry = auditLog.find((candidate) => candidate.id === id);
    return entry ? [200, { entry }] : [404, { error: 'Not found' }];
  }),
  'GET /api/config': () => [
    200,
    {
      socialLoginEnabled: true,
      socialLogins: ['google', 'openid', 'saml'],
      googleLoginEnabled: true,
      openidLoginEnabled: true,
      openidLabel: 'Continue with OpenID',
      samlLoginEnabled: false,
    },
  ],
  'GET /api/admin/oauth/openid': startAdminOAuth('openid'),
  'GET /api/admin/oauth/google': startAdminOAuth('google'),
  'POST /api/admin/oauth/exchange': (body) => {
    const challenge = exchangeChallenges.get(body.code);
    exchangeChallenges.delete(body.code);
    const verified =
      typeof challenge === 'string' &&
      typeof body.code_verifier === 'string' &&
      createHash('sha256').update(body.code_verifier).digest('hex') === challenge;
    if (!verified)
      return [
        401,
        { error: 'Invalid or expired authorization code', error_code: 'INVALID_OR_EXPIRED_CODE' },
      ];
    return [
      200,
      {
        token: 'test-admin-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 15 * 60 * 1000,
        user: { id: 'u_test', email: 'admin@test.com', name: 'Test Admin', role: 'ADMIN' },
      },
    ];
  },
};

/** A percent-decoded path segment, or `null` when it is malformed. */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The handler declared for a request, with its decoded `:param` values, or `null`. */
function route(method, path) {
  const segments = path.split('/');
  for (const [key, handler] of Object.entries(handlers)) {
    const [routeMethod, pattern] = key.split(' ');
    const parts = pattern.split('/');
    if (routeMethod !== method || parts.length !== segments.length) continue;
    const params = {};
    const matches = parts.every((part, i) => {
      if (!part.startsWith(':')) return part === segments[i];
      const value = decodeSegment(segments[i]);
      params[part.slice(1)] = value;
      return value !== null;
    });
    if (matches) return { handler, params };
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const matched = route(req.method, url.pathname);

  let status = 404;
  let body = { error: 'not found' };
  let headers = {};

  if (matched) {
    const reqBody = req.method === 'GET' ? {} : await parseBody(req);
    [status, body, headers = {}] = matched.handler(reqBody, req, matched.params, url.searchParams);
  }

  if (typeof body === 'string') {
    res.writeHead(status, headers);
    res.end(body);
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
});

server.listen(PORT, () => {
  console.log(`Mock backend listening on http://localhost:${PORT}`);
});
