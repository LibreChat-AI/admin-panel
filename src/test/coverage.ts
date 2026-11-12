import { fireEvent, within } from '@testing-library/react';
import type * as t from '@/types';
import { isConfigRecord, getValueAtPath, mergeScopeLayer } from '@/utils';
import { splitUnionTypes } from '@/components/configuration/controls';
import { toFieldId } from '@/components/configuration/renderer';
import i18n from '@/locales/i18n';

const ARRAY_MARKER = '[]';
const RECORD_MARKER = '{}';

/** The page's English texts, outside React (labels a test looks for). */
/** Per-test timeout for full-tab coverage renders, which run several times slower on CI runners. */
export const COVERAGE_TEST_TIMEOUT_MS = 30_000;

export const localizeEn: t.LocalizeFn = (key, values) => i18n.t(key, values ?? {});

/** A new string setting and a new object holding a boolean, as a newer LibreChat schema may add them. */
export const SYNTHETIC_TEXT = 'zzNewSetting';
export const SYNTHETIC_GROUP = 'zzNewGroup';
export const SYNTHETIC_FLAG = 'zzNewFlag';
/** A key the configuration holds that no schema knows (D8: shown read-only). */
export const UNKNOWN_KEY = 'zzUnknownSetting';

/**
 * Leaves the editors leave out on purpose, by schema path (`mcpServers.{}.type`)
 * or by an ancestor path covering everything under it, each with the reason.
 */
export type HiddenFields = Readonly<Record<string, string>>;

/** A schema field by its schema path (`endpoints.custom.[].models`). */
export function findSchemaField(tree: t.SchemaField[], path: string): t.SchemaField | undefined {
  let fields = tree;
  let found: t.SchemaField | undefined;
  for (const segment of path.split('.')) {
    if (segment === ARRAY_MARKER || segment === RECORD_MARKER) continue;
    found = fields.find((field) => field.key === segment);
    if (!found) return undefined;
    fields = found.children ?? [];
  }
  return found;
}

/** Schema paths of every leaf (a field without children) under a field, `[]`/`{}` markers kept. */
export function schemaLeaves(field: t.SchemaField): string[] {
  if (!field.children?.length) return [field.path];
  return field.children.flatMap(schemaLeaves);
}

/** The data paths a schema path names in `data`: one per list item or record entry it passes. */
export function dataPaths(schemaPath: string, data: t.ConfigValue): string[] {
  let found: Array<{ path: string[]; value: t.ConfigValue | undefined }> = [
    { path: [], value: data },
  ];
  for (const segment of schemaPath.split('.')) {
    found = found.flatMap(({ path, value }) => {
      if (segment === ARRAY_MARKER) {
        return Array.isArray(value)
          ? value.map((item, i) => ({ path: [...path, String(i)], value: item }))
          : [];
      }
      if (segment === RECORD_MARKER) {
        return isConfigRecord(value)
          ? Object.entries(value).map(([key, item]) => ({ path: [...path, key], value: item }))
          : [];
      }
      return [
        { path: [...path, segment], value: isConfigRecord(value) ? value[segment] : undefined },
      ];
    });
  }
  return found.map(({ path }) => path.join('.'));
}

function isHidden(schemaPath: string, hidden: HiddenFields): boolean {
  return Object.keys(hidden).some((key) => schemaPath === key || schemaPath.startsWith(`${key}.`));
}

/**
 * Schema paths whose control also shows a leaf: a variant field's own
 * control picks its discriminator (`summarization.trigger` sets `.type`).
 */
function controlsOf(root: t.SchemaField): Map<string, string[]> {
  const controls = new Map<string, string[]>();
  const visit = (field: t.SchemaField) => {
    for (const child of field.children ?? []) {
      const own = child.key === field.discriminator ? [child.path, field.path] : [child.path];
      if (!child.children?.length) controls.set(child.path, own);
      visit(child);
    }
  };
  if (!root.children?.length) controls.set(root.path, [root.path]);
  visit(root);
  return controls;
}

/**
 * The schema leaves under `root` the rendered page shows: some element
 * carries the control id of a data path the leaf (or the variant control
 * choosing it) names in `data`, so the fixture must hold an entry for every
 * list and record on the way.
 */
export function renderedLeaves(
  root: t.SchemaField,
  data: t.ConfigValue,
  doc: Document = document,
): string[] {
  return [...controlsOf(root)]
    .filter(([, controls]) =>
      controls.some((control) =>
        dataPaths(control, data).some((path) => doc.getElementById(toFieldId(path)) != null),
      ),
    )
    .map(([leaf]) => leaf);
}

/** The schema leaves under `root` that no render in `rendered` showed and `hidden` doesn't explain. */
export function missingLeaves(
  root: t.SchemaField,
  rendered: Iterable<string>,
  hidden: HiddenFields = {},
): string[] {
  const shown = new Set(rendered);
  return schemaLeaves(root).filter((leaf) => !shown.has(leaf) && !isHidden(leaf, hidden));
}

/** Entries of `hidden` that name no field under `roots` (a renamed or removed field). */
export function staleHidden(roots: t.SchemaField[], hidden: HiddenFields): string[] {
  const paths = new Set<string>();
  const visit = (field: t.SchemaField) => {
    paths.add(field.path);
    field.children?.forEach(visit);
  };
  roots.forEach(visit);
  return Object.keys(hidden).filter((key) => !paths.has(key));
}

function syntheticFields(parentPath: string, depth: number): t.SchemaField[] {
  const groupPath = `${parentPath}.${SYNTHETIC_GROUP}`;
  return [
    {
      key: SYNTHETIC_TEXT,
      path: `${parentPath}.${SYNTHETIC_TEXT}`,
      type: 'string',
      isOptional: true,
      depth,
    },
    {
      key: SYNTHETIC_GROUP,
      path: groupPath,
      type: 'object',
      isOptional: true,
      isObject: true,
      depth,
      children: [
        {
          key: SYNTHETIC_FLAG,
          path: `${groupPath}.${SYNTHETIC_FLAG}`,
          type: 'boolean',
          isOptional: true,
          depth: depth + 1,
        },
      ],
    },
  ];
}

/** Path of the children of a field: a list's items and a record's entries add their marker. */
function childBase(field: t.SchemaField): string {
  if (field.isArray) return `${field.path}.${ARRAY_MARKER}`;
  if (field.type === 'record') return `${field.path}.${RECORD_MARKER}`;
  return field.path;
}

/**
 * A copy of `tree` where the object at `parentPath` (a schema path) also has
 * `zzNewSetting` (a string) and `zzNewGroup.zzNewFlag` (a boolean in a new
 * object), as a newer LibreChat could add them. Variant fields get them in
 * every variant.
 */
export function withSyntheticFields(tree: t.SchemaField[], parentPath: string): t.SchemaField[] {
  const target = findSchemaField(tree, parentPath);
  if (!target?.children) throw new Error(`no object at ${parentPath}`);
  const inject = (field: t.SchemaField): t.SchemaField => {
    if (field === target) {
      const added = syntheticFields(childBase(field), field.depth + 1);
      return {
        ...field,
        children: [...(field.children ?? []), ...added],
        ...(field.variants && {
          variants: field.variants.map((variant) => ({
            ...variant,
            fields: [...variant.fields, ...added],
          })),
        }),
      };
    }
    if (!field.children) return field;
    const children = field.children.map(inject);
    return children.every((child, i) => child === field.children?.[i])
      ? field
      : { ...field, children };
  };
  return tree.map(inject);
}

/**
 * Every object under `root` (itself included) a newer schema could add
 * settings to: plain objects, list items and record entries, by schema field.
 */
export function objectFields(root: t.SchemaField): t.SchemaField[] {
  const visit = (field: t.SchemaField): t.SchemaField[] =>
    field.children?.length ? [field, ...field.children.flatMap(visit)] : [];
  return visit(root);
}

/** The data path of an object field in `data`: its first list item or record entry. */
export function objectDataPath(field: t.SchemaField, data: t.ConfigValue): string {
  const [path] = dataPaths(childBase(field), data);
  if (path === undefined) throw new Error(`no data for ${field.path}`);
  return path;
}

/** Text typed into a synthetic setting. */
export const SYNTHETIC_VALUE = 'from a newer LibreChat';

/**
 * Edits the synthetic settings under the object at `dataPath` as an admin
 * would (types into `zzNewSetting`, turns `zzNewGroup.zzNewFlag` on) and
 * returns the paths Save would not write.
 */
export function editSynthetic(dataPath: string, plan: () => t.WritePlan): string[] {
  const text = `${dataPath}.${SYNTHETIC_TEXT}`;
  const flag = `${dataPath}.${SYNTHETIC_GROUP}.${SYNTHETIC_FLAG}`;
  typeInto(text, SYNTHETIC_VALUE);
  turnOn(flag);
  const written = plan();
  return [
    ...(planWrites(written, text, SYNTHETIC_VALUE) ? [] : [text]),
    ...(planWrites(written, flag, true) ? [] : [flag]),
  ];
}

/** Whether a saved write sets `path` to `value`, directly or inside a parent's value. */
export function planWrites(plan: t.WritePlan, path: string, value: t.ConfigValue): boolean {
  return plan.sets.some(({ fieldPath, value: written }) => {
    if (fieldPath === path) return written === value;
    if (!path.startsWith(`${fieldPath}.`)) return false;
    return getValueAtPath(written, path.slice(fieldPath.length + 1)) === value;
  });
}

/** The read-only "Other settings" list of keys the schema doesn't know, under a data path, if shown. */
export function unknownSettingsAt(path: string, doc: Document = document): HTMLElement | null {
  return (
    doc.getElementById(`unknown-settings-${path.replace(/\./g, '-')}`)?.closest('section') ?? null
  );
}

/** One state a coverage test renders: its configuration and what it opens once rendered. */
export interface CoverageFixture {
  name: string;
  yaml: t.ConfigRecord;
  overrides?: t.ConfigRecord;
  /** Opens what the state keeps closed (a drawer, "Show all services", a variant). */
  open?: () => void;
}

/**
 * The schema leaves under `roots` that any of `fixtures` shows: each is
 * rendered with `render`, opened, checked and unmounted in turn.
 */
export function renderedAcross(
  roots: t.SchemaField[],
  fixtures: CoverageFixture[],
  render: (fixture: CoverageFixture) => { unmount: () => void },
): Set<string> {
  const shown = new Set<string>();
  for (const fixture of fixtures) {
    const view = render(fixture);
    fixture.open?.();
    const data = mergeScopeLayer(fixture.yaml, fixture.overrides ?? {});
    for (const root of roots) {
      for (const leaf of renderedLeaves(root, data)) shown.add(leaf);
    }
    view.unmount();
  }
  return shown;
}

/** The control rendered for a data path (the element with its id, or the input inside it). */
export function controlAt(path: string, doc: Document = document): HTMLElement {
  const element = doc.getElementById(toFieldId(path));
  if (!element) throw new Error(`nothing rendered for ${path}`);
  return element;
}

/** Types `value` into the text control of a data path and leaves it, as an admin would. */
export function typeInto(path: string, value: string): HTMLElement {
  const element = controlAt(path);
  const input = element.matches('input, textarea')
    ? element
    : element.querySelector<HTMLElement>('input, textarea');
  if (!input) throw new Error(`no text input for ${path}`);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  return input;
}

/** Turns on the boolean control of a data path: a switch or checkbox, or "On" of a Default/On/Off choice. */
export function turnOn(path: string): void {
  const element = controlAt(path);
  if (element.matches('[role="switch"], [role="checkbox"], input[type="checkbox"]')) {
    fireEvent.click(element);
    return;
  }
  fireEvent.click(within(element).getByText('On'));
}

const SAMPLE_RECORD_KEY = 'sample';

/** A value of a leaf type: the first choice of an enum, union or literal, one item for a list. */
function sampleLeaf(type: string): t.ConfigValue {
  if (type === 'boolean') return true;
  if (type === 'number') return 1;
  if (type === 'record') return { [SAMPLE_RECORD_KEY]: 'value' };
  const list = /^array<(.+)>$/.exec(type);
  if (list) return [sampleLeaf(list[1])];
  const union = splitUnionTypes(type);
  if (union.length > 0) return sampleLeaf(union[0]);
  const literal = /^literal\((.+)\)$/.exec(type);
  if (literal) return JSON.parse(literal[1]) as t.ConfigValue;
  const choice = /^enum\(([^|)]+)/.exec(type)?.[1].trim();
  if (!choice) return 'sample';
  const numeric = /=(\d+)$/.exec(choice);
  return numeric ? Number(numeric[1]) : choice;
}

/**
 * A value for a field that sets every leaf under it: lists hold one item,
 * records one `sample` entry, and every variant's keys are merged.
 */
export function sampleValue(field: t.SchemaField): t.ConfigValue {
  if (!field.children?.length) return sampleLeaf(field.type);
  const entry: t.ConfigRecord = Object.fromEntries(
    field.children.map((child) => [child.key, sampleValue(child)]),
  );
  if (field.isArray) return [entry];
  if (field.type === 'record') return { [SAMPLE_RECORD_KEY]: entry };
  return entry;
}
