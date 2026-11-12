import { useContext } from 'react';
import type * as t from '@/types';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { hasPendingValue, isPathSet } from '../../counts';
import { TriStateField } from '../../fields/TriStateField';
import { FieldControl } from '../../renderer/FieldControl';
import { UnknownSettings } from '../../UnknownSettings';
import { isConfigRecord, isRowVisible } from '@/utils';
import { FeatureFields } from './Fields';
import { MemoryAgent } from './Agent';

const LAYER_SOURCES: ReadonlySet<t.ProvenanceSource> = new Set(['yaml', 'inherited']);

const invert = (value: t.ConfigValue): t.ConfigValue =>
  typeof value === 'boolean' ? !value : value;

/**
 * "Enable memory" for `memory.disabled` (FX-3): a positive switch whose On
 * stores `disabled: false` and Off `disabled: true`. LibreChat turns memory
 * on whenever a `memory` block exists and does not disable it, so without a
 * value beneath, Default is On only while the section sets anything. Read
 * only, the value reads inverted the same way.
 */
function EnableMemoryControl({ hasMemoryBlock, ...props }: t.EnableMemoryControlProps) {
  const { fieldDefault } = props;
  const fromLayer =
    LAYER_SOURCES.has(fieldDefault.source) && typeof fieldDefault.value === 'boolean';
  const defaultEnabled = fromLayer ? fieldDefault.value !== true : hasMemoryBlock;
  if (props.disabled) {
    return (
      <FieldControl
        {...props}
        value={invert(props.value)}
        fieldDefault={{ ...fieldDefault, value: defaultEnabled }}
      />
    );
  }
  const own =
    fieldDefault.hasOwnValue && typeof props.value === 'boolean' ? !props.value : undefined;
  return (
    <TriStateField
      id={props.id}
      value={own}
      defaultValue={defaultEnabled}
      defaultSource={fromLayer ? fieldDefault.source : 'default'}
      onChange={(next) => {
        if (next === undefined) props.onClear();
        else props.onChange(!next);
      }}
      aria-label={props.label}
    />
  );
}

/**
 * Memory (FX-3): "Enable memory" as a positive switch first, the limits, and
 * the memory agent as its own group (`MemoryAgent`).
 */
export function MemoryRenderer(props: t.FieldRendererProps) {
  const rowFilter = useContext(RowFilterContext);
  const { fields, parentValue, parentPath } = props;
  const agentField = fields.find((field) => field.key === 'agent');
  const rest = fields.filter((field) => field.key !== 'agent');
  /** A pending edit counts: saving a first memory setting creates the block that turns memory on. */
  const hasMemoryBlock =
    (isConfigRecord(parentValue) && Object.keys(parentValue).some((key) => key !== 'disabled')) ||
    fields.some(
      (field) =>
        field.key !== 'disabled' &&
        hasPendingValue(`${parentPath}.${field.key}`, props.editedValues),
    );
  const controls: t.FeatureControls = {
    disabled: (control) => <EnableMemoryControl {...control} hasMemoryBlock={hasMemoryBlock} />,
  };
  const agentPath = `${parentPath}.agent`;
  const showsAgent =
    agentField != null &&
    isRowVisible(rowFilter, agentPath) &&
    (!props.showConfiguredOnly || isPathSet(agentPath, props.configuredPaths, props.editedValues));
  return (
    <>
      <FeatureFields {...props} fields={rest} controls={controls} />
      {showsAgent && <MemoryAgent {...props} field={agentField} />}
      {!rowFilter && <UnknownSettings fields={fields} value={parentValue} path={parentPath} />}
    </>
  );
}
