import { useRef, useCallback } from 'react';
import type * as t from '@/types';
import { RecordObjectField } from '../fields/RecordObjectField';
import { ArrayObjectField } from '../fields/ArrayObjectField';
import { renderCollectionEntryFields } from './InlineField';
import { NestedGroup } from './NestedGroup';

/** Wrapper that wires a NestedGroup header "+ Add entry" button to
 *  ArrayObjectField's add handler via a ref. */
export function ArrayObjectNestedGroup({
  fieldId,
  fieldLabel,
  path,
  currentValue,
  field,
  onChange,
  disabled,
  isSoleField,
  editSessionId,
}: {
  fieldId: string;
  fieldLabel: string;
  path: string;
  currentValue: t.ConfigValue;
  field: t.SchemaField;
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  isSoleField?: boolean;
  editSessionId?: number;
}) {
  const items = Array.isArray(currentValue) ? currentValue : [];
  const addTriggerRef = useRef<(() => void) | null>(null);
  const handleAdd = disabled ? undefined : () => addTriggerRef.current?.();

  const handleEntryChange = useCallback(
    (index: number, value: t.ConfigValue) => onChange(`${path}.${index}`, value),
    [onChange, path],
  );

  const arrayField = (
    <ArrayObjectField
      id={fieldId}
      value={currentValue}
      fields={field.children ?? []}
      onChange={(v) => onChange(path, v)}
      onEntryChange={handleEntryChange}
      disabled={disabled}
      hideAddButton
      addTriggerRef={addTriggerRef}
      renderFields={renderCollectionEntryFields}
      editSessionId={editSessionId}
    />
  );
  if (isSoleField) return arrayField;
  return (
    <NestedGroup
      label={fieldLabel}
      sectionId={`section-${path}`}
      configuredCount={items.length}
      totalCount={items.length}
      depth={field.depth}
      onAdd={handleAdd}
      disabled={disabled}
    >
      {arrayField}
    </NestedGroup>
  );
}

/** Wrapper that wires a NestedGroup header "+ Add entry" button to
 *  RecordObjectField's add-key input via a ref. */
export function RecordObjectNestedGroup({
  fieldId,
  fieldLabel,
  path,
  currentValue,
  field,
  entries,
  onChange,
  disabled,
  isSoleField,
  editSessionId,
}: {
  fieldId: string;
  fieldLabel: string;
  path: string;
  currentValue: t.ConfigValue;
  field: t.SchemaField;
  entries: string[];
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  isSoleField?: boolean;
  editSessionId?: number;
}) {
  const addTriggerRef = useRef<(() => void) | null>(null);
  const handleAdd = disabled ? undefined : () => addTriggerRef.current?.();

  const recordField = (
    <RecordObjectField
      id={fieldId}
      value={currentValue}
      fields={field.children ?? []}
      onChange={(v) => onChange(path, v)}
      disabled={disabled}
      allowPrimitiveValues={field.recordValueAllowsPrimitive}
      addTriggerRef={addTriggerRef}
      renderFields={renderCollectionEntryFields}
      editSessionId={editSessionId}
    />
  );
  if (isSoleField) return recordField;
  return (
    <NestedGroup
      label={fieldLabel}
      sectionId={`section-${path}`}
      configuredCount={entries.length}
      totalCount={entries.length}
      depth={field.depth}
      onAdd={handleAdd}
      disabled={disabled}
    >
      {recordField}
    </NestedGroup>
  );
}
