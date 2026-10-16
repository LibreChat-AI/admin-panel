import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { countConfigured, hasDescendant, hasPathOverlap } from '../counts';
import { UnknownSettings } from '../UnknownSettings';
import { SingleFieldRenderer } from './SingleField';
import { ManagedNotice } from '../ManagedNotice';
import { getSecretPreviewValue } from '@/utils';
import { isYamlManagedPath } from '@/constants';
import { controlSortKey } from '../controls';
import { NestedGroup } from './NestedGroup';
import { useLocalize } from '@/hooks';

const NO_PATHS: ReadonlySet<string> = new Set();

export function FieldRenderer({
  fields,
  parentValue,
  parentPath,
  getValue,
  onChange,
  onResetField,
  onDiscardField,
  editedValues,
  disabled,
  profileMap,
  previewMode,
  previewScope,
  previewChangedPaths,
  resolvedValues,
  permissions,
  onProfileChange,
  showChangedOnly,
  configuredPaths,
  dbOverridePaths,
  touchedPaths,
  pendingResets,
  schemaDefaults,
  showConfiguredOnly,
  editSessionId,
}: t.FieldRendererProps) {
  const localize = useLocalize();
  const values =
    typeof parentValue === 'object' && parentValue !== null
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};

  const filtering = showChangedOnly && previewMode && previewChangedPaths;
  const isPathChanged = (p: string) =>
    previewChangedPaths?.some((op) => op === p || op.startsWith(`${p}.`)) ?? false;

  const sorted = [...fields].sort((a, b) => controlSortKey(a) - controlSortKey(b));

  const groups: Array<
    | { type: 'single'; field: t.SchemaField; value: t.ConfigValue; path: string }
    | { type: 'nested'; field: t.SchemaField; value: t.ConfigValue; path: string }
  > = [];

  for (const field of sorted) {
    const value = values[field.key];
    const path = `${parentPath}.${field.key}`;

    if (filtering && !isPathChanged(path)) continue;

    if (showConfiguredOnly && !previewMode) {
      const isLeafConfigured = configuredPaths?.has(path);
      if (!isLeafConfigured && !hasDescendant(path, configuredPaths)) continue;
    }

    if (field.children && field.children.length > 0 && !field.isArray && field.type !== 'record') {
      groups.push({ type: 'nested', field, value, path });
    } else {
      groups.push({ type: 'single', field, value, path });
    }
  }

  const managedNotice = (path: string): ReactNode => (
    <ManagedNotice
      hasOverride={hasPathOverlap(path, dbOverridePaths ?? NO_PATHS)}
      pendingRemoval={pendingResets?.has(path) ?? false}
      onRemoveOverride={disabled || !onResetField ? undefined : () => onResetField(path)}
    />
  );

  return (
    <>
      {groups.map((group) => {
        const managed = isYamlManagedPath(group.path);
        const groupDisabled = disabled || managed;
        if (group.type === 'nested') {
          const nestedValue =
            typeof group.value === 'object' && group.value !== null ? group.value : {};
          const nestedLabel = localize(`com_config_field_${group.field.key}`);
          const nestedCounts = countConfigured(group.field.children!, group.path, configuredPaths);
          return (
            <NestedGroup
              key={group.field.path}
              label={nestedLabel}
              sectionId={`section-${group.path}`}
              configuredCount={nestedCounts.configured}
              totalCount={nestedCounts.total}
              depth={group.field.depth}
              disabled={groupDisabled}
            >
              {managed && managedNotice(group.path)}
              <FieldRenderer
                fields={group.field.children!}
                parentValue={nestedValue}
                parentPath={group.path}
                getValue={getValue}
                onChange={onChange}
                onResetField={onResetField}
                onDiscardField={onDiscardField}
                editedValues={editedValues}
                disabled={groupDisabled}
                profileMap={profileMap}
                previewMode={previewMode}
                previewScope={previewScope}
                previewChangedPaths={previewChangedPaths}
                resolvedValues={resolvedValues}
                permissions={permissions}
                onProfileChange={onProfileChange}
                showChangedOnly={showChangedOnly}
                configuredPaths={configuredPaths}
                dbOverridePaths={dbOverridePaths}
                touchedPaths={touchedPaths}
                pendingResets={pendingResets}
                schemaDefaults={schemaDefaults}
                showConfiguredOnly={showConfiguredOnly}
                editSessionId={editSessionId}
              />
              <UnknownSettings
                fields={group.field.children!}
                value={nestedValue}
                path={group.path}
              />
            </NestedGroup>
          );
        }

        return (
          <Fragment key={group.field.path}>
            {managed && managedNotice(group.path)}
            <SingleFieldRenderer
              field={group.field}
              value={group.value}
              path={group.path}
              getValue={getValue}
              onChange={onChange}
              onResetField={onResetField}
              onDiscardField={onDiscardField}
              editedValues={editedValues}
              disabled={groupDisabled}
              permissions={permissions}
              onProfileChange={onProfileChange}
              previewMode={previewMode}
              previewScope={previewScope}
              previewChangedPaths={previewChangedPaths}
              resolvedValues={resolvedValues}
              configuredPaths={configuredPaths}
              dbOverridePaths={dbOverridePaths}
              touchedPaths={touchedPaths}
              pendingResets={pendingResets}
              schemaDefaults={schemaDefaults}
              showConfiguredOnly={showConfiguredOnly}
              isSoleField={false}
              secretPreviewValue={getSecretPreviewValue(values, group.field.key)}
              editSessionId={editSessionId}
            />
          </Fragment>
        );
      })}
    </>
  );
}
