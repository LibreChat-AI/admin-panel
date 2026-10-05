import { Icon } from '@clickhouse/click-ui';
import { memo, useRef, useMemo, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { YAML_LOCKED_FIELDS, INSPECTOR_DERIVED } from './mcpFieldMeta';
import { useCollapsibleSection } from '../useCollapsibleSection';
import { ObjectEntryCard } from '../fields/ObjectEntryCard';
import { renderCollapsible } from '../renderCollapsible';
import { renderInlineField } from '../FieldRenderer';
import { SelectField } from '../fields/SelectField';
import { FormDialog } from '@/components/shared';
import { cn, isUnsafeConfigKey } from '@/utils';
import { useLocalize } from '@/hooks';

const TRANSPORT_FIELDS: Record<string, string[]> = {
  stdio: ['command', 'args', 'env', 'stderr'],
  sse: ['url', 'headers'],
  'streamable-http': ['url', 'headers'],
  http: ['url', 'headers'],
  websocket: ['url'],
};

const ALL_TRANSPORT_KEYS = new Set(Object.values(TRANSPORT_FIELDS).flat());
const REMOTE_ONLY_FIELDS = new Set(['requiresOAuth', 'apiKey', 'oauth', 'oauth_headers']);
const REMOTE_TRANSPORTS = new Set(['sse', 'streamable-http', 'http', 'websocket']);
const HTTP_ONLY_FIELDS = new Set(['obo', 'proxy']);
const HTTP_TRANSPORTS = new Set(['sse', 'streamable-http', 'http']);

const REQUIRED_BY_TRANSPORT: Record<string, Set<string>> = {
  stdio: new Set(['command', 'args']),
  sse: new Set(['url']),
  'streamable-http': new Set(['url']),
  http: new Set(['url']),
  websocket: new Set(['url']),
};

const TRANSPORT_TYPE_OPTIONS: { label: string; value: string }[] = [
  { label: 'streamable-http', value: 'streamable-http' },
  { label: 'sse', value: 'sse' },
  { label: 'stdio', value: 'stdio' },
  { label: 'websocket', value: 'websocket' },
];

const ALWAYS_REQUIRED = new Set(['type']);

/** Stable empty record used as the fallback for `baseRecord`/`parentValue` when no data is available, so the downstream `useMemo` chain on `editsByEntry`/`record` does not re-fire on every render with a fresh `{}` literal. */
const EMPTY_RECORD: Record<string, t.ConfigValue> = Object.freeze({}) as Record<
  string,
  t.ConfigValue
>;

/**
 * YAML configs can omit `type` because each transport schema (except
 * streamable-http) defaults from the discriminating fields. Mirror the
 * backend's Zod union resolution order so the UI shows the effective type.
 */
function inferTransportType(values: Record<string, t.ConfigValue>): string {
  if (typeof values.type === 'string' && values.type) return values.type;
  if (typeof values.command === 'string' && values.command) return 'stdio';
  if (typeof values.url === 'string' && values.url) {
    try {
      const protocol = new URL(values.url).protocol;
      if (protocol === 'ws:' || protocol === 'wss:') return 'websocket';
    } catch {
      /* fall through */
    }
    return 'sse';
  }
  return '';
}

function withFieldOverrides(field: t.SchemaField, transportType: string): t.SchemaField {
  if (ALWAYS_REQUIRED.has(field.key)) {
    return { ...field, isOptional: false };
  }
  const transportRequired = REQUIRED_BY_TRANSPORT[transportType];
  if (transportRequired?.has(field.key)) {
    return { ...field, isOptional: false };
  }
  return field;
}

function setLeaf(
  target: Record<string, t.ConfigValue>,
  segments: string[],
  value: t.ConfigValue,
): void {
  let cursor: Record<string, t.ConfigValue> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!isPlainObject(cursor[seg])) cursor[seg] = {};
    cursor = cursor[seg] as Record<string, t.ConfigValue>;
  }
  const leaf = segments[segments.length - 1];
  if (value === undefined) delete cursor[leaf];
  else cursor[leaf] = value;
}

function applyLeafOverlay(
  base: Record<string, t.ConfigValue>,
  leafEdits: Array<[string[], t.ConfigValue]>,
): Record<string, t.ConfigValue> {
  const cloned = deepClone(base);
  for (const [segments, value] of leafEdits) {
    setLeaf(cloned, segments, value);
  }
  return cloned;
}

function deepClone(value: Record<string, t.ConfigValue>): Record<string, t.ConfigValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, t.ConfigValue>;
}

function isPlainObject(value: t.ConfigValue): value is Record<string, t.ConfigValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** New entry names are blocked from containing dots, but legacy data may still hold dotted server names; longest-prefix match against known keys keeps those edits attributed to the real entry instead of carving off the first segment. */
function resolveEntryKey(
  rest: string,
  knownKeys: Iterable<string>,
): { entryKey: string; segments: string[] } | null {
  if (rest === '') return null;
  let best: string | null = null;
  for (const key of knownKeys) {
    if (rest === key || rest.startsWith(`${key}.`)) {
      if (best === null || key.length > best.length) best = key;
    }
  }
  if (best !== null) {
    const remainder = rest.length > best.length ? rest.slice(best.length + 1) : '';
    return { entryKey: best, segments: remainder === '' ? [] : remainder.split('.') };
  }
  const dotIdx = rest.indexOf('.');
  if (dotIdx === -1) return { entryKey: rest, segments: [] };
  return { entryKey: rest.slice(0, dotIdx), segments: rest.slice(dotIdx + 1).split('.') };
}

function enumerateLeafPaths(
  obj: Record<string, t.ConfigValue>,
  prefix: string[] = [],
  seen: WeakSet<object> = new WeakSet(),
): Array<{ segments: string[]; value: t.ConfigValue }> {
  if (seen.has(obj)) return [];
  seen.add(obj);
  const out: Array<{ segments: string[]; value: t.ConfigValue }> = [];
  for (const [k, v] of Object.entries(obj)) {
    const next = [...prefix, k];
    if (isPlainObject(v)) {
      out.push(...enumerateLeafPaths(v, next, seen));
    } else {
      out.push({ segments: next, value: v });
    }
  }
  return out;
}

interface FieldGroupDef {
  labelKey: string;
  fields: string[];
  defaultExpanded: boolean;
  children?: FieldGroupDef[];
}

const MCP_FIELD_GROUPS: FieldGroupDef[] = [
  {
    labelKey: 'com_config_group_connection',
    fields: ['type', 'url', 'command', 'args', 'headers', 'env', 'stderr', 'requiresOAuth'],
    defaultExpanded: true,
  },
  {
    labelKey: 'com_config_group_authentication',
    fields: [],
    defaultExpanded: false,
    children: [
      {
        labelKey: 'com_config_group_api_key',
        fields: ['apiKey'],
        defaultExpanded: true,
      },
      {
        labelKey: 'com_config_group_oauth',
        fields: ['oauth', 'oauth_headers'],
        defaultExpanded: false,
      },
    ],
  },
  {
    labelKey: 'com_config_group_server_options',
    fields: [
      'title',
      'description',
      'startup',
      'chatMenu',
      'serverInstructions',
      'timeout',
      'sseReadTimeout',
      'initTimeout',
      'iconPath',
    ],
    defaultExpanded: false,
  },
];

function flattenGroupFields(
  fields: t.SchemaField[],
  parentValue: t.ConfigValue,
  parentPath: string,
  onChange: (path: string, value: t.ConfigValue) => void,
  localize: (key: string, interpolation?: Record<string, string | number>) => string,
  transportType: string,
  disabled?: boolean,
  collectionRenderOverrides?: Record<string, t.CollectionRenderFields>,
  lockedKeys?: Set<string>,
): ReactNode[] {
  const values = isPlainObject(parentValue) ? parentValue : {};

  const nodes: ReactNode[] = [];
  for (const field of fields) {
    const fieldDisabled = disabled || (lockedKeys?.has(field.key) ?? false);
    if (field.key === 'type') {
      const fieldId = `${parentPath}-${field.key}`;
      const label = localize(`com_config_field_${field.key}`);
      const explicitValue = typeof values.type === 'string' ? values.type : '';
      const rawValue = explicitValue || inferTransportType(values);
      const displayValue = rawValue === 'http' ? 'streamable-http' : rawValue;
      nodes.push(
        <div key={field.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <label
            htmlFor={fieldId}
            className="shrink-0 text-sm font-medium text-(--cui-color-text-default) sm:w-35"
          >
            {label}
            <span className="ml-0.5 text-(--cui-color-text-danger)">*</span>
          </label>
          <div className="flex-1">
            <SelectField
              id={fieldId}
              value={displayValue}
              options={TRANSPORT_TYPE_OPTIONS}
              onChange={(v) => onChange(field.key, v)}
              disabled={fieldDisabled}
              aria-label={label}
            />
          </div>
        </div>,
      );
      continue;
    }

    if (field.children && field.children.length > 0 && !field.isArray && field.type !== 'record') {
      const nested = values[field.key];
      const nestedObj = isPlainObject(nested) ? nested : {};
      for (const child of field.children) {
        nodes.push(
          renderInlineField(
            withFieldOverrides(child, transportType),
            nested,
            `${parentPath}.${field.key}`,
            (childKey, childValue) => {
              onChange(field.key, { ...nestedObj, [childKey]: childValue });
            },
            localize,
            fieldDisabled,
            collectionRenderOverrides,
            true,
          ),
        );
      }
    } else {
      nodes.push(
        renderInlineField(
          withFieldOverrides(field, transportType),
          parentValue,
          parentPath,
          onChange,
          localize,
          fieldDisabled,
          collectionRenderOverrides,
          true,
        ),
      );
    }
  }
  return nodes;
}

function FieldGroupSection({
  labelKey,
  defaultExpanded,
  children,
}: {
  labelKey: string;
  defaultExpanded: boolean;
  children: ReactNode;
}) {
  const localize = useLocalize();
  const { isExpanded, hasEverExpanded, sectionRef, toggle } = useCollapsibleSection({
    defaultExpanded,
  });

  return (
    <section ref={sectionRef} className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default) pb-2">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={toggle}
          className="flex cursor-pointer items-center gap-2 border-none bg-transparent px-0 select-none"
        >
          <span
            className={cn(
              'flex shrink-0 items-center justify-center transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          >
            <Icon name="chevron-right" size="xs" />
          </span>
          <span className="text-xs font-medium text-(--cui-color-text-muted)">
            {localize(labelKey)}
          </span>
        </button>
      </div>
      {renderCollapsible(
        isExpanded,
        hasEverExpanded,
        <div className="flex flex-col gap-4 pt-2 pl-3">{children}</div>,
      )}
    </section>
  );
}

function FieldGroup({
  labelKey,
  fields,
  parentValue,
  parentPath,
  onChange,
  disabled,
  defaultExpanded,
  transportType,
  lockedKeys,
}: {
  labelKey: string;
  fields: t.SchemaField[];
  parentValue: t.ConfigValue;
  parentPath: string;
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  defaultExpanded: boolean;
  transportType: string;
  lockedKeys?: Set<string>;
}) {
  const localize = useLocalize();
  const { isExpanded, hasEverExpanded, sectionRef, toggle } = useCollapsibleSection({
    defaultExpanded,
  });

  if (fields.length === 0) return null;

  return (
    <section ref={sectionRef} className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default) pb-2">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={toggle}
          className="flex cursor-pointer items-center gap-2 border-none bg-transparent px-0 select-none"
        >
          <span
            className={cn(
              'flex shrink-0 items-center justify-center transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          >
            <Icon name="chevron-right" size="xs" />
          </span>
          <span className="text-xs font-medium text-(--cui-color-text-muted)">
            {localize(labelKey)}
          </span>
        </button>
      </div>
      {renderCollapsible(
        isExpanded,
        hasEverExpanded,
        <div className="flex flex-col gap-3 pt-1">
          {flattenGroupFields(
            fields,
            parentValue,
            parentPath,
            onChange,
            localize,
            transportType,
            disabled,
            undefined,
            lockedKeys,
          )}
        </div>,
      )}
    </section>
  );
}

function McpEntryFields({
  fields,
  parentValue,
  parentPath,
  onChange,
  disabled,
  lockedKeys,
}: {
  fields: t.SchemaField[];
  parentValue: t.ConfigValue;
  parentPath: string;
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  lockedKeys?: Set<string>;
}) {
  const localize = useLocalize();
  const values = isPlainObject(parentValue) ? parentValue : {};
  const explicitType = typeof values.type === 'string' ? values.type : '';
  const currentType = explicitType || inferTransportType(values);

  const currentTransportFields = new Set(TRANSPORT_FIELDS[currentType] ?? []);
  const isRemote = REMOTE_TRANSPORTS.has(currentType);
  const visibleKeys = new Set<string>();
  for (const field of fields) {
    if (INSPECTOR_DERIVED.has(field.key)) continue;
    if (ALL_TRANSPORT_KEYS.has(field.key)) {
      if (currentTransportFields.has(field.key)) {
        visibleKeys.add(field.key);
      }
    } else if (HTTP_ONLY_FIELDS.has(field.key)) {
      if (HTTP_TRANSPORTS.has(currentType)) {
        visibleKeys.add(field.key);
      }
    } else if (REMOTE_ONLY_FIELDS.has(field.key)) {
      if (isRemote) {
        visibleKeys.add(field.key);
      }
    } else {
      visibleKeys.add(field.key);
    }
  }

  const fieldsByKey = new Map(fields.map((f) => [f.key, f]));
  const collectGroupKeys = (groups: FieldGroupDef[]): string[] =>
    groups.flatMap((g) => [...g.fields, ...(g.children ? collectGroupKeys(g.children) : [])]);
  const allGroupedKeys = new Set(collectGroupKeys(MCP_FIELD_GROUPS));
  const ungrouped = fields.filter((f) => !allGroupedKeys.has(f.key) && visibleKeys.has(f.key));

  const resolveFields = (keys: string[]) =>
    keys
      .map((key) => fieldsByKey.get(key))
      .filter((f): f is t.SchemaField => f != null && visibleKeys.has(f.key));

  const renderGroup = (group: FieldGroupDef) => {
    const hasChildren = group.children && group.children.length > 0;
    const groupFields = resolveFields(group.fields);

    if (hasChildren) {
      const childGroups = group.children!.filter((child) => resolveFields(child.fields).length > 0);
      if (childGroups.length === 0 && groupFields.length === 0) return null;
      return (
        <FieldGroupSection
          key={group.labelKey}
          labelKey={group.labelKey}
          defaultExpanded={group.defaultExpanded}
        >
          {groupFields.length > 0 && (
            <div className="flex flex-col gap-3">
              {flattenGroupFields(
                groupFields,
                parentValue,
                parentPath,
                onChange,
                localize,
                currentType,
                disabled,
                undefined,
                lockedKeys,
              )}
            </div>
          )}
          {childGroups.map((child) => (
            <FieldGroup
              key={child.labelKey}
              labelKey={child.labelKey}
              fields={resolveFields(child.fields)}
              parentValue={parentValue}
              parentPath={parentPath}
              onChange={onChange}
              disabled={disabled}
              defaultExpanded={child.defaultExpanded}
              transportType={currentType}
              lockedKeys={lockedKeys}
            />
          ))}
        </FieldGroupSection>
      );
    }

    return (
      <FieldGroup
        key={group.labelKey}
        labelKey={group.labelKey}
        fields={groupFields}
        parentValue={parentValue}
        parentPath={parentPath}
        onChange={onChange}
        disabled={disabled}
        defaultExpanded={group.defaultExpanded}
        transportType={currentType}
        lockedKeys={lockedKeys}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {MCP_FIELD_GROUPS.map(renderGroup)}
      {ungrouped.length > 0 && (
        <FieldGroup
          labelKey="com_config_group_advanced"
          fields={ungrouped}
          parentValue={parentValue}
          parentPath={parentPath}
          onChange={onChange}
          disabled={disabled}
          defaultExpanded={false}
          transportType={currentType}
          lockedKeys={lockedKeys}
        />
      )}
    </div>
  );
}

function CreateMcpServerDialog({
  open,
  onClose,
  onSave,
  fields,
  existingKeys,
  renderFields,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (serverName: string, entry: Record<string, t.ConfigValue>) => void;
  fields: t.SchemaField[];
  existingKeys: Set<string>;
  renderFields: t.CollectionRenderFields;
}) {
  const localize = useLocalize();
  const [serverName, setServerName] = useState('');
  const [draft, setDraft] = useState<Record<string, t.ConfigValue>>({});
  const [error, setError] = useState<string | undefined>();

  const handleFieldChange = useCallback((key: string, value: t.ConfigValue) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError(undefined);
  }, []);

  const handleSubmit = useCallback(() => {
    const name = serverName.trim();
    if (!name) {
      setError(localize('com_config_server_name_required'));
      return;
    }
    if (isUnsafeConfigKey(name)) {
      setError(localize('com_config_server_name_no_dots'));
      return;
    }
    if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
      setError(localize('com_config_server_name_invalid'));
      return;
    }
    if (existingKeys.has(name)) {
      setError(localize('com_config_server_name_exists'));
      return;
    }
    const entry: Record<string, t.ConfigValue> = {};
    for (const [key, val] of Object.entries(draft)) {
      if (val === '' || val === undefined || val === null) continue;
      entry[key] = val;
    }
    /** Per-leaf saves bypass whole-object Zod validation, so a partial create (e.g. transport `sse` with no url) would persist as an invalid server. Validate transport-specific required fields here while we still hold the dialog draft. An empty array is a valid Zod value for required array fields like stdio `args` (the schema requires presence but accepts `[]`), so do not flag it as missing. */
    const rawType = typeof entry.type === 'string' ? entry.type : '';
    const transportType = rawType || inferTransportType(entry);
    const normalizedTransport = transportType === 'http' ? 'streamable-http' : transportType;
    const required = REQUIRED_BY_TRANSPORT[normalizedTransport];
    if (required) {
      for (const field of required) {
        const val = entry[field];
        const missing = val === undefined || val === null || val === '';
        if (missing) {
          setError(localize('com_config_server_missing_required', { field }));
          return;
        }
      }
    }
    onSave(name, entry);
    setServerName('');
    setDraft({});
    setError(undefined);
    onClose();
  }, [serverName, draft, existingKeys, localize, onSave, onClose]);

  const handleClose = useCallback(() => {
    setServerName('');
    setDraft({});
    setError(undefined);
    onClose();
  }, [onClose]);

  return (
    <FormDialog
      open={open}
      title={localize('com_config_create_mcp_server')}
      submitLabel={localize('com_ui_create')}
      submitDisabled={!serverName.trim() || !(draft.type || inferTransportType(draft))}
      saving={false}
      error={error}
      size="lg"
      onSubmit={handleSubmit}
      onClose={handleClose}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="mcp-server-name"
            className="text-sm font-medium text-(--cui-color-text-default)"
          >
            {localize('com_config_server_name')} <span className="text-red-500">*</span>
          </label>
          <input
            id="mcp-server-name"
            type="text"
            value={serverName}
            onChange={(e) => {
              setServerName(e.target.value);
              setError(undefined);
            }}
            placeholder={localize('com_config_server_name')}
            className="config-input px-2.5 py-1.5 text-sm"
            autoFocus
          />
        </div>
        {renderFields(fields, draft, 'create-mcp-server', handleFieldChange)}
      </div>
    </FormDialog>
  );
}

export function McpServersRenderer(props: t.FieldRendererProps) {
  const {
    fields,
    parentPath,
    parentValue,
    getValue,
    onChange,
    disabled,
    editedValues,
    yamlBaseKeys,
    isEditingScope,
    onValidationError,
  } = props;
  const localize = useLocalize();
  const [createOpen, setCreateOpen] = useState(false);
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  const path = parentPath;
  const entryPrefix = `${path}.`;
  const baseValue = getValue(path, parentValue ?? EMPTY_RECORD);
  const baseRecord: Record<string, t.ConfigValue> = isPlainObject(baseValue)
    ? baseValue
    : EMPTY_RECORD;

  const editsByEntry = useMemo(() => {
    const map = new Map<string, Array<{ segments: string[]; value: t.ConfigValue }>>();
    if (!editedValues) return map;
    const knownKeys = Object.keys(baseRecord);
    for (const [editPath, value] of Object.entries(editedValues)) {
      if (!editPath.startsWith(entryPrefix)) continue;
      const rest = editPath.slice(entryPrefix.length);
      const parsed = resolveEntryKey(rest, knownKeys);
      if (!parsed) continue;
      const list = map.get(parsed.entryKey) ?? [];
      list.push({ segments: parsed.segments, value });
      map.set(parsed.entryKey, list);
    }
    return map;
  }, [editedValues, entryPrefix, baseRecord]);

  const record = useMemo(() => {
    if (editsByEntry.size === 0) return baseRecord;
    const result: Record<string, t.ConfigValue> = {};
    /** Resolves a single entry's overlay value or `undefined` when the entry should drop out. Iterates edits in insertion order so a whole-entry delete followed by recreating per-leaf writes shows the new entry, not the deleted one. The seed is the most recent whole-entry write (`undefined` becomes an empty object so subsequent leaves attach to it); without a whole-entry write the seed is the baseRecord entry. */
    const resolveEntryValue = (
      entryKey: string,
      leafEdits: Array<{ segments: string[]; value: t.ConfigValue }>,
    ): t.ConfigValue | undefined => {
      let seed: t.ConfigValue | undefined = baseRecord[entryKey];
      let seedFromDelete = false;
      let seedIndex = -1;
      for (let i = 0; i < leafEdits.length; i++) {
        const edit = leafEdits[i];
        if (edit.segments.length === 0) {
          if (edit.value === undefined) {
            seed = {};
            seedFromDelete = true;
          } else {
            seed = edit.value;
            seedFromDelete = false;
          }
          seedIndex = i;
        }
      }
      const subsequentLeaves = leafEdits.slice(seedIndex + 1).filter((e) => e.segments.length > 0);
      if (subsequentLeaves.length === 0) {
        return seedFromDelete ? undefined : seed;
      }
      const existingObj = isPlainObject(seed) ? seed : {};
      return applyLeafOverlay(
        existingObj,
        subsequentLeaves.map((e) => [e.segments, e.value] as [string[], t.ConfigValue]),
      );
    };

    /** Walk baseRecord first so edited entries keep their original position in the list instead of jumping to the bottom. */
    for (const [k, v] of Object.entries(baseRecord)) {
      const leafEdits = editsByEntry.get(k);
      if (!leafEdits) {
        result[k] = v;
        continue;
      }
      const resolved = resolveEntryValue(k, leafEdits);
      if (resolved !== undefined) result[k] = resolved;
    }
    /** Newly-created entries appear in editsByEntry insertion order at the bottom. */
    for (const [entryKey, leafEdits] of editsByEntry) {
      if (entryKey in baseRecord) continue;
      const resolved = resolveEntryValue(entryKey, leafEdits);
      if (resolved !== undefined) result[entryKey] = resolved;
    }
    return result;
  }, [baseRecord, editsByEntry]);

  const entries = useMemo(() => Object.entries(record), [record]);

  const existingKeys = useMemo(() => new Set(Object.keys(record)), [record]);

  /**
   * Fall back to an empty set when the backend predates ?baseOnly support, so
   * nothing is locked rather than falling back to a subtraction heuristic that
   * produces false positives on YAML servers with admin overrides.
   */
  const yamlSourceKeys = useMemo(() => {
    return yamlBaseKeys ?? new Set<string>();
  }, [yamlBaseKeys]);

  /** Refs keep the callbacks referentially stable so memo(McpEntryRow) can bail. */
  const editedValuesRef = useRef(editedValues);
  useEffect(() => {
    editedValuesRef.current = editedValues;
  }, [editedValues]);

  const baseRecordRef = useRef(baseRecord);
  useEffect(() => {
    baseRecordRef.current = baseRecord;
  }, [baseRecord]);

  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  /** ConfigPage passes a fresh inline arrow each render for onValidationError, and useLocalize returns a new function reference each render too; without these refs the create/rename callbacks below would change identity every render and defeat the memo on McpEntryRow. */
  const onValidationErrorRef = useRef(onValidationError);
  useEffect(() => {
    onValidationErrorRef.current = onValidationError;
  }, [onValidationError]);

  const localizeRef = useRef(localize);
  useEffect(() => {
    localizeRef.current = localize;
  }, [localize]);

  const handleCreate = useCallback(
    (serverName: string, entry: Record<string, t.ConfigValue>) => {
      if (isUnsafeConfigKey(serverName)) {
        onValidationErrorRef.current?.(localizeRef.current('com_config_server_name_no_dots'));
        return;
      }
      if (
        serverName === '__proto__' ||
        serverName === 'constructor' ||
        serverName === 'prototype'
      ) {
        onValidationErrorRef.current?.(localizeRef.current('com_config_server_name_invalid'));
        return;
      }
      /** Empty arrays are valid Zod values for required array fields (e.g. stdio `args: []`); skipping them here would drop the per-leaf write and leave the entry incomplete, failing the cross-field check at save time. Only undefined / null / empty string get filtered, matching what the dialog draft-trim already does. */
      for (const [fieldKey, fieldValue] of Object.entries(entry)) {
        if (fieldValue === undefined || fieldValue === null) continue;
        if (fieldValue === '') continue;
        if (isPlainObject(fieldValue)) {
          for (const { segments, value } of enumerateLeafPaths(fieldValue, [fieldKey])) {
            if (value === undefined || value === null || value === '') continue;
            onChange(`${path}.${serverName}.${segments.join('.')}`, value);
          }
        } else {
          onChange(`${path}.${serverName}.${fieldKey}`, fieldValue);
        }
      }
      setJustAddedKey(serverName);
    },
    [onChange, path],
  );

  const handleRemove = useCallback(
    (key: string) => {
      /** Dotted entry names cannot survive the per-leaf save path; the row hides the trash button for them, this is defense-in-depth so no programmatic caller can corrupt sibling subtrees by emitting `mcpServers.<dotted>.<...>` writes. */
      if (key.includes('.')) return;
      const editedValues = editedValuesRef.current;
      const baseRecord = baseRecordRef.current;
      const prefix = `${path}.${key}.`;
      const entryPath = `${path}.${key}`;
      const seen = new Set<string>();
      if (editedValues) {
        for (const editPath of Object.keys(editedValues)) {
          if (editPath.startsWith(prefix) || editPath === entryPath) {
            onChange(editPath, undefined);
            seen.add(editPath);
          }
        }
      }
      const baseEntry = baseRecord[key];
      if (isPlainObject(baseEntry)) {
        for (const { segments } of enumerateLeafPaths(baseEntry)) {
          const leafPath = `${prefix}${segments.join('.')}`;
          if (!seen.has(leafPath)) onChange(leafPath, undefined);
        }
      }
      /** Entry-path delete is needed to make MongoDB's $unset collapse the subtree; per-leaf $unset alone leaves an empty parent that refetches as a phantom entry. */
      if (!seen.has(entryPath)) {
        onChange(entryPath, undefined);
      }
    },
    [onChange, path],
  );

  const handleRename = useCallback(
    (oldKey: string, newKey: string) => {
      if (newKey === oldKey) {
        return;
      }
      /** Same dotted-key reasoning as handleRemove; defense-in-depth even though the row hides the rename pencil. */
      if (oldKey.includes('.')) return;
      const editedValues = editedValuesRef.current;
      const baseRecord = baseRecordRef.current;
      const record = recordRef.current;
      if (isUnsafeConfigKey(newKey)) {
        onValidationErrorRef.current?.(localizeRef.current('com_config_server_name_no_dots'));
        return;
      }
      if (newKey === '__proto__' || newKey === 'constructor' || newKey === 'prototype') {
        onValidationErrorRef.current?.(localizeRef.current('com_config_server_name_invalid'));
        return;
      }
      if (Object.hasOwn(record, newKey)) {
        onValidationErrorRef.current?.(localizeRef.current('com_config_server_name_exists'));
        return;
      }
      const oldPrefixFull = `${path}.${oldKey}`;
      if (editedValues) {
        for (const editPath of Object.keys(editedValues)) {
          if (editPath === oldPrefixFull || editPath.startsWith(`${oldPrefixFull}.`)) {
            onChange(editPath, undefined);
          }
        }
      }
      const oldPrefix = `${path}.${oldKey}.`;
      const newPrefix = `${path}.${newKey}.`;
      const baseEntry = baseRecord[oldKey];
      const overlayEntry = record[oldKey];

      /** Walk overlay AND base: overlay holds in-flight edits, base catches leaves the overlay has already deleted so their old paths still get undefined-cleanup writes. */
      const baseLeaves = isPlainObject(baseEntry) ? enumerateLeafPaths(baseEntry) : [];
      const overlayLeaves = isPlainObject(overlayEntry) ? enumerateLeafPaths(overlayEntry) : [];

      const overlayBySeg = new Map<string, t.ConfigValue>();
      for (const { segments, value } of overlayLeaves) {
        overlayBySeg.set(segments.join('.'), value);
      }
      const allSegKeys = new Set<string>([
        ...overlayBySeg.keys(),
        ...baseLeaves.map((l) => l.segments.join('.')),
      ]);

      for (const segKey of allSegKeys) {
        const segments = segKey.split('.');
        if (overlayBySeg.has(segKey)) {
          onChange(`${newPrefix}${segments.join('.')}`, overlayBySeg.get(segKey));
        }
        onChange(`${oldPrefix}${segments.join('.')}`, undefined);
      }
      /** See $unset note in handleRemove. */
      onChange(`${path}.${oldKey}`, undefined);
    },
    [onChange, path],
  );

  const isEmpty = entries.length === 0;

  return (
    <div className="flex flex-col gap-2">
      {!disabled && (
        <div className="flex items-center gap-3 py-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="config-add-btn"
          >
            <Icon name="plus" size="sm" />
            <span>{localize('com_config_create_mcp_server')}</span>
          </button>
        </div>
      )}
      {disabled && isEmpty && (
        <div className="py-3 text-sm text-(--cui-color-text-muted)">
          {localize('com_config_no_mcp_servers')}
        </div>
      )}
      {entries.map(([key, entryValue]) => (
        <McpEntryRow
          key={key}
          entryKey={key}
          entryValue={entryValue}
          fields={fields}
          path={path}
          disabled={disabled}
          isEditingScope={!!isEditingScope}
          isYamlSource={yamlSourceKeys.has(key)}
          onChange={onChange}
          onRemove={handleRemove}
          onRename={handleRename}
          justAdded={key === justAddedKey}
        />
      ))}
      {!disabled && entries.length === 0 && (
        <p className="py-2 text-sm text-(--cui-color-text-muted)">
          {localize('com_config_no_entries')}
        </p>
      )}
      <CreateMcpServerDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleCreate}
        fields={fields}
        existingKeys={existingKeys}
        renderFields={(entryFields, ev, ep, eoc) => (
          <McpEntryFields
            fields={entryFields}
            parentValue={ev}
            parentPath={ep}
            onChange={eoc}
            disabled={disabled}
          />
        )}
      />
    </div>
  );
}

const McpEntryRow = memo(function McpEntryRowImpl({
  entryKey,
  entryValue,
  fields,
  path,
  disabled,
  isEditingScope,
  isYamlSource,
  onChange,
  onRemove,
  onRename,
  justAdded,
}: {
  entryKey: string;
  entryValue: t.ConfigValue;
  fields: t.SchemaField[];
  path: string;
  disabled?: boolean;
  isEditingScope: boolean;
  isYamlSource: boolean;
  onChange: (path: string, value: t.ConfigValue) => void;
  onRemove: (key: string) => void;
  onRename: (oldKey: string, newKey: string) => void;
  justAdded: boolean;
}) {
  const entryObj = isPlainObject(entryValue) ? entryValue : {};
  const rawType = typeof entryObj.type === 'string' ? entryObj.type : '';
  const inferred = rawType || inferTransportType(entryObj);
  const effectiveType = inferred === 'http' ? 'streamable-http' : inferred;
  const displayValue =
    effectiveType !== rawType ? { ...entryObj, type: effectiveType } : entryValue;

  const entryPathBase = `${path}.${entryKey}`;
  /** Dotted entry names predate the dot-rejecting create/rename validators; the save endpoint parses fieldPath as dot-delimited so any per-leaf write under such a key collides with a parallel "legacy" → "dotted" nested-object interpretation. Render them read-only so they stay visible in the list but never round-trip through the per-field save API. */
  const isDottedLegacy = entryKey.includes('.');
  const isReadOnly = !!disabled || isDottedLegacy;
  const isLockedIdentity = (!isEditingScope && isYamlSource) || isDottedLegacy;
  const lockedKeys = isYamlSource && !isDottedLegacy ? YAML_LOCKED_FIELDS : undefined;

  const entryOnChange = useCallback(
    (leafKey: string, leafValue: t.ConfigValue) => {
      if (isDottedLegacy) return;
      onChange(`${entryPathBase}.${leafKey}`, leafValue);
    },
    [onChange, entryPathBase, isDottedLegacy],
  );

  const renderEntryFields: t.CollectionRenderFields = useCallback(
    (entryFields, ev, ep) => (
      <McpEntryFields
        fields={entryFields}
        parentValue={ev}
        parentPath={ep}
        onChange={entryOnChange}
        disabled={isReadOnly}
        lockedKeys={lockedKeys}
      />
    ),
    [entryOnChange, isReadOnly, lockedKeys],
  );

  /** Required by ObjectEntryCard's onValueChange contract; unused on leaf edits. */
  const handleWholeEntryChange = useCallback(
    (v: t.ConfigValue) => {
      if (isDottedLegacy) return;
      onChange(entryPathBase, v);
    },
    [onChange, entryPathBase, isDottedLegacy],
  );

  return (
    <ObjectEntryCard
      id={`section-mcpServers-${encodeURIComponent(entryKey)}`}
      entryKey={entryKey}
      fields={fields}
      value={displayValue}
      onValueChange={handleWholeEntryChange}
      onRemove={isReadOnly || isLockedIdentity ? undefined : () => onRemove(entryKey)}
      onRename={
        isReadOnly || isLockedIdentity ? undefined : (renamed) => onRename(entryKey, renamed)
      }
      disabled={isReadOnly}
      defaultExpanded={justAdded}
      renderFields={renderEntryFields}
    />
  );
});

function lookupLeaf(obj: unknown, segments: string[]): t.ConfigValue | undefined {
  let cursor: unknown = obj;
  for (const seg of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor as t.ConfigValue | undefined;
}

/** Merges leaf edits onto the baseline MCP entries (omitting deleted entries) so callers can validate the post-save state. `resetFallback`, when provided, supplies the value that an `undefined` leaf write would reveal after the actual save (e.g. in scope mode, a leaf reset removes the scope override and exposes the inherited base value). */
function mergeMcpEdits(
  baseline: Record<string, t.ConfigValue>,
  edits: Array<[string, t.ConfigValue]>,
  resetFallback?: Record<string, t.ConfigValue>,
): Record<string, t.ConfigValue> {
  const baseEntries: Record<string, Record<string, t.ConfigValue>> = {};
  for (const [k, v] of Object.entries(baseline)) {
    if (isPlainObject(v)) baseEntries[k] = JSON.parse(JSON.stringify(v));
  }
  const knownKeys = new Set(Object.keys(baseEntries));
  const deletedEntries = new Set<string>();
  const upsertEntries: Record<string, Record<string, t.ConfigValue>> = {};

  for (const [path, value] of edits) {
    if (!path.startsWith('mcpServers.')) continue;
    const parsed = resolveEntryKey(path.slice('mcpServers.'.length), knownKeys);
    if (!parsed) continue;
    const { entryKey, segments } = parsed;
    knownKeys.add(entryKey);
    if (segments.length === 0) {
      if (value === undefined) {
        const fallback = resetFallback?.[entryKey];
        if (isPlainObject(fallback)) {
          upsertEntries[entryKey] = JSON.parse(JSON.stringify(fallback));
          deletedEntries.delete(entryKey);
        } else {
          deletedEntries.add(entryKey);
          delete upsertEntries[entryKey];
          delete baseEntries[entryKey];
        }
      } else if (isPlainObject(value)) {
        upsertEntries[entryKey] = JSON.parse(JSON.stringify(value));
        deletedEntries.delete(entryKey);
      }
      continue;
    }
    if (deletedEntries.has(entryKey) && value !== undefined) {
      deletedEntries.delete(entryKey);
    }
    if (!upsertEntries[entryKey]) {
      /** Clone on promote so subsequent setLeaf mutations don't bleed into baseEntries; the assembly loop relies on baseEntries staying intact for entries that never received an upsert. */
      const seed = baseEntries[entryKey];
      upsertEntries[entryKey] = seed ? deepClone(seed) : {};
    }
    if (value === undefined && resetFallback) {
      const inherited = lookupLeaf(resetFallback[entryKey], segments);
      setLeaf(upsertEntries[entryKey], segments, inherited as t.ConfigValue);
    } else {
      setLeaf(upsertEntries[entryKey], segments, value);
    }
  }

  const result: Record<string, t.ConfigValue> = {};
  for (const [k, v] of Object.entries(baseEntries)) {
    if (deletedEntries.has(k)) continue;
    if (k in upsertEntries) continue;
    result[k] = v;
  }
  for (const [k, v] of Object.entries(upsertEntries)) {
    if (deletedEntries.has(k)) continue;
    result[k] = v;
  }
  return result;
}

/** Returns a list of validation errors for affected MCP entries after applying edits, so the save flow can block invalid transport-state combinations the per-leaf PATCH cannot catch. `resetFallback` is the inherited baseline (e.g. base config in scope mode) whose values get revealed when a scope reset removes an override. */
export function validateMcpCrossField(
  baseline: Record<string, t.ConfigValue>,
  edits: Array<[string, t.ConfigValue]>,
  resetFallback?: Record<string, t.ConfigValue>,
): Array<{ entryKey: string; missingField: string }> {
  const merged = mergeMcpEdits(baseline, edits, resetFallback);
  const knownKeys = new Set(Object.keys(baseline));
  const affected = new Set<string>();
  for (const [path] of edits) {
    if (!path.startsWith('mcpServers.')) continue;
    const parsed = resolveEntryKey(path.slice('mcpServers.'.length), knownKeys);
    if (parsed) {
      knownKeys.add(parsed.entryKey);
      affected.add(parsed.entryKey);
    }
  }
  const errors: Array<{ entryKey: string; missingField: string }> = [];
  for (const entryKey of affected) {
    const entry = merged[entryKey];
    if (!isPlainObject(entry)) continue;
    const rawType = typeof entry.type === 'string' ? entry.type : '';
    /** When the user clears the field that was inferring transport on an inferred-stdio entry (no explicit `type`), `inferTransportType(entry)` collapses to '' and the validator would skip required-field checks. Fall back to the baseline's inference so a stdio-by-default server still trips the missing-command check after its discriminator gets cleared. */
    const baselineEntry = isPlainObject(baseline[entryKey])
      ? (baseline[entryKey] as Record<string, t.ConfigValue>)
      : null;
    const transportType =
      rawType ||
      inferTransportType(entry) ||
      (baselineEntry ? inferTransportType(baselineEntry) : '');
    const normalized = transportType === 'http' ? 'streamable-http' : transportType;
    const required = REQUIRED_BY_TRANSPORT[normalized];
    if (!required) continue;
    for (const field of required) {
      const v = entry[field];
      /** Empty array is a valid Zod value for required array fields like stdio `args` (the schema requires presence, not non-empty). Don't flag it as missing. */
      const missing = v === undefined || v === null || v === '';
      if (missing) {
        errors.push({ entryKey, missingField: field });
        break;
      }
    }
  }
  return errors;
}

export { YAML_LOCKED_FIELDS, INSPECTOR_DERIVED, enumerateLeafPaths };
