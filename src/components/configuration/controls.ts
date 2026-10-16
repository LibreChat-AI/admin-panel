import type * as t from '@/types';

/** The schema node for one element of an array field or one value of a record field. */
export function elementField(container: t.SchemaField, segment: string): t.SchemaField {
  const base = {
    ...container,
    path: `${container.path}.${segment}`,
    key: segment,
    isArray: false,
    recordValueType: undefined,
    recordValueKVTypes: undefined,
    recordValueAllowsPrimitive: undefined,
  };
  if (container.children?.length) {
    return { ...base, type: 'object', isObject: true, children: container.children };
  }
  if (container.isArray) {
    const itemType = getArrayItemType(container.type);
    return { ...base, type: itemType, isArray: itemType.startsWith('array'), isObject: false };
  }
  const kvTypes = container.recordValueKVTypes;
  return {
    ...base,
    type: kvTypes?.length === 1 ? kvTypes[0] : 'unknown',
    isObject: false,
    children: undefined,
  };
}

function isCollectionField(field: t.SchemaField): boolean {
  return field.isArray || field.type === 'record';
}

/**
 * Finds the schema node for a dot-path, stepping into array elements and record
 * values by index or key (`endpoints.custom.3.headers` → the custom endpoint
 * `headers` record). Returns null when the path leaves the schema.
 */
export function findSchemaField(tree: t.SchemaField[], path: string): t.SchemaField | null {
  let fields: t.SchemaField[] | undefined = tree;
  let current: t.SchemaField | null = null;
  for (const segment of path.split('.')) {
    if (current && isCollectionField(current)) {
      current = elementField(current, segment);
    } else {
      current = fields?.find((f) => f.key === segment) ?? null;
    }
    if (!current) return null;
    fields = current.children;
  }
  return current;
}

export function getControlType(field: t.SchemaField): t.ControlType {
  if (field.type === 'boolean') return 'toggle';
  if (field.type.startsWith('enum')) return 'select';
  if (field.type === 'number') return 'number';
  if (field.type === 'string' || field.type === 'any' || field.type.startsWith('literal(')) {
    return 'text';
  }
  if (field.type.startsWith('array') && field.children && field.children.length > 0)
    return 'array-object';
  if (field.type.startsWith('array')) return 'array';
  if (field.type === 'object' || field.isObject) return 'object';
  if (field.type === 'record' && field.recordValueType === 'complex') return 'record-object';
  if (field.type === 'record') return 'record';

  if (field.type.startsWith('union(')) {
    const types = splitUnionTypes(field.type);

    if (
      types.length === 2 &&
      types.includes('boolean') &&
      types.includes('object') &&
      field.children?.length
    ) {
      return 'switch-object';
    }
    if (types.length === 2 && types.includes('string') && types.includes('record')) {
      return 'text-record';
    }
    if (
      types.length === 2 &&
      types.includes('string') &&
      types.some((u) => u.startsWith('array'))
    ) {
      return 'text-record';
    }
    if (
      types.length === 2 &&
      types.some((u) => u.startsWith('array')) &&
      (types.includes('record') || types.every((u) => u.startsWith('array')))
    ) {
      return 'list-record';
    }

    if (types.every((u) => u.startsWith('literal('))) return 'select';
    if (types.some((u) => u.startsWith('enum(')) && !types.includes('string')) return 'select';
    if (types.includes('record') || types.some((u) => u.startsWith('array'))) return 'record';
    if (types.includes('string')) return 'text';
    if (types.includes('number')) return 'number';
    if (types.includes('boolean')) return 'toggle';
  }

  return 'record';
}

export function getEnumOptions(typeString: string): t.SelectOption[] {
  const enumMatch = typeString.match(/^enum\((.+)\)$/);
  if (enumMatch) {
    return enumMatch[1]
      .split('|')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .map((entry) => {
        const eqIdx = entry.indexOf('=');
        if (eqIdx !== -1) {
          const label = entry.slice(0, eqIdx);
          const value = entry.slice(eqIdx + 1);
          return {
            label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase().replace(/_/g, ' '),
            value,
          };
        }
        return {
          label: entry.charAt(0).toUpperCase() + entry.slice(1).replace(/_/g, ' '),
          value: entry,
        };
      });
  }

  if (typeString.startsWith('union(')) {
    const types = splitUnionTypes(typeString);

    for (const u of types) {
      if (u.startsWith('enum(')) {
        const opts = getEnumOptions(u);
        if (opts.length > 0) return opts;
      }
    }

    const literalValues = types
      .map((u) => u.match(/^literal\((.+)\)$/)?.[1])
      .filter((v): v is string => v != null)
      .map((v) => v.replace(/^["']|["']$/g, ''));
    if (literalValues.length > 0) {
      return literalValues.map((value) => ({
        label: value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' '),
        value,
      }));
    }
  }

  return [];
}

/** Coerces a select value to its runtime type. Numeric enum values arrive as
 *  strings from the HTML select element but the Zod schema expects numbers. */
export function coerceEnumValue(value: string): string | number {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function getArrayItemType(typeString: string): string {
  const match = typeString.match(/array<(.+)>/);
  return match ? match[1] : 'string';
}

export function isStringLikeItemType(itemType: string): boolean {
  if (itemType === 'string' || itemType === 'any' || itemType === 'unknown') return true;
  if (itemType.startsWith('enum(')) return true;
  if (itemType.startsWith('union(')) {
    const types = splitUnionTypes(itemType);
    return types.includes('string') || types.some((u) => u.startsWith('enum('));
  }
  return false;
}

const CONTROL_ORDER: Record<string, number> = {
  toggle: 0,
  'switch-object': 0,
  select: 1,
  number: 2,
  text: 3,
  'text-record': 3,
  array: 4,
  'list-record': 4,
  'array-object': 5,
  record: 5,
  'record-object': 5,
  nested: 6,
  unknown: 7,
};

export function controlSortKey(field: t.SchemaField): number {
  const control = getControlType(field);
  if (
    field.children &&
    field.children.length > 0 &&
    !field.isArray &&
    field.type !== 'record' &&
    control !== 'switch-object'
  ) {
    return CONTROL_ORDER.nested;
  }
  return CONTROL_ORDER[control] ?? CONTROL_ORDER.unknown;
}

/** Splits a `union(A | B | C)` type string into its variants. Expects the
 *  ` | ` (space-pipe-space) delimiter produced by `getZodTypeName`. Handles
 *  nested parens (e.g. `union(enum(a|b) | string)`) via depth tracking. */
export function splitUnionTypes(typeString: string): string[] {
  const inner = typeString.match(/^union\((.+)\)$/)?.[1];
  if (!inner) return [];

  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (depth === 0 && inner[i] === '|' && inner[i - 1] === ' ' && inner[i + 1] === ' ') {
      parts.push(inner.slice(start, i - 1).trim());
      start = i + 2;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts;
}
