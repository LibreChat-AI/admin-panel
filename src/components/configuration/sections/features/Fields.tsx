import { useContext } from 'react';
import type * as t from '@/types';
import { getSecretPreviewValue, isConfigRecord, isRowVisible } from '@/utils';
import { FieldRenderer, SingleFieldRenderer } from '../../renderer';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { orderFields } from '../../controls';

/**
 * A feature section's fields in display order (`FieldMeta.order`). Each field
 * renders as the generic renderer would (rows, nested groups, switches),
 * except keys listed in `controls`, which keep their settings row (label,
 * chips, Reset) around the purpose-built control.
 */
export function FeatureFields({ controls, ...props }: t.FeatureFieldsProps) {
  const rowFilter = useContext(RowFilterContext);
  const { fields, parentPath, parentValue } = props;
  const values = isConfigRecord(parentValue) ? parentValue : {};
  return (
    <>
      {orderFields(fields, parentPath).map((field) => {
        const path = `${parentPath}.${field.key}`;
        const renderControl = controls?.[field.key];
        if (!renderControl) {
          return <FieldRenderer key={path} {...props} fields={[field]} />;
        }
        if (!isRowVisible(rowFilter, path)) return null;
        return (
          <SingleFieldRenderer
            key={path}
            field={field}
            value={values[field.key]}
            path={path}
            getValue={props.getValue}
            onChange={props.onChange}
            onResetField={props.onResetField}
            onDiscardField={props.onDiscardField}
            editedValues={props.editedValues}
            disabled={props.disabled}
            permissions={props.permissions}
            previewMode={props.previewMode}
            previewScope={props.previewScope}
            previewChangedPaths={props.previewChangedPaths}
            resolvedValues={props.resolvedValues}
            configuredPaths={props.configuredPaths}
            dbOverridePaths={props.dbOverridePaths}
            touchedPaths={props.touchedPaths}
            pendingResets={props.pendingResets}
            schemaDefaults={props.schemaDefaults}
            showConfiguredOnly={props.showConfiguredOnly}
            isSoleField={false}
            secretPreviewValue={getSecretPreviewValue(values, field.key)}
            editSessionId={props.editSessionId}
            renderControl={renderControl}
          />
        );
      })}
    </>
  );
}
