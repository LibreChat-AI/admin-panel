import { useContext } from 'react';
import type * as t from '@/types';
import { countConfigured, isPathSet } from '../../counts';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../../UnknownSettings';
import { isConfigRecord, isRowVisible } from '@/utils';
import { NestedGroup } from '../../renderer';
import { labelForPath } from '../../meta';
import { FeatureFields } from './Fields';
import { useLocalize } from '@/hooks';

/** The group's fields in its own order; keys the schema doesn't have are skipped. */
export function groupFields(group: t.FeatureGroupDef, fields: t.SchemaField[]): t.SchemaField[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  return group.fields.flatMap((key) => byKey.get(key) ?? []);
}

/** The data paths a group shows: its fields, and the children of the ones it flattens. */
function groupPaths(group: t.FeatureGroupDef, fields: t.SchemaField[], parentPath: string) {
  const flatten = new Set(group.flatten);
  return fields.flatMap((field) => {
    const path = `${parentPath}.${field.key}`;
    if (!flatten.has(field.key) || !field.children?.length) return [path];
    return field.children.map((child) => `${path}.${child.key}`);
  });
}

/**
 * A sub-heading and the rows of an object field shown flat inside a group
 * (Privacy policy's URL and new-tab switch under "Onboarding & legal"). The
 * heading carries the object's section id, so table-of-contents links and
 * search still land on it.
 */
function FlatObject({ field, controls, titled, ...props }: t.FlatObjectProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const path = `${props.parentPath}.${field.key}`;
  const values = isConfigRecord(props.parentValue) ? props.parentValue : {};
  const value = values[field.key];
  const children = field.children ?? [];
  const hidesUnset =
    props.showConfiguredOnly &&
    !props.previewMode &&
    !isPathSet(path, props.configuredPaths, props.editedValues);
  if (!isRowVisible(rowFilter, path) || hidesUnset) return null;
  return (
    <>
      {titled ? (
        <h4
          id={`section-${path}`}
          className="m-0 scroll-mt-24 pt-3 pb-1 text-xs font-semibold tracking-wide text-(--settings-muted-fg) uppercase"
        >
          {labelForPath(field.path, localize)}
        </h4>
      ) : (
        <div id={`section-${path}`} className="h-0 scroll-mt-24" aria-hidden="true" />
      )}
      <FeatureFields
        {...props}
        fields={children}
        parentPath={path}
        parentValue={isConfigRecord(value) ? value : {}}
        controls={controls}
      />
      {!rowFilter && <UnknownSettings fields={children} value={value} path={path} />}
    </>
  );
}

/**
 * A purpose-based group of a feature section's settings (FX-5): a
 * collapsible heading with its set count, the listed fields in order, and
 * flattened objects under sub-headings. Hidden while the tab filter or "Set
 * values only" (saved or pending values) leaves none of its rows.
 */
export function FeatureGroup({ group, allFields, controls, ...props }: t.FeatureGroupProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const { parentPath, configuredPaths, editedValues, showConfiguredOnly, previewMode } = props;
  const fields = groupFields(group, allFields);
  const paths = groupPaths(group, fields, parentPath);
  const visible = paths.some(
    (path) =>
      isRowVisible(rowFilter, path) &&
      (!showConfiguredOnly || previewMode || isPathSet(path, configuredPaths, editedValues)),
  );
  if (fields.length === 0 || !visible) return null;

  const flatten = new Set(group.flatten);
  const counts = fields.reduce(
    (sum, field) => {
      const path = `${parentPath}.${field.key}`;
      const own =
        flatten.has(field.key) && field.children?.length
          ? countConfigured(field.children, path, configuredPaths)
          : countConfigured([field], parentPath, configuredPaths);
      return { total: sum.total + own.total, configured: sum.configured + own.configured };
    },
    { total: 0, configured: 0 },
  );

  return (
    <NestedGroup
      label={localize(group.labelKey)}
      sectionId={`section-${parentPath}-group-${group.key}`}
      configuredCount={counts.configured}
      totalCount={counts.total}
      defaultExpanded
      disabled={props.disabled}
      revealPaths={paths}
    >
      {group.descriptionKey && (
        <p className="m-0 pb-1 text-(length:--settings-fs-help) text-(--cui-color-text-muted)">
          {localize(group.descriptionKey)}
        </p>
      )}
      {fields.map((field) =>
        flatten.has(field.key) && field.children?.length ? (
          <FlatObject
            key={field.key}
            {...props}
            field={field}
            controls={controls}
            titled={fields.length > 1 && (field.children?.length ?? 0) > 1}
          />
        ) : (
          <FeatureFields key={field.key} {...props} fields={[field]} controls={controls} />
        ),
      )}
    </NestedGroup>
  );
}
