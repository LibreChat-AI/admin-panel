import { useContext } from 'react';
import type * as t from '@/types';
import { getSecretPreviewValue, isConfigRecord, isRowVisible } from '@/utils';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { hasPathOverlap, hasPendingValue } from '../../counts';

const NO_PATHS: ReadonlySet<string> = new Set();
import { SingleFieldRenderer } from '../../renderer';

/**
 * Whether an area renderer's own row for `path` shows: the tab filter matches
 * it (or something in it), and with "Set values only" it is set, or holds an
 * unsaved value.
 */
export function isRowShown(
  rowFilter: t.PathIndex | null,
  path: string,
  fieldProps: Pick<t.FieldRendererProps, 'showConfiguredOnly' | 'configuredPaths' | 'editedValues'>,
): boolean {
  if (!isRowVisible(rowFilter, path)) return false;
  if (!fieldProps.showConfiguredOnly) return true;
  return (
    hasPathOverlap(path, fieldProps.configuredPaths ?? NO_PATHS) ||
    hasPendingValue(path, fieldProps.editedValues)
  );
}

/**
 * One generic settings row for a field of a section, for area renderers that
 * place rows themselves: the same control, chips and revert as the generic
 * renderer, hidden while the tab filter matches neither it nor anything in it.
 */
export function FieldRow({
  field,
  fieldProps,
}: {
  field: t.SchemaField | undefined;
  fieldProps: t.FieldRendererProps;
}) {
  const rowFilter = useContext(RowFilterContext);
  if (!field) return null;
  const path = `${fieldProps.parentPath}.${field.key}`;
  if (!isRowVisible(rowFilter, path)) return null;
  const values = isConfigRecord(fieldProps.parentValue) ? fieldProps.parentValue : {};
  return (
    <SingleFieldRenderer
      field={field}
      value={values[field.key]}
      path={path}
      getValue={fieldProps.getValue}
      onChange={fieldProps.onChange}
      onResetField={fieldProps.onResetField}
      onDiscardField={fieldProps.onDiscardField}
      editedValues={fieldProps.editedValues}
      disabled={fieldProps.disabled}
      permissions={fieldProps.permissions}
      previewMode={fieldProps.previewMode}
      previewScope={fieldProps.previewScope}
      previewChangedPaths={fieldProps.previewChangedPaths}
      resolvedValues={fieldProps.resolvedValues}
      configuredPaths={fieldProps.configuredPaths}
      dbOverridePaths={fieldProps.dbOverridePaths}
      touchedPaths={fieldProps.touchedPaths}
      pendingResets={fieldProps.pendingResets}
      schemaDefaults={fieldProps.schemaDefaults}
      showConfiguredOnly={fieldProps.showConfiguredOnly}
      isSoleField={false}
      secretPreviewValue={getSecretPreviewValue(values, field.key)}
      editSessionId={fieldProps.editSessionId}
    />
  );
}
