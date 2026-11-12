import { EModelEndpoint, normalizeEndpointName } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  getEntryKey,
  trimmedText,
  isConfigRecord,
  isConfigValueEqual,
  getKeyedCollection,
} from '@/utils';

export const SPEC_LIST_PATH = 'modelSpecs.list';

/** Built-in providers a spec can name (`custom` is a type, not an endpoint). */
export const BUILT_IN_ENDPOINTS: readonly string[] = Object.values(EModelEndpoint).filter(
  (endpoint) => endpoint !== EModelEndpoint.custom,
);

/** English fallback of each issue code (the page shows `com_config_issue_<code>`). */
const ISSUE_TEXT: Record<string, string> = {
  required: 'is required',
  spec_multiple_default: 'Only one spec can be the default',
  spec_multiple_soft_default: 'Only one spec can be the soft default',
};

function presetOf(spec: t.ConfigRecord): t.ConfigRecord {
  return isConfigRecord(spec.preset) ? spec.preset : {};
}

/**
 * The endpoint a spec uses, as LibreChat resolves it: the preset's endpoint,
 * or the agents endpoint when the preset names only an agent.
 */
export function specEndpoint(spec: t.ConfigValue): string {
  if (!isConfigRecord(spec)) return '';
  const preset = presetOf(spec);
  const endpoint = trimmedText(preset.endpoint);
  if (endpoint) return endpoint;
  return trimmedText(preset.agent_id) ? EModelEndpoint.agents : '';
}

/** Endpoints whose specs name an assistant, which brings its own model. */
export const ASSISTANT_ENDPOINTS: ReadonlySet<string> = new Set([
  EModelEndpoint.assistants,
  EModelEndpoint.azureAssistants,
]);

/** Whether a spec runs an agent (the agents endpoint picks its model from the agent). */
export function isAgentSpec(spec: t.ConfigValue): boolean {
  return specEndpoint(spec) === EModelEndpoint.agents;
}

function requiredProblems(spec: t.ConfigRecord, index: number): t.SpecProblem[] {
  const preset = presetOf(spec);
  const problems: t.SpecProblem[] = [];
  const required = (field: string) =>
    problems.push({ index, field, code: 'required', level: 'error' });
  if (!trimmedText(spec.name)) required('name');
  if (!trimmedText(spec.label)) required('label');
  const endpoint = specEndpoint(spec);
  if (!endpoint) required('preset.endpoint');
  if (endpoint === EModelEndpoint.agents) {
    if (!trimmedText(preset.agent_id)) required('preset.agent_id');
  } else if (ASSISTANT_ENDPOINTS.has(endpoint)) {
    if (!trimmedText(preset.assistant_id)) required('preset.assistant_id');
  } else if (!trimmedText(preset.model)) {
    required('preset.model');
  }
  return problems;
}

/** One problem for each spec after the first that repeats a value the list allows once. */
function repeatProblems(
  items: t.ConfigValue[],
  valueOf: (spec: t.ConfigRecord) => string | null,
  field: string,
  code: string,
): t.SpecProblem[] {
  const first = new Map<string, number>();
  const problems: t.SpecProblem[] = [];
  items.forEach((spec, index) => {
    if (!isConfigRecord(spec)) return;
    const value = valueOf(spec);
    if (value === null) return;
    const owner = first.get(value);
    if (owner === undefined) {
      first.set(value, index);
      return;
    }
    const ownerSpec = items[owner];
    const name = isConfigRecord(ownerSpec)
      ? trimmedText(ownerSpec.label) || trimmedText(ownerSpec.name)
      : '';
    problems.push({ index, field, code, level: 'error', params: { name, position: owner + 1 } });
  });
  return problems;
}

function unknownEndpointProblem(
  spec: t.ConfigRecord,
  index: number,
  known: ReadonlySet<string>,
): t.SpecProblem[] {
  const endpoint = trimmedText(presetOf(spec).endpoint);
  if (!endpoint || known.size === 0 || known.has(normalizeEndpointName(endpoint))) return [];
  return [
    {
      index,
      field: 'preset.endpoint',
      code: 'spec_unknown_endpoint',
      level: 'warning',
      params: { endpoint },
    },
  ];
}

/**
 * Semantic checks of a spec list (MS-2) that the schema can't express: a
 * name, label, endpoint and model (or agent) on every spec, unique names (the
 * id conversations and `?spec=` links use), at most one default and one soft
 * default, and a warning for an endpoint the configuration doesn't define.
 */
export function validateSpecs(
  items: t.ConfigValue[],
  ctx: t.SpecValidationContext,
): t.SpecProblem[] {
  const perSpec = items.flatMap((spec, index) =>
    isConfigRecord(spec)
      ? [
          ...requiredProblems(spec, index),
          ...unknownEndpointProblem(spec, index, ctx.knownEndpoints),
        ]
      : [],
  );
  return [
    ...perSpec,
    ...repeatProblems(
      items,
      (spec) => trimmedText(spec.name) || null,
      'name',
      'spec_duplicate_name',
    ),
    ...repeatProblems(
      items,
      (spec) => (spec.default === true ? 'default' : null),
      'default',
      'spec_multiple_default',
    ),
    ...repeatProblems(
      items,
      (spec) => (spec.softDefault === true ? 'soft' : null),
      'softDefault',
      'spec_multiple_soft_default',
    ),
  ];
}

/** Problems of one spec, errors first. */
export function problemsOf(problems: t.SpecProblem[], index: number): t.SpecProblem[] {
  return problems
    .filter((problem) => problem.index === index)
    .sort((a, b) => Number(a.level === 'warning') - Number(b.level === 'warning'));
}

/** The first problem of a spec field. */
export function problemAt(
  problems: t.SpecProblem[],
  index: number,
  field: string,
): t.SpecProblem | undefined {
  return problemsOf(problems, index).find((problem) => problem.field === field);
}

/** `name|field|code` of each problem the list had when its first edit was made. */
function baselineProblems(baseline: t.ConfigValue[]): Set<string> {
  return new Set(
    validateSpecs(baseline, { knownEndpoints: new Set() }).map((problem) => {
      const spec = baseline[problem.index];
      const name = isConfigRecord(spec) ? trimmedText(spec.name) : '';
      return `${name}|${problem.field}|${problem.code}`;
    }),
  );
}

/**
 * Whether the save pipeline reports a name problem itself. It keys entries by
 * the name as written: it flags an entry without one and a new or renamed
 * entry taking an exact name already used, but not a blank (whitespace-only)
 * name or names that only differ by surrounding spaces, which
 * `validateSpecs` compares trimmed.
 */
function isPipelineNameProblem(
  problem: t.SpecProblem,
  rawName: string | undefined,
  firstIndex: ReadonlyMap<string, number>,
): boolean {
  if (problem.field !== 'name') return false;
  if (problem.code === 'required') return rawName === undefined;
  if (problem.code !== 'spec_duplicate_name' || rawName === undefined) return false;
  return (firstIndex.get(rawName) ?? problem.index) < problem.index;
}

/**
 * Save-blocking issues of a pending spec list, for the save pipeline (WS1):
 * the errors of `validateSpecs`, at the spec's position in the pending list.
 * A problem a spec already had and that the admin hasn't touched (a
 * librechat.yaml spec LibreChat serves as it is) doesn't block an unrelated
 * edit; added and changed specs must be complete. Name problems the pipeline
 * reports itself are left out, and an entry is named by its name when that
 * is unique.
 */
export function specListIssues(changeSet: t.ConfigChangeSet): t.ConfigIssue[] {
  const pending = changeSet.collections.find(
    (collection) => collection.collection.path === SPEC_LIST_PATH,
  );
  const collection = getKeyedCollection(SPEC_LIST_PATH);
  if (!pending || !collection) return [];
  const { items, edit } = pending;
  const before = baselineProblems(edit.baseline);
  const isUntouched = (problem: t.SpecProblem): boolean => {
    const origin = edit.origins[problem.index];
    return (
      origin != null &&
      isConfigValueEqual(origin.baseline, items[problem.index]) &&
      before.has(`${origin.identity}|${problem.field}|${problem.code}`)
    );
  };
  const names = new Map<string, number>();
  const rawNames = items.map((item) => getEntryKey(item, collection.key));
  const firstIndex = new Map<string, number>();
  items.forEach((item, index) => {
    const name = isConfigRecord(item) ? trimmedText(item.name) : '';
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
    const raw = rawNames[index];
    if (raw !== undefined && !firstIndex.has(raw)) firstIndex.set(raw, index);
  });
  return validateSpecs(items, { knownEndpoints: new Set() })
    .filter((problem) => problem.level === 'error')
    .filter((problem) => !isPipelineNameProblem(problem, rawNames[problem.index], firstIndex))
    .filter((problem) => !isUntouched(problem))
    .map((problem): t.ConfigIssue => {
      const spec = items[problem.index];
      const name = isConfigRecord(spec) ? trimmedText(spec.name) : '';
      const unique = name !== '' && names.get(name) === 1;
      return {
        path: `${SPEC_LIST_PATH}.${problem.index}.${problem.field}`,
        code: problem.code,
        message: ISSUE_TEXT[problem.code] ?? problem.code,
        params: problem.params,
        ...(unique && { entryIdentity: name, entryPath: problem.field }),
      };
    });
}
