import { useContext } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { formatSummary, flattenedObject, summarizeFields, createSummaryReader } from './layout';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { countConfigured, hasPendingValue } from '../../counts';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { useLocalize, usePersistentExpanded } from '@/hooks';
import { UnknownSettings } from '../../UnknownSettings';
import { SettingsSection } from '../../SettingsSection';
import { isConfigRecord, isRowVisible } from '@/utils';
import { FieldRenderer } from '../../renderer';
import { SetBadge } from './SetBadge';

export const PROVIDERS_STORAGE_KEY = 'providers';

/** The group's fields as runs of rows, with declared pairs side by side (recursion limits). */
function rowsOf(fields: t.SchemaField[], pairs: Array<[string, string]> = []): t.FieldRun[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const partnerOf = new Map(pairs.filter(([a, b]) => byKey.has(a) && byKey.has(b)));
  const consumed = new Set(partnerOf.values());
  const runs: t.FieldRun[] = [];
  let run: t.SchemaField[] = [];
  for (const field of fields) {
    if (consumed.has(field.key)) continue;
    const partner = byKey.get(partnerOf.get(field.key) ?? '');
    if (!partner) {
      run.push(field);
      continue;
    }
    if (run.length) runs.push({ fields: run, pair: false });
    run = [];
    runs.push({ fields: [field, partner], pair: true });
  }
  if (run.length) runs.push({ fields: run, pair: false });
  return runs;
}

/**
 * One purpose group of a provider card (AP-4): a collapsible h3 group that
 * remembers whether it was open (AP-8). Collapsed, its header carries how
 * many settings are set and what they are ("Title model: gpt-5-mini ·
 * Method: Structured"); expanded, what the group is for. A group made of
 * one plain object (Checkpointer) shows that object's rows directly.
 */
export function ProviderGroup({
  group,
  providerPath,
  providerValue,
  stateId,
  notice,
  summaryOverride,
  countBadge,
  before,
  after,
  hiddenKeys,
  ...rendererProps
}: t.ProviderGroupSectionProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const values = useContext(ConfigValuesContext);
  const { def, fields } = group;
  const { configuredPaths, dbOverridePaths, editedValues, showConfiguredOnly, getValue } =
    rendererProps;
  const paths = fields.map((field) => `${providerPath}.${field.key}`);
  const { isExpanded, sectionRef, toggle } = usePersistentExpanded({
    storageKey: PROVIDERS_STORAGE_KEY,
    id: stateId,
    defaultExpanded: def.expanded,
    revealPaths: paths,
  });

  const { configured } = countConfigured(fields, providerPath, configuredPaths);
  const overrides = dbOverridePaths
    ? countConfigured(fields, providerPath, dbOverridePaths, true).configured
    : 0;
  const rowFields = hiddenKeys ? fields.filter((field) => !hiddenKeys.has(field.key)) : fields;
  const hasContent = rowFields.length > 0 || before != null || after != null;
  if (!hasContent) return null;
  if (rowFilter && !paths.some((path) => isRowVisible(rowFilter, path))) return null;
  if (
    showConfiguredOnly &&
    !rowFilter &&
    configured === 0 &&
    !paths.some((path) => hasPendingValue(path, editedValues))
  ) {
    return null;
  }

  const flat = flattenedObject({ def, fields: rowFields });
  const parentValue = isConfigRecord(providerValue) ? providerValue : {};
  const summary = isExpanded
    ? undefined
    : (summaryOverride ??
      formatSummary(
        summarizeFields(
          rowFields,
          providerPath,
          createSummaryReader({
            providerPath,
            providerValue: parentValue,
            getValue,
            configuredPaths,
            editedValues,
            root: values?.configValues ?? null,
            titleResolution: values?.titleResolution,
          }),
          localize,
        ),
        localize,
        2,
      ));

  const renderFields = (rowFields: t.SchemaField[], key: string) => (
    <FieldRenderer
      key={key}
      {...rendererProps}
      fields={rowFields}
      parentPath={providerPath}
      parentValue={parentValue}
    />
  );

  let body: ReactNode;
  if (flat) {
    const objectPath = `${providerPath}.${flat.key}`;
    const objectValue = getValue(objectPath, parentValue[flat.key]);
    body = (
      <>
        <FieldRenderer
          {...rendererProps}
          fields={flat.children ?? []}
          parentPath={objectPath}
          parentValue={isConfigRecord(objectValue) ? objectValue : {}}
        />
        {!rowFilter && (
          <UnknownSettings fields={flat.children ?? []} value={objectValue} path={objectPath} />
        )}
      </>
    );
  } else {
    body = rowsOf(rowFields, def.pairs).map((run) =>
      run.pair ? (
        <div key={run.fields[0].key} className="provider-pair">
          {run.fields.map((field) => (
            <div key={field.key} className="provider-pair-cell">
              {renderFields([field], field.key)}
            </div>
          ))}
        </div>
      ) : (
        renderFields(run.fields, run.fields[0].key)
      ),
    );
  }

  return (
    <SettingsSection
      id={`section-${providerPath}-${def.key}`}
      sectionRef={sectionRef}
      variant="group"
      title={localize(def.labelKey)}
      badge={
        <>
          {countBadge}
          <SetBadge count={configured} overrides={overrides} />
          {summary && (
            <span className="provider-group-summary" title={summary}>
              {summary}
            </span>
          )}
        </>
      }
      description={isExpanded && def.descriptionKey ? localize(def.descriptionKey) : undefined}
      expanded={isExpanded}
      onToggle={toggle}
      hasEverExpanded
    >
      {notice}
      {before}
      {body}
      {after}
    </SettingsSection>
  );
}
