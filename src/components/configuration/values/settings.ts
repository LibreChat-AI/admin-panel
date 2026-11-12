import type * as t from '@/types';
import { isConfigRecord, maskSecretValues } from '@/utils';
import { getFieldOptions } from '../controls';
import { labelForPath } from '../meta';

/** An enum value (or a list of them) as its option labels. */
export function optionLabels(
  field: t.SchemaField | undefined,
  value: t.ConfigValue,
  localize: t.LocalizeFn,
): string[] {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  const labels = new Map(
    (field ? getFieldOptions(field, localize) : []).map((option) => [option.value, option.label]),
  );
  return values.map((item) => labels.get(String(item)) ?? String(item));
}

function scalarText(
  field: t.SchemaField | undefined,
  value: t.ConfigValue,
  localize: t.LocalizeFn,
): string {
  if (typeof value === 'boolean') {
    return localize(value ? 'com_config_values_on' : 'com_config_values_off');
  }
  return optionLabels(field, value, localize).join(', ');
}

/** A list's items by label, id or name (custom patterns), else as text. */
function listText(
  field: t.SchemaField | undefined,
  value: t.ConfigValue[],
  localize: t.LocalizeFn,
): string {
  if (!value.every(isConfigRecord)) return scalarText(field, value, localize);
  return value
    .map((item) => String(item.label ?? item.id ?? item.name ?? JSON.stringify(item)))
    .join(', ');
}

/**
 * The settings of `source` (an object whose schema fields are `children`) as
 * read-only label/value rows in schema order:
 * nested objects are flattened ("Group › Setting"), lists of objects named by
 * their items, credentials masked, and keys the schema doesn't know (a newer
 * LibreChat) follow under their own key, so a summary never drops a setting.
 */
export function settingRows(
  children: readonly t.SchemaField[],
  source: t.ConfigRecord,
  localize: t.LocalizeFn,
  { path, skip, prefix = '' }: t.SettingRowsOptions,
): t.SettingRow[] {
  const known = new Set(children.map((child) => child.key));
  const entries: Array<[string, t.SchemaField | undefined]> = [
    ...children.map((child): [string, t.SchemaField] => [child.key, child]),
    ...Object.keys(source)
      .filter((key) => !known.has(key))
      .map((key): [string, undefined] => [key, undefined]),
  ];
  return entries.flatMap(([key, child]) => {
    const childValue = maskSecretValues(source[key], key);
    if (skip?.has(key) || childValue == null) return [];
    const childPath = `${path}.${key}`;
    const name = child ? labelForPath(child.path, localize) : key;
    const label = prefix ? `${prefix} › ${name}` : name;
    if (isConfigRecord(childValue)) {
      return settingRows(child?.children ?? [], childValue, localize, {
        path: childPath,
        prefix: label,
      });
    }
    const value = Array.isArray(childValue)
      ? listText(child, childValue, localize)
      : scalarText(child, childValue, localize);
    return [{ label, value, path: childPath }];
  });
}
