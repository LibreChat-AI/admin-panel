import { useContext } from 'react';
import type * as t from '@/types';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../UnknownSettings';
import { FieldRenderer } from './FieldRenderer';

/**
 * What a purpose-built renderer leaves to the schema: the fields of its
 * object it doesn't place (a newer LibreChat's) as plain rows, then the keys
 * no schema knows, read-only (D8), so no setting is hidden.
 */
export function OtherSettings({ placed, ...props }: t.OtherSettingsProps) {
  const rowFilter = useContext(RowFilterContext);
  const others = props.fields.filter((field) => !placed.has(field.key));
  return (
    <>
      {others.length > 0 && <FieldRenderer {...props} fields={others} />}
      {!rowFilter && (
        <UnknownSettings fields={props.fields} value={props.parentValue} path={props.parentPath} />
      )}
    </>
  );
}
