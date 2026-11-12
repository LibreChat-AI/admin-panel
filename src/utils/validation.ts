import { configSchema } from 'librechat-data-provider';
import type { core } from 'zod';
import type * as t from '@/types';
import { schemaType, unwrapSchema, resolveSubSchema } from './schema';
import { AZURE_GROUPS_PATH } from '@/constants';
import { getEntryKey } from './collections';
import { isConfigRecord } from './format';

const MAX_UNION_DEPTH = 10;

/** Every parse reports the value that failed (`input`): a refused enum's text, a missing field. */
const PARSE_PARAMS = { reportInput: true } as const;

function isParseable(schema: t.ZodSchemaLike | null | undefined): schema is t.ParseableSchema {
  return schema != null && typeof (schema as Partial<t.ParseableSchema>).safeParse === 'function';
}

/**
 * `schema.safeParse(value)`, where a refinement that throws (LibreChat's
 * WebSocket URL check runs `new URL()` on any text a union tries it with)
 * fails the value with that error instead of throwing.
 */
export function parseSafely(schema: t.ParseableSchema, value: t.ConfigValue): t.SchemaParseResult {
  try {
    return schema.safeParse(value, PARSE_PARAMS);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validation failed';
    return { success: false, error: { issues: [{ code: 'custom', path: [], message }] } };
  }
}

/** Validates a value against the bundled config schema at `fieldPath` (unknown paths pass). */
export function validateFieldValue(
  fieldPath: string,
  value: t.ConfigValue,
): { success: true } | { success: false; error: string } {
  const segments = fieldPath.split('.');
  const subSchema = resolveSubSchema(configSchema as t.ZodSchemaLike, segments);

  if (!isParseable(subSchema)) return { success: true };

  const result = parseSafely(subSchema, value);
  if (!result.success && result.error) {
    const messages = result.error.issues.map((issue) => {
      const issuePath = issue.path.reduce<string>(
        (path, segment) =>
          typeof segment === 'number' ? `${path}[${segment}]` : `${path}.${String(segment)}`,
        fieldPath,
      );
      return `${issuePath}: ${issue.message}`;
    });
    return { success: false, error: messages.join('; ') || 'Validation failed' };
  }

  return { success: true };
}

/** Issues nested in a union branch or record key, at their place in the parent's value. */
function prefixIssues(path: PropertyKey[], issues: core.$ZodIssue[]): core.$ZodIssue[] {
  return issues.map((issue) => ({ ...issue, path: [...path, ...issue.path] }));
}

/**
 * A union reports one issue at its own path; the branch with the fewest
 * (then deepest) failures is the shape the value was written for, so its
 * issues locate the actual fault. A record key's failure (`invalid_key`)
 * stands for the key's own issues. Zod 4 gives nested issues paths relative
 * to the union or key, so each takes its parent's path first. Mirrors
 * LibreChat's issue attribution.
 */
function expandSchemaIssues(issues: core.$ZodIssue[], depth = 0): core.$ZodIssue[] {
  return issues.flatMap((issue) => {
    if (depth >= MAX_UNION_DEPTH) return [issue];
    if (issue.code === 'invalid_key') {
      return expandSchemaIssues(prefixIssues(issue.path, issue.issues), depth + 1);
    }
    if (issue.code !== 'invalid_union') return [issue];
    const deepest = (list: core.$ZodIssue[]) => Math.max(0, ...list.map((i) => i.path.length));
    const closest = issue.errors
      .map((branch) => prefixIssues(issue.path, branch))
      .reduce<core.$ZodIssue[] | undefined>((best, branch) => {
        if (!best || branch.length < best.length) return branch;
        return branch.length === best.length && deepest(branch) > deepest(best) ? branch : best;
      }, undefined);
    return closest && closest.length > 0 ? expandSchemaIssues(closest, depth + 1) : [issue];
  });
}

function formatBound(value: number | undefined): string | number {
  return value ?? '';
}

/** `type`: what a bound applies to (`string`, `array`, `number`, …). */
function boundCode(
  base: 'too_small' | 'too_big',
  type: string | undefined,
  inclusive: boolean | undefined,
): string {
  if (type === 'string') return `${base}_length`;
  if (type === 'array' || type === 'set') return `${base}_items`;
  return inclusive === false ? `${base}_exclusive` : base;
}

/** Zod 4's names for expected types that issue codes word as the admin API spells them. */
const EXPECTED_TYPE_NAMES: Readonly<Record<string, string>> = {
  int: 'integer',
  record: 'object',
  tuple: 'array',
};

const TYPE_NAMES: Readonly<Record<string, string>> = {
  string: 'text',
  number: 'a number',
  integer: 'a whole number',
  boolean: 'true or false',
  array: 'a list',
  object: 'an object',
};

/**
 * English text for each issue code, with `{{param}}` placeholders. The panel
 * shows the localized `com_config_issue_<code>` text instead when it has one.
 */
const ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  required: 'is required',
  invalid_type: 'must be {{expected}}',
  invalid_literal: 'must be {{expected}}',
  invalid_enum_value: 'must be one of {{options}}',
  invalid_url: 'must be a valid URL',
  invalid_email: 'must be a valid email address',
  too_small: 'must be at least {{minimum}}',
  too_small_exclusive: 'must be greater than {{minimum}}',
  too_small_length: 'must be at least {{minimum}} characters',
  too_small_items: 'must have at least {{minimum}} items',
  too_big: 'must be at most {{maximum}}',
  too_big_exclusive: 'must be less than {{maximum}}',
  too_big_length: 'must be at most {{maximum}} characters',
  too_big_items: 'must have at most {{maximum}} items',
  union_dropped_key: "isn't valid for this kind of value",
  duplicate_merge_key: 'repeats a name another entry already uses',
  entry_key_unaddressable:
    'is named "{{name}}", which LibreChat could not remove or hide later: use at most {{max}} characters, not starting with $ or __, and not constructor or prototype',
  missing_merge_key: 'needs a name',
  indexed_merge_key_write: 'must be saved as a whole list',
  invalid_document: 'is not a valid configuration',
  invalid_union: 'is not a valid value',
  models_required: 'needs at least one model',
  name_whitespace: 'starts or ends with a space',
  YAML_MANAGED:
    'is managed in librechat.yaml; LibreChat ignores admin overrides for it until it re-processes them',
  PROCESS_MCP_FIELD:
    'can only be configured in librechat.yaml for process-backed MCP servers (command, args, env, cwd, stderr, stdio)',
  BLANK_VALUE: 'is blank: enter a value, or clear the field',
  BLANK_KEY: 'has a blank key: name it, or remove the entry',
  UNSAFE_KEY:
    "has a key LibreChat can't store yet (\"{{key}}\" contains '.' or starts with '$'); set it in librechat.yaml",
  RESERVED_KEY:
    "has a key LibreChat can't store (\"{{key}}\" starts with '$' or is a reserved name); rename it",
  invalid_value: 'is not a valid value',
  wrong_type: 'has the wrong type of value',
  invalid_option: 'is not one of the allowed values',
  too_small_value: 'is too small',
  too_big_value: 'is too large',
  dotted_key: "has a key with a dot where LibreChat expects a setting's name",
  unknown_section: "isn't a section LibreChat knows",
  not_multiple_of: 'must be a multiple of {{multipleOf}}',
  custom_empty: 'is empty: enter a host and a port',
  custom_format: 'must be only host:port, without http:// or a path',
  custom_missing_port: 'must include a port, for example localhost:11434',
  custom_public_ip:
    'is a public IP address: enter a private address, or a hostname that resolves to one',
  secret_reentry_required:
    'must be entered again: LibreChat does not send a stored key to a new destination',
  env_reference_not_allowed:
    'references an environment variable LibreChat does not let admin settings read',
  MCP_API_KEY_MISSING:
    'must be entered: this server sends an API key you provide for everyone. Enter it, or let each user provide their own',
  MCP_SECRET_NOT_CARRIED:
    "must be entered again: the one stored for {{from}} can't move to a new name",
  TOO_MANY_CHANGES:
    'has {{count}} changes, more than the {{limit}} LibreChat takes in one save: save some of them first, then the rest',
  azure_base_url_required: 'is required for a serverless group',
  azure_instance_required: 'is required unless the group is serverless',
  azure_model_unresolved:
    "include {{model}}, which has no deployment name or API version of its own or the group's",
  azure_model_duplicate: 'include {{model}}, which group {{group}} serves already',
  invalid_azure_groups:
    "don't resolve: a model is served twice or lacks a deployment name or API version, a group lacks its instance or base URL, or a key references a variable that isn't set",
  invalid_vertex_config:
    "isn't a Vertex AI setup LibreChat can load: a variable isn't set, a project ID, region or deployment name isn't one URL path segment, or librechat.yaml configures no Vertex AI",
  invalid_param_definitions:
    "aren't parameter definitions LibreChat can load: each key must be a parameter of the chosen parameter set",
  unknown_spec_endpoint: "isn't a built-in endpoint or a configured custom endpoint",
  spec_endpoint_hidden:
    "is {{endpoint}}, which this profile hides: LibreChat refuses a spec for it until it's shown again",
};

/**
 * Codes whose message needs parameters, worded without them: the admin API
 * reports issue codes only (no minimum, expected type or options).
 */
const PARAMLESS_CODES: Readonly<Record<string, string>> = {
  invalid_type: 'wrong_type',
  invalid_literal: 'invalid_value',
  invalid_enum_value: 'invalid_option',
  too_small: 'too_small_value',
  too_small_exclusive: 'too_small_value',
  too_small_length: 'too_small_value',
  too_small_items: 'too_small_value',
  too_big: 'too_big_value',
  too_big_exclusive: 'too_big_value',
  too_big_length: 'too_big_value',
  too_big_items: 'too_big_value',
};

const PLACEHOLDER_RE = /\{\{\w+\}\}/;

/**
 * The code to show for an issue reported without parameters: one whose
 * message names them (`too_small`: "must be at least {{minimum}}") becomes
 * its parameter-free wording ("is too small"); other codes stay.
 */
export function paramlessIssueCode(code: string): string {
  const template = ISSUE_MESSAGES[code];
  if (!template || !PLACEHOLDER_RE.test(template)) return code;
  return PARAMLESS_CODES[code] ?? 'invalid_value';
}

/** Fills `{{param}}` placeholders. */
export function interpolateIssue(
  template: string,
  params: Record<string, string | number> = {},
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** English text for an issue code (with params), or `fallback` for codes without one. */
export function describeIssueCode(
  code: string | undefined,
  params: Record<string, string | number> | undefined,
  fallback: string,
): string {
  const template = code ? ISSUE_MESSAGES[code] : undefined;
  return template ? interpolateIssue(template, params) : fallback;
}

/** Whether `code` has a generic message (a predicate such as "is required") rather than a free-form one. */
export function hasIssueMessage(code: string | undefined): boolean {
  return code != null && code in ISSUE_MESSAGES;
}

/**
 * The issue code and message parameters for an issue in the names the admin
 * API reports (zod 3's: `invalid_enum_value`, `invalid_literal`,
 * `invalid_string`), with its parameters. `received: 'undefined'` makes a
 * wrong type a missing value.
 */
function classifyContractIssue(
  code: string,
  params: t.ReportedIssueParams,
): { code: string; params: Record<string, string | number> } {
  switch (code) {
    case 'invalid_type':
      if (params.received === 'undefined') return { code: 'required', params: {} };
      return {
        code: 'invalid_type',
        params: { expected: TYPE_NAMES[String(params.expected)] ?? String(params.expected) },
      };
    case 'invalid_literal':
      return { code: 'invalid_literal', params: { expected: JSON.stringify(params.expected) } };
    case 'invalid_enum_value':
      return {
        code: 'invalid_enum_value',
        params: { options: (params.options ?? []).map((o) => JSON.stringify(o)).join(', ') },
      };
    case 'too_small':
      return {
        code: boundCode('too_small', params.type, params.inclusive),
        params: { minimum: formatBound(params.minimum) },
      };
    case 'too_big':
      return {
        code: boundCode('too_big', params.type, params.inclusive),
        params: { maximum: formatBound(params.maximum) },
      };
    case 'invalid_string':
      if (params.validation === 'url') return { code: 'invalid_url', params: {} };
      if (params.validation === 'email') return { code: 'invalid_email', params: {} };
      return { code: 'invalid_string', params: {} };
    default:
      return { code, params: {} };
  }
}

const PRIMITIVE_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);

/** Whether a value zod reports (an issue's `input`, an enum's `values`) is JSON-like text, number, flag or null. */
function isIssuePrimitive(value: core.$ZodIssueBase['input']): value is t.IssuePrimitive {
  return value === null || PRIMITIVE_TYPES.has(typeof value);
}

/** The value an issue of a `reportInput` parse refused, when it is a primitive. */
function refusedValue(issue: core.$ZodIssue): t.IssuePrimitive | undefined {
  return 'input' in issue && isIssuePrimitive(issue.input) ? issue.input : undefined;
}

/** A bound as the admin API reports it: a number (zod's bigint bounds become one). */
function toBound(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

/**
 * Whether an `invalid_value` issue is an enum's refusal rather than a
 * literal's: zod 4 reports both alike. LibreChat's `getConfigIssueCode`
 * decides by the allowed values alone (more than one is an enum, so a
 * multi-value literal is one too); the panel does the same, except that the
 * schema node at the issue's path keeps a one-member enum an enum, as zod 3
 * reported it.
 */
function isEnumRefusal(
  issue: core.$ZodIssueInvalidValue,
  schema: t.ZodSchemaLike | undefined,
): boolean {
  if (issue.values.length !== 1) return true;
  const node = schema ? resolveSubSchema(schema, issue.path.map(String)) : null;
  return node != null && schemaType(unwrapSchema(node)) === 'enum';
}

/**
 * A zod 4 issue in the codes and parameters the admin API reports
 * (LibreChat's `getConfigIssueCode`), so a schema issue and a reported one
 * are worded alike; only a one-member enum differs (`isEnumRefusal`).
 * `schema` (what was parsed) tells that enum from a literal.
 */
function toContractIssue(
  issue: core.$ZodIssue,
  schema: t.ZodSchemaLike | undefined,
): { code: string; params: t.ReportedIssueParams } {
  switch (issue.code) {
    case 'invalid_type': {
      const missing = 'input' in issue && issue.input === undefined;
      const expected = EXPECTED_TYPE_NAMES[issue.expected] ?? issue.expected;
      return { code: issue.code, params: { expected, ...(missing && { received: 'undefined' }) } };
    }
    case 'invalid_value': {
      const options = issue.values.filter(isIssuePrimitive);
      if (!isEnumRefusal(issue, schema)) {
        return { code: 'invalid_literal', params: { expected: options[0] } };
      }
      /** An enum refuses a missing value too; zod 3 called that a wrong type ("is required"). */
      if ('input' in issue && issue.input === undefined) {
        return { code: 'invalid_type', params: { received: 'undefined' } };
      }
      return { code: 'invalid_enum_value', params: { options } };
    }
    case 'too_small':
      return {
        code: issue.code,
        params: { minimum: toBound(issue.minimum), inclusive: issue.inclusive, type: issue.origin },
      };
    case 'too_big':
      return {
        code: issue.code,
        params: { maximum: toBound(issue.maximum), inclusive: issue.inclusive, type: issue.origin },
      };
    case 'invalid_format':
      return { code: 'invalid_string', params: { validation: issue.format } };
    case 'invalid_union':
      return { code: issue.discriminator ? 'invalid_union_discriminator' : issue.code, params: {} };
    default:
      return { code: issue.code, params: {} };
  }
}

/** The issue code and message parameters for a zod issue of `schema`. */
function classifySchemaIssue(
  issue: core.$ZodIssue,
  schema: t.ZodSchemaLike | undefined,
): { code: string; params: Record<string, string | number> } {
  const contract = toContractIssue(issue, schema);
  return classifyContractIssue(contract.code, contract.params);
}

/** A bound the admin API reported as a number, or undefined (dates and bigints are not sent). */
function numberBound(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The issue code and message parameters of an issue the admin API reported
 * with `params` (`issueParams`): its bounds, options and expected type, read
 * the way the panel reads its own schema issues; a refinement's `reason`
 * becomes `custom_<reason>` where the panel words it. Without params, or
 * without the parameter a code's message needs, the code is worded without
 * it (`paramlessIssueCode`).
 */
export function classifyReportedIssue(
  code: string,
  params: t.ReportedIssueParams | undefined,
): { code: string; params?: Record<string, string | number> } {
  if (!params) return { code: paramlessIssueCode(code) };
  const bound = numberBound(code === 'too_big' ? params.maximum : params.minimum);
  switch (code) {
    case 'too_small':
    case 'too_big':
      if (bound === undefined) return { code: paramlessIssueCode(code) };
      break;
    case 'invalid_type':
    case 'invalid_literal':
      if (params.expected === undefined) return { code: paramlessIssueCode(code) };
      break;
    case 'invalid_enum_value':
    case 'invalid_union_discriminator':
      if (!params.options?.length) return { code: paramlessIssueCode('invalid_enum_value') };
      return {
        code: 'invalid_enum_value',
        params: { options: params.options.map((option) => JSON.stringify(option)).join(', ') },
      };
    case 'not_multiple_of': {
      const step = numberBound(params.multipleOf);
      return step === undefined
        ? { code: 'invalid_value' }
        : { code, params: { multipleOf: step } };
    }
    case 'custom': {
      const reasonCode = params.reason ? `custom_${params.reason}` : undefined;
      return { code: reasonCode && reasonCode in ISSUE_MESSAGES ? reasonCode : code };
    }
    default:
      break;
  }
  return classifyContractIssue(code, { ...params, minimum: bound, maximum: bound });
}

/**
 * Whether an issue is only a text value an enum of the bundled schema doesn't
 * list: a member a newer LibreChat may know (`interface.retentionMode:
 * ephemeral`), or a typo. Import keeps it (and names it) and a save writes
 * it: LibreChat v0.8.8 and later refuse one they don't know, earlier
 * releases store it as written. Any other issue blocks, a number in an enum
 * and a union none of whose branches fits included.
 */
export function isUnknownEnumValue(issue: Pick<t.ConfigIssue, 'code' | 'received'>): boolean {
  return issue.code === 'invalid_enum_value' && typeof issue.received === 'string';
}

/**
 * The text value an enum of `schema` doesn't list (`isUnknownEnumValue`), for
 * an issue of `schema.safeParse(value, { reportInput: true })`, with the
 * values the enum lists; undefined for any other issue: a one-value
 * literal's, a union's (an enum inside one of its branches stays the union's
 * failure), or one whose value isn't text.
 */
export function findUnknownEnumValue(
  issue: core.$ZodIssue,
  schema: t.ZodSchemaLike,
): Omit<t.ImportEnumValue, 'path'> | undefined {
  if (issue.code !== 'invalid_value' || !isEnumRefusal(issue, schema)) return undefined;
  const value = refusedValue(issue);
  if (typeof value !== 'string') return undefined;
  const options = issue.values.filter(
    (option): option is string | number => typeof option === 'string' || typeof option === 'number',
  );
  return { value, options };
}

/**
 * Config issues (stable codes, English messages) for issues of `schema`
 * relative to `basePath`. An enum issue carries the value it refused
 * (`received`), except inside a union's branch, which stays a union's
 * failure. Without `schema`, an issue's allowed values alone tell an enum
 * from a literal.
 */
export function toConfigIssues(
  issues: core.$ZodIssue[],
  basePath: string,
  schema?: t.ZodSchemaLike,
): t.ConfigIssue[] {
  const direct = new Set(issues);
  return expandSchemaIssues(issues)
    .filter((issue) => issue.code !== 'unrecognized_keys')
    .map((issue) => {
      const { code, params } = classifySchemaIssue(issue, schema);
      const path = [basePath, ...issue.path.map(String)].filter(Boolean).join('.');
      const message = describeIssueCode(code, params, issue.message);
      const received =
        code === 'invalid_enum_value' && direct.has(issue) ? refusedValue(issue) : undefined;
      if (received === undefined) {
        return { path, code, params, message };
      }
      return { path, code, params, message, received };
    });
}

function parseIssues(
  schema: t.ZodSchemaLike | null | undefined,
  value: t.ConfigValue,
  basePath: string,
): t.ConfigIssue[] {
  if (!isParseable(schema)) return [];
  const result = parseSafely(schema, value);
  if (result.success || !result.error) return [];
  return toConfigIssues(result.error.issues, basePath, schema);
}

/** Schema issues of a value at `path` (a field, entry or section of the config). */
export function validateField(path: string, value: t.ConfigValue): t.ConfigIssue[] {
  const schema = resolveSubSchema(configSchema as t.ZodSchemaLike, path.split('.'));
  return parseIssues(schema, value, path);
}

/**
 * Schema issues of one collection entry, validated whole against the
 * collection's element schema (so required fields and refinements apply).
 * Paths are `<collection>.<index>.<field>`, and each issue names the entry.
 */
export function validateEntry(
  collectionPath: string,
  entry: t.ConfigValue,
  index: number,
  identity?: string,
): t.ConfigIssue[] {
  const schema = resolveSubSchema(configSchema as t.ZodSchemaLike, [
    ...collectionPath.split('.'),
    '0',
  ]);
  const entryBase = `${collectionPath}.${index}`;
  return parseIssues(schema, entry, entryBase).map((issue) => ({
    ...issue,
    entryIdentity: identity,
    entryPath: issue.path === entryBase ? '' : issue.path.slice(entryBase.length + 1),
  }));
}

function hasText(value: t.ConfigValue): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * What a custom endpoint needs for LibreChat to load it at all: an API key, a
 * base URL, and a model list (default models, or fetched). The schema leaves
 * them optional, so an entry without them saves fine and is then silently
 * dropped at runtime (`loadCustomEndpointsConfig`). `hasStoredKey` counts an
 * encrypted key the read only shows as a preview.
 */
export function validateLoadableEndpoint(
  entry: t.ConfigValue,
  index: number,
  identity?: string,
  hasStoredKey = false,
): t.ConfigIssue[] {
  if (!isConfigRecord(entry)) return [];
  const base = `endpoints.custom.${index}`;
  const issue = (entryPath: string, code: string): t.ConfigIssue => ({
    path: `${base}.${entryPath}`,
    code,
    message: describeIssueCode(code, undefined, code),
    entryIdentity: identity,
    entryPath,
  });
  const models = isConfigRecord(entry.models) ? entry.models : {};
  const hasModels = Array.isArray(models.default) && models.default.length > 0;
  const paddedName = typeof entry.name === 'string' && entry.name.trim() !== entry.name;
  return [
    ...(paddedName && hasText(entry.name) ? [issue('name', 'name_whitespace')] : []),
    ...(hasText(entry.apiKey) || hasStoredKey ? [] : [issue('apiKey', 'required')]),
    ...(hasText(entry.baseURL) ? [] : [issue('baseURL', 'required')]),
    ...(hasModels ? [] : [issue('models.default', 'models_required')]),
  ];
}

function azureIssue(
  base: string,
  entryPath: string,
  code: string,
  identity: string | undefined,
  params: Record<string, string> = {},
): t.ConfigIssue {
  return {
    path: `${base}.${entryPath}`,
    code,
    params,
    message: describeIssueCode(code, params, code),
    entryIdentity: identity,
    entryPath,
  };
}

/** Why one model of a non-serverless group can't be mapped: no deployment name or API version, its own or the group's. */
function isUnresolvedModel(model: t.ConfigValue, group: t.ConfigRecord): boolean {
  const groupDeployment = hasText(group.deploymentName);
  const groupVersion = hasText(group.version);
  if (typeof model === 'boolean') return !groupDeployment || !groupVersion;
  const config = isConfigRecord(model) ? model : {};
  return (
    (!hasText(config.deploymentName) && !groupDeployment) ||
    (!hasText(config.version) && !groupVersion)
  );
}

/** Each model the merged Azure groups serve, with the groups that serve it. */
export function modelsByGroup(groups: t.ConfigValue): Map<string, string[]> {
  const served = new Map<string, string[]>();
  for (const group of Array.isArray(groups) ? groups : []) {
    const name = getEntryKey(group, 'group');
    const models = isConfigRecord(group) ? group.models : undefined;
    if (name === undefined || !isConfigRecord(models)) continue;
    for (const model of Object.keys(models)) {
      served.set(model, [...(served.get(model) ?? []), name]);
    }
  }
  return served;
}

/**
 * What an Azure group needs for LibreChat to resolve it (`validateAzureGroups`;
 * the server refuses a write whose groups don't, `invalid_azure_groups`): a
 * serverless group a base URL, any other an instance name and, for each
 * model, a deployment name and an API version (its own or the group's); and
 * no model another group also serves (`servedBy`: each model's groups).
 */
export function validateResolvableGroup(
  entry: t.ConfigValue,
  index: number,
  identity: string | undefined,
  servedBy: ReadonlyMap<string, readonly string[]>,
): t.ConfigIssue[] {
  if (!isConfigRecord(entry)) return [];
  const base = `${AZURE_GROUPS_PATH}.${index}`;
  const models = isConfigRecord(entry.models) ? entry.models : {};
  const issues: t.ConfigIssue[] = [];
  const serverless = entry.serverless === true;
  if (serverless && !hasText(entry.baseURL)) {
    issues.push(azureIssue(base, 'baseURL', 'azure_base_url_required', identity));
  }
  if (!serverless && !hasText(entry.instanceName)) {
    issues.push(azureIssue(base, 'instanceName', 'azure_instance_required', identity));
  }
  for (const [model, config] of Object.entries(models)) {
    const owner = servedBy.get(model)?.find((group) => group !== identity);
    if (owner !== undefined) {
      issues.push(
        azureIssue(base, 'models', 'azure_model_duplicate', identity, { model, group: owner }),
      );
    } else if (!serverless && isUnresolvedModel(config, entry)) {
      issues.push(azureIssue(base, 'models', 'azure_model_unresolved', identity, { model }));
    }
  }
  return issues;
}

/**
 * Schema issues of a whole top-level section, so object refinements and
 * required siblings are checked (e.g. CloudFront's `invalidateOnDelete`
 * needs a domain), which per-field validation cannot see.
 */
export function validateSection(section: string, value: t.ConfigValue): t.ConfigIssue[] {
  if (value === undefined) return [];
  const shape = (configSchema as t.ZodSchemaLike).shape;
  return parseIssues(shape?.[section], value, section);
}

/** Where an issue is, for plain-text summaries: `endpoints.custom › GPT › provider` inside an entry. */
export function describeIssueLocation(issue: t.ConfigIssue): string {
  if (issue.entryIdentity === undefined) return issue.path;
  const collection = issue.entryPath
    ? issue.path.slice(0, -(issue.entryPath.length + 1)).replace(/\.\d+$/, '')
    : issue.path.replace(/\.\d+$/, '');
  const field = issue.entryPath ? ` › ${issue.entryPath}` : '';
  return `${collection} › ${issue.entryIdentity}${field}`;
}

/** One-line English summary of blocking issues (server errors, logs). */
export function summarizeIssues(issues: t.ConfigIssue[]): string {
  const details = issues.map((issue) => `${describeIssueLocation(issue)}: ${issue.message}`);
  return `Validation failed — ${details.join('; ')}`;
}
