import { useContext, useMemo, useRef } from 'react';
import type * as t from '@/types';
import { NestedGroup, FieldRenderer, toFieldId, renderCollectionEntryFields } from '../../renderer';
import { RecordObjectField } from '../../fields/RecordObjectField';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { useCustomEndpointNames, useLocalize } from '@/hooks';
import { UnknownSettings } from '../../UnknownSettings';
import { isConfigRecord, isRowVisible } from '@/utils';
import { FILE_ENDPOINT_KEYS } from '@/constants';
import { isPathSet } from '../../counts';
import { orderFields } from '../../controls';

const SECTION = 'fileConfig';
const ENDPOINTS = 'fileConfig.endpoints';

/** Key suggestions for upload limits: LibreChat's endpoint keys, then the custom endpoints by name. */
function useEndpointKeyOptions(): { options: t.KeySuggestion[]; known: ReadonlySet<string> } {
  const localize = useLocalize();
  const customNames = useCustomEndpointNames();
  return useMemo(() => {
    const builtIn = FILE_ENDPOINT_KEYS.map((key) => ({
      value: key,
      label: localize(`com_config_filelimits_key_${key}`),
    }));
    const custom = customNames
      .filter((name) => !FILE_ENDPOINT_KEYS.includes(name))
      .map((name) => ({ value: name, label: localize('com_config_filelimits_key_custom_name') }));
    const options = [...builtIn, ...custom];
    return { options, known: new Set(options.map((option) => option.value)) };
  }, [localize, customNames]);
}

/**
 * Upload limits per endpoint (FX-8): entries keyed by endpoint, added from a
 * combobox of the keys LibreChat looks up (`default`, `agents`, …, and each
 * custom endpoint's name). A key LibreChat never looks up is refused inline,
 * with a suggestion when only its case differs.
 */
function EndpointLimitsGroup({
  field,
  fieldProps,
}: {
  field: t.SchemaField;
  fieldProps: t.FieldRendererProps;
}) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const addTriggerRef = useRef<(() => void) | null>(null);
  const { options, known } = useEndpointKeyOptions();
  const {
    getValue,
    onChange,
    disabled,
    editSessionId,
    configuredPaths,
    editedValues,
    showConfiguredOnly,
  } = fieldProps;
  const value = getValue(
    ENDPOINTS,
    isConfigRecord(fieldProps.parentValue) ? fieldProps.parentValue.endpoints : undefined,
  );
  if (!isRowVisible(rowFilter, ENDPOINTS)) return null;
  if (showConfiguredOnly && !isPathSet(ENDPOINTS, configuredPaths, editedValues)) return null;

  const validateKey = (key: string): string | null => {
    if (known.has(key)) return null;
    const lower = key.toLowerCase();
    const match = options.find((option) => option.value.toLowerCase() === lower);
    if (match) return localize('com_config_filelimits_key_case', { key: match.value });
    return localize('com_config_filelimits_key_unknown', { key });
  };
  const count = isConfigRecord(value) ? Object.keys(value).length : 0;
  const addLabel = localize('com_config_filelimits_add');

  return (
    <NestedGroup
      label={localize('com_config_filelimits_title')}
      description={localize('com_config_filelimits_desc')}
      sectionId={`section-${ENDPOINTS}`}
      configuredCount={count}
      totalCount={count}
      entries
      onAdd={disabled ? undefined : () => addTriggerRef.current?.()}
      addLabel={addLabel}
      disabled={disabled}
      revealPaths={[ENDPOINTS]}
    >
      <RecordObjectField
        id={toFieldId(ENDPOINTS)}
        path={ENDPOINTS}
        value={value}
        fields={field.children ?? []}
        onChange={(next) => onChange(ENDPOINTS, next)}
        disabled={disabled}
        addTriggerRef={addTriggerRef}
        renderFields={renderCollectionEntryFields}
        editSessionId={editSessionId}
        keyOptions={options}
        validateKey={validateKey}
        addLabel={addLabel}
      />
    </NestedGroup>
  );
}

/**
 * File configuration (WS14): the generic rows and groups, with upload limits
 * per endpoint as a keyed list whose keys come from a combobox (FX-8). MIME
 * lists use the MIME list editor through their field metadata (FX-7).
 */
export function FileConfigRenderer(props: t.FieldRendererProps) {
  const rowFilter = useContext(RowFilterContext);
  const ordered = orderFields(props.fields, SECTION);
  const at = ordered.findIndex((field) => field.key === 'endpoints');
  if (at === -1) return <FieldRenderer {...props} />;
  return (
    <>
      <FieldRenderer {...props} fields={ordered.slice(0, at)} />
      <EndpointLimitsGroup field={ordered[at]} fieldProps={props} />
      <FieldRenderer {...props} fields={ordered.slice(at + 1)} />
      {!rowFilter && (
        <UnknownSettings fields={props.fields} value={props.parentValue} path={SECTION} />
      )}
    </>
  );
}
