/**
 * Custom section renderers for the `endpoints` config section.
 *
 * The endpoints schema is split across two tabs:
 *  - **Custom Endpoints** (`CustomEndpointsRenderer`): renders the `custom`
 *    array — each entry is an expandable card with field ordering and
 *    progressive disclosure. Includes a "Create Endpoint" button that opens
 *    a dialog for building new entries without inline render lag.
 *  - **AI Providers** (`ProvidersRenderer`): renders named providers
 *    (openAI, anthropic, google, …) as collapsible sections where the
 *    most-important fields are always shown first.
 *
 * Both renderers receive the full `endpoints` field list and filter to their
 * relevant subset. New fields added to the schema surface automatically.
 */

import { useMemo, useState } from 'react';
import { Icon, MultiAccordion } from '@clickhouse/click-ui';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { FieldRenderer, NestedGroup, renderInlineField } from '../FieldRenderer';
import { CreateCustomEndpointDialog } from './CreateCustomEndpointDialog';
import { useCollapsibleSection } from '../useCollapsibleSection';
import { ArrayObjectField } from '../fields/ArrayObjectField';
import { countConfigured, hasDescendant } from '../utils';
import { renderCollapsible } from '../renderCollapsible';
import { UnknownSettings } from '../UnknownSettings';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Shown at the top of every named-provider section, in this order. */
const PRIORITY_ORDER = ['disabled', 'apiKey', 'baseURL', 'models', 'name'] as const;

// ---------------------------------------------------------------------------
// Custom endpoint field groups
// ---------------------------------------------------------------------------

interface FieldGroupDef {
  labelKey: string;
  fields: string[];
  defaultExpanded: boolean;
}

/**
 * Defines how fields are grouped inside custom endpoint cards and the create
 * dialog. Fields not listed in any group are collected into a catch-all
 * "Advanced" group (collapsed by default).
 *
 * To apply this pattern to other collection types, add a new entry keyed by
 * the collection's schema parent key and define the groups.
 */
const FIELD_GROUPS: Record<string, FieldGroupDef[]> = {
  custom: [
    {
      labelKey: 'com_config_group_connection',
      fields: ['name', 'apiKey', 'baseURL', 'iconURL'],
      defaultExpanded: true,
    },
    {
      labelKey: 'com_config_group_models',
      fields: ['models', 'modelDisplayLabel'],
      defaultExpanded: true,
    },
    {
      labelKey: 'com_config_group_title_generation',
      fields: [
        'titleConvo',
        'titleModel',
        'titleMethod',
        'titlePrompt',
        'titlePromptTemplate',
        'titleEndpoint',
        'titleMessageRole',
      ],
      defaultExpanded: false,
    },
    {
      labelKey: 'com_config_group_summarization',
      fields: ['summarize', 'summaryModel'],
      defaultExpanded: false,
    },
  ],
};

/**
 * Fields that are effectively required for a functional custom endpoint.
 * The config schema uses `endpointSchema.partial()` which makes everything
 * optional at the Zod level, but these fields are needed for an endpoint
 * to actually work. We override `isOptional` for these keys so the UI
 * shows required indicators.
 */
const REQUIRED_ENDPOINT_KEYS = new Set(['name', 'apiKey', 'baseURL']);

function withRequired(field: t.SchemaField): t.SchemaField {
  if (REQUIRED_ENDPOINT_KEYS.has(field.key)) {
    return { ...field, isOptional: false };
  }
  if (field.key === 'default' && field.path?.endsWith('models.default')) {
    return { ...field, isOptional: false };
  }
  return field;
}

// ---------------------------------------------------------------------------
// Shared props type
// ---------------------------------------------------------------------------

type SharedProps = Omit<t.FieldRendererProps, 'fields' | 'parentPath'>;

// ---------------------------------------------------------------------------
// GroupedFieldRenderer — renders fields organized into collapsible groups
// ---------------------------------------------------------------------------

/**
 * Flatten a field's children into the group when the field is a nested object.
 * This prevents double-collapsible nesting (e.g. Models group > models collapsible).
 * The children are rendered with a prefixed onChange that writes back into the
 * parent object at the correct key.
 */
function flattenGroupFields(
  fields: t.SchemaField[],
  parentValue: t.ConfigValue,
  parentPath: string,
  onChange: (path: string, value: t.ConfigValue) => void,
  localize: (key: string, interpolation?: Record<string, string | number>) => string,
  disabled?: boolean,
  collectionRenderOverrides?: Record<string, t.CollectionRenderFields>,
  editSessionId?: number,
): ReactNode[] {
  const values =
    typeof parentValue === 'object' && parentValue !== null && !Array.isArray(parentValue)
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};

  const nodes: ReactNode[] = [];
  for (const field of fields) {
    if (field.children && field.children.length > 0 && !field.isArray && field.type !== 'record') {
      const nested = values[field.key];
      const nestedObj =
        typeof nested === 'object' && nested !== null && !Array.isArray(nested)
          ? (nested as Record<string, t.ConfigValue>)
          : {};
      for (const child of field.children) {
        nodes.push(
          renderInlineField(
            withRequired(child),
            nested,
            `${parentPath}.${field.key}`,
            (childKey, childValue) => {
              onChange(field.key, { ...nestedObj, [childKey]: childValue });
            },
            localize,
            disabled,
            collectionRenderOverrides,
            true,
            editSessionId,
          ),
        );
      }
    } else {
      nodes.push(
        renderInlineField(
          withRequired(field),
          parentValue,
          parentPath,
          onChange,
          localize,
          disabled,
          collectionRenderOverrides,
          true,
          editSessionId,
        ),
      );
    }
  }
  return nodes;
}

function FieldGroup({
  labelKey,
  fields,
  parentValue,
  parentPath,
  onChange,
  disabled,
  defaultExpanded,
  collectionRenderOverrides,
  editSessionId,
}: {
  labelKey: string;
  fields: t.SchemaField[];
  parentValue: t.ConfigValue;
  parentPath: string;
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  defaultExpanded: boolean;
  collectionRenderOverrides?: Record<string, t.CollectionRenderFields>;
  editSessionId?: number;
}) {
  const localize = useLocalize();
  const { isExpanded, hasEverExpanded, sectionRef, toggle } = useCollapsibleSection({
    defaultExpanded,
  });

  if (fields.length === 0) return null;

  return (
    <section ref={sectionRef} className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default)">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={toggle}
          className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border-none bg-transparent py-2 pr-0 pl-1 transition-colors outline-none select-none hover:bg-(--cui-color-background-hover) focus-visible:bg-(--cui-color-background-hover)"
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
            disabled,
            collectionRenderOverrides,
            editSessionId,
          )}
        </div>,
      )}
    </section>
  );
}

function GroupedFieldRenderer({
  groupKey,
  fields,
  parentValue,
  parentPath,
  onChange,
  disabled,
  collectionRenderOverrides,
  editSessionId,
}: {
  groupKey: string;
  fields: t.SchemaField[];
  parentValue: t.ConfigValue;
  parentPath: string;
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  collectionRenderOverrides?: Record<string, t.CollectionRenderFields>;
  editSessionId?: number;
}) {
  const groups = FIELD_GROUPS[groupKey];
  if (!groups) return null;

  const allGroupedKeys = new Set(groups.flatMap((g) => g.fields));
  const fieldsByKey = new Map(fields.map((f) => [f.key, f]));
  const ungrouped = fields.filter((f) => !allGroupedKeys.has(f.key));

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const groupFields = group.fields
          .map((key) => fieldsByKey.get(key))
          .filter((f): f is t.SchemaField => f != null);
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
            collectionRenderOverrides={collectionRenderOverrides}
            editSessionId={editSessionId}
          />
        );
      })}
      {ungrouped.length > 0 && (
        <FieldGroup
          labelKey="com_config_group_advanced"
          fields={ungrouped}
          parentValue={parentValue}
          parentPath={parentPath}
          onChange={onChange}
          disabled={disabled}
          defaultExpanded={false}
          collectionRenderOverrides={collectionRenderOverrides}
          editSessionId={editSessionId}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dynamic paramDefinitions renderer
// ---------------------------------------------------------------------------

/** Maps type → valid component choices. */
const TYPE_COMPONENTS: Record<string, string[]> = {
  number: ['input', 'slider'],
  boolean: ['checkbox', 'switch'],
  string: ['input', 'textarea'],
  enum: ['dropdown', 'slider', 'combobox'],
  array: ['tags'],
};

/** Maps component → extra fields that become relevant. */
const COMPONENT_FIELDS: Record<string, string[]> = {
  input: ['minText', 'maxText', 'placeholder'],
  textarea: ['minText', 'maxText', 'placeholder'],
  slider: ['range', 'includeInput'],
  checkbox: [],
  switch: [],
  dropdown: ['options'],
  combobox: [
    'options',
    'items',
    'searchPlaceholder',
    'selectPlaceholder',
    'searchPlaceholderCode',
    'selectPlaceholderCode',
  ],
  tags: ['minTags', 'maxTags'],
};

/** Fields always visible regardless of type/component. */
const ALWAYS_VISIBLE = new Set(['key', 'type', 'component', 'description', 'default', 'label']);

/** Explicit field ordering for paramDefinition entries. Fields listed here
 *  appear first in this order; unlisted fields follow in schema order. */
const PARAM_FIELD_ORDER = [
  'key',
  'description',
  'label',
  'type',
  'component',
  'default',
  'options',
];

/** Fields visible when options are relevant (enum, dropdown, combobox, checkbox, switch). */
const OPTIONS_TYPES = new Set(['enum']);
const OPTIONS_COMPONENTS = new Set(['dropdown', 'combobox', 'checkbox', 'switch', 'slider']);

function ParamDefinitionEntry({
  fields,
  parentValue,
  parentPath,
  onChange,
}: {
  fields: t.SchemaField[];
  parentValue: t.ConfigValue;
  parentPath: string;
  onChange: (path: string, value: t.ConfigValue) => void;
}) {
  const localize = useLocalize();
  const values =
    typeof parentValue === 'object' && parentValue !== null && !Array.isArray(parentValue)
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};

  const currentType = typeof values.type === 'string' ? values.type : '';
  const currentComponent = typeof values.component === 'string' ? values.component : '';

  // Build the set of visible field keys based on current type + component
  const visibleKeys = new Set(ALWAYS_VISIBLE);

  if (currentType && OPTIONS_TYPES.has(currentType)) {
    visibleKeys.add('options');
    visibleKeys.add('enumMappings');
  }
  if (currentComponent && OPTIONS_COMPONENTS.has(currentComponent)) {
    visibleKeys.add('options');
  }
  if (currentComponent) {
    for (const key of COMPONENT_FIELDS[currentComponent] ?? []) {
      visibleKeys.add(key);
    }
  }
  // Layout fields always available
  visibleKeys.add('showLabel');
  visibleKeys.add('showDefault');
  visibleKeys.add('columnSpan');
  visibleKeys.add('columns');

  // Filter visible fields, then order: prioritized fields first, rest in schema order
  const fieldsByKey = new Map(fields.map((f) => [f.key, f]));
  const orderSet = new Set(PARAM_FIELD_ORDER);
  const ordered = PARAM_FIELD_ORDER.map((key) => fieldsByKey.get(key)).filter(
    (f): f is t.SchemaField => f != null && visibleKeys.has(f.key),
  );
  const rest = fields.filter((f) => !orderSet.has(f.key) && visibleKeys.has(f.key));
  const visibleFields = [...ordered, ...rest];

  // For the "type" field, we want to clear component when type changes
  // since the valid components differ per type
  const handleChange = (key: string, value: t.ConfigValue) => {
    if (key === 'type') {
      // Clear component when type changes — the valid set differs
      const newComponents = TYPE_COMPONENTS[value as string] ?? [];
      const currentComp = values.component as string | undefined;
      if (currentComp && !newComponents.includes(currentComp)) {
        onChange(key, value);
        onChange('component', undefined);
        return;
      }
    }
    onChange(key, value);
  };

  return (
    <div className="flex flex-col gap-3">
      {visibleFields.map((field) =>
        renderInlineField(field, parentValue, parentPath, handleChange, localize),
      )}
    </div>
  );
}

function renderParamDefinitionFields(
  fields: t.SchemaField[],
  parentValue: t.ConfigValue,
  parentPath: string,
  onChange: (path: string, value: t.ConfigValue) => void,
): ReactNode {
  return (
    <ParamDefinitionEntry
      fields={fields}
      parentValue={parentValue}
      parentPath={parentPath}
      onChange={onChange}
    />
  );
}

/** Collection render overrides for custom endpoint nested fields. */
const COLLECTION_RENDER_OVERRIDES: Record<string, t.CollectionRenderFields> = {
  paramDefinitions: renderParamDefinitionFields,
};

/**
 * Custom `renderFields` function for custom endpoint entries.
 * Renders fields in semantic groups instead of a flat list.
 * Matches the `CollectionRenderFields` signature so it can be injected
 * into `ArrayObjectField` and `ObjectEntryCard`.
 */
function makeGroupedEndpointFields(disabled?: boolean): t.CollectionRenderFields {
  return (fields, parentValue, parentPath, onChange, _addFieldTriggerRef, editSessionId) => (
    <GroupedFieldRenderer
      groupKey="custom"
      fields={fields}
      parentValue={parentValue}
      parentPath={parentPath}
      onChange={onChange}
      disabled={disabled}
      collectionRenderOverrides={COLLECTION_RENDER_OVERRIDES}
      editSessionId={editSessionId}
    />
  );
}

// ---------------------------------------------------------------------------
// ProviderSection — renders a named provider (openAI, anthropic, …)
// ---------------------------------------------------------------------------

function ProviderSection({
  field,
  parentPath,
  parentValue,
  getValue,
  onChange,
  onResetField,
  onDiscardField,
  editedValues,
  disabled,
  profileMap,
  permissions,
  configuredPaths,
  dbOverridePaths,
  touchedPaths,
  pendingResets,
  schemaDefaults,
  showConfiguredOnly,
  previewMode,
  previewScope,
  previewChangedPaths,
  resolvedValues,
  onProfileChange,
  showChangedOnly,
  editSessionId,
}: { field: t.SchemaField } & SharedProps & { parentPath: string }) {
  const localize = useLocalize();

  const path = `${parentPath}.${field.key}`;
  const children = field.children ?? [];
  const parentObj =
    parentValue && typeof parentValue === 'object' && !Array.isArray(parentValue)
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};
  const providerValue = parentObj[field.key] ?? {};

  const { total, configured } = countConfigured(children, path, configuredPaths);

  const priorityChildren = PRIORITY_ORDER.map((k) => children.find((c) => c.key === k)).filter(
    (f): f is t.SchemaField => f != null,
  );

  const hasPrioritySplit = priorityChildren.length > 0;
  const priorityKeys = new Set(priorityChildren.map((c) => c.key));
  const restChildren = hasPrioritySplit
    ? children.filter((c) => !priorityKeys.has(c.key))
    : children;

  const restConfigured = restChildren.reduce((acc, c) => {
    const p = `${path}.${c.key}`;
    return acc + (configuredPaths?.has(p) || hasDescendant(p, configuredPaths) ? 1 : 0);
  }, 0);

  const label = localize(`com_config_field_${field.key}`);

  const rendererProps: Omit<t.FieldRendererProps, 'fields'> = {
    parentValue: providerValue,
    parentPath: path,
    getValue,
    onChange,
    onResetField,
    onDiscardField,
    editedValues,
    disabled,
    profileMap,
    permissions,
    configuredPaths,
    dbOverridePaths,
    touchedPaths,
    pendingResets,
    schemaDefaults,
    showConfiguredOnly,
    previewMode,
    previewScope,
    previewChangedPaths,
    resolvedValues,
    onProfileChange,
    showChangedOnly,
    editSessionId,
  };

  const title = (
    <span className="flex items-center gap-2">
      {label}
      {total > 0 && (
        <span
          className={cn(
            'config-count-badge',
            configured > 0 ? 'config-count-badge-active' : 'config-count-badge-muted',
          )}
        >
          {configured}/{total}
        </span>
      )}
    </span>
  );

  return (
    <MultiAccordion.Item id={`section-${path}`} value={path} title={title}>
      {hasPrioritySplit ? (
        <>
          <FieldRenderer fields={priorityChildren} {...rendererProps} />
          {restChildren.length > 0 && (
            <NestedGroup
              label={localize('com_config_more_settings')}
              totalCount={restChildren.length}
              configuredCount={restConfigured}
              depth={2}
              disabled={rendererProps.disabled}
            >
              <FieldRenderer fields={restChildren} {...rendererProps} />
            </NestedGroup>
          )}
        </>
      ) : (
        <FieldRenderer fields={children} {...rendererProps} />
      )}
      <UnknownSettings fields={children} value={providerValue} path={path} />
    </MultiAccordion.Item>
  );
}

// ---------------------------------------------------------------------------
// CustomEndpointsRenderer — tab: Custom Endpoints
// ---------------------------------------------------------------------------

export function CustomEndpointsRenderer(props: t.FieldRendererProps) {
  const { fields, parentPath, parentValue, getValue, onChange, disabled, editSessionId } = props;
  const localize = useLocalize();
  const [createOpen, setCreateOpen] = useState(false);
  const renderGroupedEndpointFields = useMemo(
    () => makeGroupedEndpointFields(disabled),
    [disabled],
  );

  const customField = fields.find((f) => f.key === 'custom');
  if (!customField) return null;

  const path = `${parentPath}.${customField.key}`;
  const parentObj =
    parentValue && typeof parentValue === 'object' && !Array.isArray(parentValue)
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};
  const value = getValue(path, parentObj[customField.key] ?? []);
  const items = Array.isArray(value) ? value : [];

  const handleCreate = (entry: Record<string, t.ConfigValue>) => {
    onChange(path, [...items, entry]);
  };

  const isEmpty = items.length === 0;

  return (
    <div className="flex flex-col gap-2">
      {!disabled && (
        <div className="flex items-center gap-3 py-2">
          <button type="button" onClick={() => setCreateOpen(true)} className="config-add-btn">
            <Icon name="plus" size="sm" />
            <span>{localize('com_config_create_endpoint')}</span>
          </button>
        </div>
      )}
      {disabled && isEmpty ? (
        <div className="py-3 text-sm text-(--cui-color-text-muted)">
          {localize('com_config_no_custom_endpoints')}
        </div>
      ) : (
        <ArrayObjectField
          id={`${path.replace(/\./g, '-')}`}
          value={value}
          fields={customField.children ?? []}
          onChange={(v) => onChange(path, v)}
          onEntryChange={(index, v) => onChange(`${path}.${index}`, v)}
          disabled={disabled}
          hideAddButton
          renderFields={renderGroupedEndpointFields}
          entryIdPrefix={`section-${path.split('.')[0]}-custom`}
          editSessionId={editSessionId}
        />
      )}
      <CreateCustomEndpointDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleCreate}
        fields={customField.children ?? []}
        renderFields={renderGroupedEndpointFields}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProvidersRenderer — tab: AI Providers
// ---------------------------------------------------------------------------

export function ProvidersRenderer(props: t.FieldRendererProps) {
  const {
    fields,
    parentPath,
    parentValue,
    getValue,
    onChange,
    onResetField,
    onDiscardField,
    editedValues,
    disabled,
    profileMap,
    permissions,
    configuredPaths,
    dbOverridePaths,
    touchedPaths,
    pendingResets,
    schemaDefaults,
    showConfiguredOnly,
    previewMode,
    previewScope,
    previewChangedPaths,
    resolvedValues,
    onProfileChange,
    showChangedOnly,
    editSessionId,
  } = props;

  // Named provider objects (openAI, anthropic, …)
  const providerFields = fields.filter(
    (f) => f.key !== 'custom' && f.children && f.children.length > 0,
  );

  // Any remaining scalar/collection fields
  const otherFields = fields.filter(
    (f) => f.key !== 'custom' && (!f.children || f.children.length === 0),
  );

  const sharedProps: SharedProps & { parentPath: string } = {
    parentPath,
    parentValue,
    getValue,
    onChange,
    onResetField,
    onDiscardField,
    editedValues,
    disabled,
    profileMap,
    permissions,
    configuredPaths,
    dbOverridePaths,
    touchedPaths,
    pendingResets,
    schemaDefaults,
    showConfiguredOnly,
    previewMode,
    previewScope,
    previewChangedPaths,
    resolvedValues,
    onProfileChange,
    showChangedOnly,
    editSessionId,
  };

  // In showConfiguredOnly mode, hide providers with no configured descendants
  const visibleProviders = showConfiguredOnly
    ? providerFields.filter((f) => {
        const { configured } = countConfigured(
          f.children ?? [],
          `${parentPath}.${f.key}`,
          configuredPaths,
        );
        return configured > 0;
      })
    : providerFields;

  const defaultOpen = visibleProviders
    .filter((f) => {
      const { configured } = countConfigured(
        f.children ?? [],
        `${parentPath}.${f.key}`,
        configuredPaths,
      );
      return configured > 0;
    })
    .map((f) => `${parentPath}.${f.key}`);

  return (
    <div className="flex flex-col gap-2">
      <MultiAccordion
        type="multiple"
        showBorder
        showCheck={false}
        fillWidth
        defaultValue={defaultOpen}
        data-top-level-accordion
      >
        {visibleProviders.map((field) => (
          <ProviderSection key={field.key} field={field} {...sharedProps} />
        ))}
      </MultiAccordion>

      {otherFields.length > 0 && <FieldRenderer fields={otherFields} {...sharedProps} />}
    </div>
  );
}
