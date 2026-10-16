import { MultiAccordion } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { countConfigured, hasDescendant } from '../../counts';
import { FieldRenderer, NestedGroup } from '../../renderer';
import { UnknownSettings } from '../../UnknownSettings';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

/** Shown at the top of every named-provider section, in this order. */
const PRIORITY_ORDER = ['disabled', 'apiKey', 'baseURL', 'models', 'name'] as const;

export function ProviderSection({
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
}: t.ProviderSectionProps) {
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
