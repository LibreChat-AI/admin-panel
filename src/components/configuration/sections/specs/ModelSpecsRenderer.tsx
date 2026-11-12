import { useMemo } from 'react';
import type * as t from '@/types';
import { SPEC_LIST_PATH, validateSpecs } from './validation';
import { OtherSettings } from '../../renderer';
import { SpecsSettings } from './Settings';
import { useSpecOptions } from './options';
import { isConfigRecord } from '@/utils';
import { SpecList } from './List';

const NO_ITEMS: t.ConfigValue[] = [];
/** The keys "How users pick models" and the spec list edit; any other setting renders as a plain row. */
const PLACED_KEYS: ReadonlySet<string> = new Set([
  'enforce',
  'prioritize',
  'addedEndpoints',
  'list',
]);

/**
 * The Model specs tab (WS11): how users pick models (specs only, specs
 * first, endpoints first) with the endpoints listed beside the specs, then
 * the spec list and its editor. Specs are validated as the admin edits them;
 * errors show on the spec and its fields and block Save (MS-2). Settings a
 * newer schema adds render as plain rows; keys it doesn't know, read-only.
 */
export function ModelSpecsRenderer(props: t.ModelSpecsRendererProps) {
  const { fields, parentValue, getValue } = props;
  const listField = fields.find((field) => field.key === 'list');
  const stored = isConfigRecord(parentValue) ? parentValue.list : undefined;
  const value = getValue(SPEC_LIST_PATH, stored ?? NO_ITEMS);
  const items = Array.isArray(value) ? value : NO_ITEMS;
  const options = useSpecOptions(items);
  const problems = useMemo(
    () => validateSpecs(items, { knownEndpoints: options.knownEndpoints }),
    [items, options.knownEndpoints],
  );

  return (
    <>
      <SpecsSettings {...props} items={items} options={options} />
      <OtherSettings {...props} placed={PLACED_KEYS} />
      {listField && (
        <SpecList
          {...props}
          listField={listField}
          items={items}
          options={options}
          problems={problems}
        />
      )}
    </>
  );
}
