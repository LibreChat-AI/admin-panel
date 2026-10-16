import { MultiAccordion } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { ProviderSection } from './ProviderSection';
import { FieldRenderer } from '../../renderer';
import { countConfigured } from '../../counts';

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

  const sharedProps: Omit<t.ProviderSectionProps, 'field'> = {
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
