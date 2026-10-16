import { useMemo, useState } from 'react';
import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { CreateCustomEndpointDialog } from '../CreateCustomEndpointDialog';
import { ArrayObjectField } from '../../fields/ArrayObjectField';
import { renderParamDefinitionFields } from './ParamDefinitions';
import { GroupedFieldRenderer } from './GroupedFields';
import { useLocalize } from '@/hooks';

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
