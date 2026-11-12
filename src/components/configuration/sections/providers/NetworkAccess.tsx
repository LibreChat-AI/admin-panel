import { useContext } from 'react';
import type * as t from '@/types';
import { isConfigRecord, isRowVisible, addressItemError, isStringList } from '@/utils';
import { useLocalize, useFieldState, usePersistentExpanded } from '@/hooks';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { SettingsSection } from '../../SettingsSection';
import { ListField } from '../../fields/ListField';
import { PROVIDERS_STORAGE_KEY } from './Group';
import { ConfigRow } from '../../ConfigRow';
import { toFieldId } from '../../renderer';
import { labelForPath } from '../../meta';
import { summaryValue } from './layout';

/**
 * "Network access" card for `endpoints.allowedAddresses` (AP-7): the private
 * host:port services AI providers and custom endpoints may reach (LibreChat's
 * SSRF allowlist). Each entry is checked as it is typed with LibreChat's own
 * rules, and only the first relevant problem is shown ("Add a port").
 */
export function NetworkAccessCard({
  field,
  parentPath,
  parentValue,
  getValue,
  onChange,
  onResetField,
  onDiscardField,
  editedValues,
  disabled,
  permissions,
  configuredPaths,
  dbOverridePaths,
  touchedPaths,
  pendingResets,
  previewMode,
  previewScope,
  previewChangedPaths,
  resolvedValues,
  showConfiguredOnly,
}: t.NetworkAccessCardProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const path = `${parentPath}.${field.key}`;
  const state = useFieldState(path);
  const { isExpanded, hasEverExpanded, sectionRef, toggle } = usePersistentExpanded({
    storageKey: PROVIDERS_STORAGE_KEY,
    id: field.key,
    revealPaths: [path],
  });
  const parentRecord = isConfigRecord(parentValue) ? parentValue : {};
  const value = getValue(path, parentRecord[field.key]);
  const values = isStringList(value) ? value : [];
  const isConfigured = configuredPaths?.has(path) ?? false;
  const isDbOverride = dbOverridePaths?.has(path) ?? false;
  const hasPendingEdit = editedValues ? path in editedValues : false;

  if (!isRowVisible(rowFilter, path)) return null;
  if (showConfiguredOnly && !isConfigured && !hasPendingEdit && !rowFilter) return null;

  /** Back to no override; a list librechat.yaml sets cannot be emptied here (D3). */
  const clear = (): boolean => {
    if (isDbOverride || state.isOverride) {
      onChange(path, undefined);
      return true;
    }
    if (isConfigured) return false;
    if (hasPendingEdit) onDiscardField?.(path);
    return true;
  };

  const label = labelForPath(path, localize);
  const summary =
    isExpanded || values.length === 0 ? undefined : summaryValue(field, values, localize);

  return (
    <SettingsSection
      id={`section-${path}`}
      sectionRef={sectionRef}
      title={localize('com_config_providers_network_title')}
      description={
        <>
          {localize('com_config_providers_network_desc')}
          {summary && (
            <span className="provider-card-summary">
              {localize('com_config_providers_summary_set', { summary })}
            </span>
          )}
        </>
      }
      level={2}
      expanded={isExpanded}
      onToggle={toggle}
      hasEverExpanded={hasEverExpanded}
    >
      <ConfigRow
        title={label}
        description={localize('com_config_providers_network_addresses_desc')}
        fieldId={toFieldId(path)}
        fieldPath={path}
        disabled={disabled}
        permissions={permissions}
        onResetField={onResetField}
        onDiscardField={onDiscardField}
        previewMode={previewMode}
        previewScope={previewScope}
        previewChangedPaths={previewChangedPaths}
        resolvedValues={resolvedValues}
        isConfigured={isConfigured}
        isDbOverride={isDbOverride}
        isTouched={touchedPaths?.has(path) ?? false}
        isPendingReset={pendingResets?.has(path) ?? false}
        defaultHint={null}
      >
        <ListField
          id={toFieldId(path)}
          values={values}
          onChange={(next) => onChange(path, next)}
          onClear={clear}
          disabled={disabled}
          placeholder={localize('com_config_providers_network_placeholder')}
          itemLabel={localize('com_config_providers_network_item')}
          validateItem={(entry) => addressItemError(entry, localize)}
          width="M"
          aria-label={label}
        />
      </ConfigRow>
    </SettingsSection>
  );
}
