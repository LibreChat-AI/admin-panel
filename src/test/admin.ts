import type * as t from '@/types';
import {
  isKeyedEntry,
  isConfigRecord,
  getValueAtPath,
  parseKeyedPath,
  setValueAtPath,
  validateSection,
  isPathAtOrUnder,
  mergeConfigLayers,
  removeValueAtPath,
  getKeyedCollection,
  removeConfigPathValue,
} from '@/utils';
import { getConfigSection } from '@/constants';

/** One request the fake admin API received. */
export interface FakeAdminRequest {
  method: string;
  path: string;
  body?: {
    entries?: t.SaveEntry[];
    fieldPath?: string;
    priority?: number;
    ops?: t.ConfigBatchOp[];
    expectedRevision?: string;
    renames?: t.RenameHint[];
  };
}

interface FakeDoc {
  overrides: t.ConfigRecord;
  tombstones: string[];
  /** Bumped by every write, as `configVersion` is. */
  version: number;
}

/** What a write's reply adds to the stored document (a write report, ignored credentials). */
export type FakeWriteReport = (request: FakeAdminRequest) => Partial<t.PatchFieldsResponse>;

/** Replies the test wants instead of the default behaviour (return undefined to fall through). */
export type FakeAdminOverride = (
  request: FakeAdminRequest,
) => { status: number; body: unknown } | undefined;

/** Secrets by the key that holds them: anywhere (`apiKey`), or under one parent (an MCP server's `apiKey.key`). */
const SECRET_KEYS: ReadonlyMap<string, string | null> = new Map([
  ['apiKey', null],
  ['key', 'apiKey'],
  ['client_secret', 'oauth'],
]);

function isSecretAt(key: string, parent: string | undefined): boolean {
  if (!SECRET_KEYS.has(key)) return false;
  const required = SECRET_KEYS.get(key);
  return required == null || required === parent;
}

const BASE_KEY = 'role/__base__';

function issueKey(issue: t.ConfigIssue): string {
  return `${issue.path}|${issue.code ?? ''}`;
}

/** Whether `path` is `ancestor` or lies inside it, an entry key step included (`endpoints.custom["A"]`). */
function isAtOrUnder(path: string, ancestor: string): boolean {
  return isPathAtOrUnder(path, ancestor);
}

/**
 * Whether a write of `value` at `path` clears `tombstone`, as LibreChat's
 * writes do: one at the path or above it below the section, so a
 * whole-section tombstone survives a nested write; and the hide of a whole
 * entry (`endpoints.custom["A"]`) the write holds (`keyedTombstones`).
 */
function clearsTombstone(path: string, tombstone: string, value?: t.ConfigValue): boolean {
  const keyed = parseKeyedPath(tombstone);
  if (keyed) {
    if (keyed.rest || !isAtOrUnder(keyed.collection.path, path)) return false;
    const list =
      path === keyed.collection.path
        ? value
        : getValueAtPath(value, keyed.collection.path.slice(path.length + 1));
    return Array.isArray(list) && list.some((entry) => isKeyedEntry(keyed, entry));
  }
  return tombstone === path || (tombstone.includes('.') && isAtOrUnder(path, tombstone));
}

/** Overrides without what a tombstone or an unset removes; by key, an own entry left bare goes too. */
function removeAt(overrides: t.ConfigRecord, path: string): t.ConfigRecord {
  return removeConfigPathValue(overrides, path, true);
}

/**
 * The written list with each entry a `renames` hint renames given the key
 * the stored entry it comes from holds (`renameHints`), and the keyed
 * tombstones of the old name moved to the new one.
 */
function carryEntryRenames(
  stored: t.ConfigRecord,
  overrides: t.ConfigRecord,
  tombstones: string[],
  renames: readonly t.RenameHint[],
): { overrides: t.ConfigRecord; tombstones: string[] } {
  let next = overrides;
  let moved = tombstones;
  for (const { path, previousName, name } of renames) {
    const collection = getKeyedCollection(path);
    if (!collection) continue;
    const source = (getValueAtPath(stored, path) as t.ConfigValue[] | undefined)?.find(
      (entry) => isConfigRecord(entry) && entry.name === previousName,
    );
    const list = getValueAtPath(next, path);
    if (!Array.isArray(list)) continue;
    next = setValueAtPath(
      next,
      path,
      list.map((entry) =>
        isConfigRecord(entry) && entry.name === name ? carrySecrets(source, entry) : entry,
      ),
    );
    const from = `${path}[${JSON.stringify(previousName)}]`;
    moved = moved.map((tombstone) =>
      isAtOrUnder(tombstone, from)
        ? `${path}[${JSON.stringify(name)}]${tombstone.slice(from.length)}`
        : tombstone,
    );
  }
  return { overrides: next, tombstones: moved };
}

/** Removes `path` and every object that leaves empty above it, stopping at arrays (`prunesEmptyParents`). */
function removePruned(overrides: t.ConfigRecord, path: string): t.ConfigRecord {
  let result = removeValueAtPath(overrides, path);
  for (let dot = path.lastIndexOf('.'); dot > 0; dot = path.lastIndexOf('.', dot - 1)) {
    const parent = path.slice(0, dot);
    const value = getValueAtPath(result, parent);
    if (!isConfigRecord(value) || Object.keys(value).length > 0) break;
    result = removeValueAtPath(result, parent);
  }
  return result;
}

/** Secret values stored as plain references (`${ENV}`, `user_provided`). */
function isPassthrough(value: string): boolean {
  return value.startsWith('${') || value === 'user_provided';
}

/** The admin API's read redaction, reduced to the panel-relevant part: encrypted secrets are replaced by their preview. */
function redact(value: t.ConfigValue, parent?: string): t.ConfigValue {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!isConfigRecord(value)) return value;
  const result: t.ConfigRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSecretAt(key, parent) && typeof child === 'string' && child.startsWith('enc:')) {
      result[`${key}Preview`] = `${child.slice(4, 7)}...`;
      continue;
    }
    result[key] = redact(child, key);
  }
  return result;
}

/** `target` with each secret `source` stores and `target` omits copied in (a `renames` hint, a rename). */
function carrySecrets(
  source: t.ConfigValue,
  target: t.ConfigValue,
  parent?: string,
): t.ConfigValue {
  if (!isConfigRecord(source) || !isConfigRecord(target)) return target;
  const result: t.ConfigRecord = { ...target };
  for (const [key, child] of Object.entries(source)) {
    if (isSecretAt(key, parent) && typeof child === 'string') {
      if (!(key in result)) result[key] = child;
    } else if (isConfigRecord(child) && isConfigRecord(result[key])) {
      result[key] = carrySecrets(child, result[key], key);
    }
  }
  return result;
}

/**
 * An in-memory LibreChat admin config API: per-principal override documents
 * with Mongo `$set`/`$unset` field semantics, tombstones, the merged base
 * (`/base`) and librechat.yaml alone (`/base?baseOnly=true`), plus a request
 * log and per-request overrides for injecting failures.
 */
export function createFakeAdminApi(yaml: t.ConfigRecord) {
  const docs = new Map<string, FakeDoc>();
  const requests: FakeAdminRequest[] = [];
  const strippedSections = new Set<string>();
  let override: FakeAdminOverride | undefined;
  let report: FakeWriteReport | undefined;
  let meta: t.AdminConfigMetaBody | undefined;
  let judging = false;

  const docKey = (principalType: string, principalId: string) =>
    `${principalType}/${decodeURIComponent(principalId)}`;

  /** Revisions are reported only by a server whose contract says so (`expectedRevision`). */
  const reportsRevisions = () => meta?.features?.expectedRevision === true;
  const revisionOf = (key: string, doc: FakeDoc | undefined) =>
    doc ? `${key.replace('/', '-')}:${doc.version}` : null;
  const store = (key: string, next: Omit<FakeDoc, 'version'>) =>
    docs.set(key, { ...next, version: (docs.get(key)?.version ?? 0) + 1 });

  const reply = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

  /** A successful write's reply, with what the test's write report adds. */
  const written = (request: FakeAdminRequest, body: object) =>
    reply(200, { ...body, ...report?.(request) });

  function encryptSecrets(
    value: t.ConfigValue,
    existing: t.ConfigValue,
    parent?: string,
  ): t.ConfigValue {
    if (Array.isArray(value)) {
      const previous = Array.isArray(existing) ? existing : [];
      return value.map((item) => {
        const name = isConfigRecord(item) ? item.name : undefined;
        const match = previous.find((p) => isConfigRecord(p) && p.name === name);
        return encryptSecrets(item, match);
      });
    }
    if (!isConfigRecord(value)) return value;
    const result: t.ConfigRecord = {};
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith('Preview')) continue;
      result[key] =
        isSecretAt(key, parent) && typeof child === 'string' && !isPassthrough(child)
          ? `enc:${child}`
          : encryptSecrets(child, isConfigRecord(existing) ? existing[key] : undefined, key);
    }
    const previous = isConfigRecord(existing) ? existing : {};
    for (const key of SECRET_KEYS.keys()) {
      if (!(key in result) && isSecretAt(key, parent) && typeof previous[key] === 'string') {
        result[key] = previous[key];
      }
    }
    return result;
  }

  /** A value written at `fieldPath` as stored: its secrets encrypted, omitted ones kept from `existing`. */
  function encryptAt(fieldPath: string, value: t.ConfigValue, existing: t.ConfigValue) {
    const segments = fieldPath.split('.');
    const key = segments[segments.length - 1];
    if (typeof value === 'string' && isSecretAt(key, segments[segments.length - 2])) {
      return isPassthrough(value) ? value : `enc:${value}`;
    }
    return encryptSecrets(value, existing, key);
  }

  function baseMerged(): t.ConfigRecord {
    const base = docs.get(BASE_KEY);
    return mergeConfigLayers(yaml, base?.overrides ?? {}) as t.ConfigRecord;
  }

  async function fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const request: FakeAdminRequest = { method, path, body };
    requests.push(request);
    const custom = override?.(request);
    if (custom) return reply(custom.status, custom.body);

    const url = new URL(path, 'http://fake');
    if (url.pathname === '/api/admin/grants/effective') {
      return reply(200, { capabilities: ['manage:configs'] });
    }
    if (url.pathname === '/api/admin/config/meta') {
      return meta ? reply(200, meta) : reply(404, { message: 'Endpoint not found' });
    }
    if (url.pathname === '/api/admin/config/base') {
      const config = url.searchParams.get('baseOnly') === 'true' ? yaml : baseMerged();
      return reply(200, { config: redact(config) });
    }
    const match =
      /^\/api\/admin\/config\/([^/]+)\/([^/]+)(\/fields(\/tombstone)?|\/changes)?$/.exec(
        url.pathname,
      );
    if (!match) return reply(404, { error: 'Not found' });
    const [, principalType, principalId, fields, tombstone] = match;
    const key = docKey(principalType, principalId);
    const doc = docs.get(key);

    if (!fields) {
      if (!doc) return reply(404, { error: 'Config not found' });
      return reply(200, {
        config: {
          overrides: redact(doc.overrides),
          tombstones: doc.tombstones,
          ...(reportsRevisions() && { revision: revisionOf(key, doc) }),
        },
      });
    }
    if (fields === '/changes') return applyBatch(request, key, doc);
    const current = doc ?? { overrides: {}, tombstones: [] };
    if (tombstone) {
      const fieldPath = String(body?.fieldPath);
      store(key, {
        overrides: removeAt(current.overrides, fieldPath),
        tombstones: [...new Set([...current.tombstones, fieldPath])],
      });
      return written(request, { config: docs.get(key) });
    }
    if (method === 'DELETE') {
      if (!doc) return reply(404, { error: 'Config not found' });
      const fieldPath = String(url.searchParams.get('fieldPath'));
      store(key, {
        overrides: removeAt(doc.overrides, fieldPath),
        tombstones: doc.tombstones.filter((p) => !isAtOrUnder(p, fieldPath)),
      });
      return written(request, { config: redact(docs.get(key)!.overrides) });
    }
    let overrides = current.overrides;
    const entries = (body?.entries ?? []).filter(
      (entry: t.SaveEntry) => !strippedSections.has(entry.fieldPath.split('.')[0]),
    );
    if (entries.length === 0) {
      return written(request, { message: 'No actionable field entries provided' });
    }
    for (const entry of entries) {
      const existing = getValueAtPath(current.overrides, entry.fieldPath);
      overrides = setValueAtPath(
        overrides,
        entry.fieldPath,
        encryptAt(entry.fieldPath, entry.value, existing),
      );
    }
    const renames = body?.renames ?? [];
    for (const { path: recordPath, previousName, name } of renames) {
      if (getKeyedCollection(recordPath)) continue;
      const source = getValueAtPath(current.overrides, `${recordPath}.${previousName}`);
      const targetPath = `${recordPath}.${name}`;
      const carried = carrySecrets(source, getValueAtPath(overrides, targetPath));
      overrides = setValueAtPath(overrides, targetPath, carried);
    }
    const sent: t.SaveEntry[] = body?.entries ?? [];
    const kept = current.tombstones.filter(
      (p) => !sent.some(({ fieldPath, value }) => clearsTombstone(fieldPath, p, value)),
    );
    const carried = carryEntryRenames(current.overrides, overrides, kept, renames);
    store(key, carried);
    return written(request, { config: { overrides: redact(carried.overrides) } });
  }

  /** A document's schema issues in `section`: its overrides over the layer beneath, without what it hides. */
  function sectionIssues(
    key: string,
    state: Omit<FakeDoc, 'version'>,
    section: string,
  ): t.ConfigIssue[] {
    const lower = key === BASE_KEY ? yaml : baseMerged();
    const floor = state.tombstones.reduce(removeValueAtPath, lower);
    return validateSection(
      section,
      mergeConfigLayers(floor[section], state.overrides[section], section),
    );
  }

  /**
   * The issues a batch introduces (`judgeEndStates`): those of each section
   * it writes that the document did not have before, by the panel's own
   * section validation. LibreChat judges a batch on its end state too, a
   * little more leniently (only sections the document stores values in).
   */
  function endStateIssues(
    key: string,
    before: Omit<FakeDoc, 'version'>,
    after: Omit<FakeDoc, 'version'>,
    ops: t.ConfigBatchOp[],
  ): t.ConfigIssue[] {
    const sections = new Set(ops.map(({ fieldPath }) => getConfigSection(fieldPath)));
    return [...sections].flatMap((section) => {
      const had = new Set(sectionIssues(key, before, section).map(issueKey));
      return sectionIssues(key, after, section).filter((issue) => !had.has(issueKey(issue)));
    });
  }

  /** One batch op applied to a document, as `POST …/changes` applies it. */
  function applyOp(
    current: Omit<FakeDoc, 'version'>,
    op: t.ConfigBatchOp,
  ): Omit<FakeDoc, 'version'> {
    const { fieldPath } = op;
    if (op.op === 'set') {
      const existing = getValueAtPath(current.overrides, fieldPath);
      return {
        overrides: setValueAtPath(
          current.overrides,
          fieldPath,
          encryptAt(fieldPath, op.value, existing),
        ),
        tombstones: current.tombstones.filter((p) => !clearsTombstone(fieldPath, p, op.value)),
      };
    }
    if (op.op === 'rename') {
      const holder = getValueAtPath(current.overrides, fieldPath);
      const renamed = Array.isArray(holder)
        ? holder.map((item) =>
            isConfigRecord(item) && item.name === op.from ? { ...item, name: op.to } : item,
          )
        : Object.fromEntries(
            Object.entries(isConfigRecord(holder) ? holder : {}).map(([key, value]) => [
              key === op.from ? op.to : key,
              value,
            ]),
          );
      return { ...current, overrides: setValueAtPath(current.overrides, fieldPath, renamed) };
    }
    const overrides = parseKeyedPath(fieldPath)
      ? removeAt(current.overrides, fieldPath)
      : removePruned(current.overrides, fieldPath);
    const kept = current.tombstones.filter((p) => !isAtOrUnder(p, fieldPath));
    return { overrides, tombstones: op.op === 'tombstone' ? [...kept, fieldPath] : kept };
  }

  /**
   * `POST …/changes`: every op applied in order, written at once and named
   * by `expectedRevision` (409 when the document is at another revision).
   * Ops in a stripped section are reported as skipped.
   */
  function applyBatch(request: FakeAdminRequest, key: string, doc: FakeDoc | undefined): Response {
    const { ops = [], expectedRevision } = request.body ?? {};
    const currentRevision = revisionOf(key, doc);
    if (expectedRevision !== undefined && expectedRevision !== (currentRevision ?? 'absent')) {
      return reply(409, {
        error: 'Config was modified by another request',
        code: 'CONFIG_VERSION_CONFLICT',
        currentRevision,
      });
    }
    const current: Omit<FakeDoc, 'version'> = doc ?? { overrides: {}, tombstones: [] };
    let next = current;
    const applied: object[] = [];
    const skipped: object[] = [];
    ops.forEach((op, opIndex) => {
      const ref = { opIndex, op: op.op, segments: op.fieldPath.split('.') };
      if (strippedSections.has(ref.segments[0])) {
        skipped.push({ ...ref, reason: 'base_only_section' });
        return;
      }
      next = applyOp(next, op);
      applied.push(ref);
    });
    const issues = judging ? endStateIssues(key, current, next, ops) : [];
    if (issues.length > 0) {
      return reply(400, {
        error: 'Invalid config override',
        code: 'CONFIG_OVERRIDE_INVALID',
        issues,
      });
    }
    store(key, next);
    const stored = docs.get(key)!;
    const revision = revisionOf(key, stored);
    return written(request, {
      config: { overrides: redact(stored.overrides), tombstones: stored.tombstones, revision },
      revision,
      written: true,
      dryRun: false,
      applied,
      skipped,
      ignored: [],
      unchanged: [],
    });
  }

  return {
    fetch,
    requests,
    /** Stored overrides of a principal (`role/__base__` for base), unredacted. */
    stored: (principal = 'role/__base__') => docs.get(principal)?.overrides,
    tombstones: (principal = 'role/__base__') => docs.get(principal)?.tombstones ?? [],
    seed: (principal: string, overrides: t.ConfigRecord, tombstones: string[] = []) =>
      store(principal, { overrides, tombstones }),
    /** The revision a principal's document is at (`null`: none), as the server reports it. */
    revision: (principal = 'role/__base__') => revisionOf(principal, docs.get(principal)),
    /** Silently drops writes to a section, as LibreChat does for base-only sections. */
    stripSection: (section: string) => strippedSections.add(section),
    setOverride: (next?: FakeAdminOverride) => {
      override = next;
    },
    /** Adds a write report (`applied`, `skipped`, `ignored`) to each successful write's reply. */
    reportWrites: (next?: FakeWriteReport) => {
      report = next;
    },
    /** Refuses (400) a batch that leaves a section it writes with a schema issue it did not have. */
    judgeEndStates: () => {
      judging = true;
    },
    /** Serves `GET /api/admin/config/meta` (a server with the contract); unset, it answers 404 like an older server. */
    reportMeta: (body?: t.AdminConfigMetaBody) => {
      meta = body;
    },
    /** Every write request (PATCH, DELETE, POST), in order. */
    writes: () => requests.filter((r) => r.method !== 'GET'),
  };
}
