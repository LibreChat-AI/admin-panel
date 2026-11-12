import { useContext, useMemo } from 'react';
import type * as t from '@/types';
import { collectLeafPaths, getValueAtPath, isRowVisible } from '@/utils';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../../UnknownSettings';
import { NestedGroup, toFieldId } from '../../renderer';
import { countConfigured, isCountLeaf } from '../../counts';
import { fieldDescription } from '../../renderer/paths';
import { useLocalize, useYamlConfig } from '@/hooks';
import { getFieldMeta, labelForPath } from '../../meta';
import { StaticField } from '../../fields/StaticField';
import { resolveControl } from '../../renderer/kinds';
import { SettingsRow } from '../../SettingsRow';

function YamlRow({ field, path, yaml, yamlPaths, schemaDefaults }: t.YamlRowProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  if (!isRowVisible(rowFilter, path)) return null;
  const label = labelForPath(path, localize);
  if (!isCountLeaf(field)) {
    const children = field.children ?? [];
    const counts = countConfigured(children, path, yamlPaths);
    return (
      <NestedGroup
        label={label}
        sectionId={`section-${path}`}
        configuredCount={counts.configured}
        totalCount={counts.total}
        disabled
        revealPaths={[path]}
      >
        {children.map((child) => (
          <YamlRow
            key={child.key}
            field={child}
            path={`${path}.${child.key}`}
            yaml={yaml}
            yamlPaths={yamlPaths}
            schemaDefaults={schemaDefaults}
          />
        ))}
        {!rowFilter && (
          <UnknownSettings fields={children} value={getValueAtPath(yaml, path)} path={path} />
        )}
      </NestedGroup>
    );
  }
  const id = toFieldId(path);
  const value = getValueAtPath(yaml, path);
  const control = resolveControl({ field, path, value });
  return (
    <SettingsRow
      label={label}
      htmlFor={id}
      description={fieldDescription(field, getFieldMeta(field.path), localize)}
      control={
        <StaticField
          id={id}
          field={field}
          kind={control.kind}
          value={value}
          fallback={schemaDefaults?.[path]}
          unit={control.unit}
          width={control.width}
        />
      }
    />
  );
}

/**
 * Read-only rows of settings LibreChat reads only from librechat.yaml, with
 * their values from that file (else the default): never from an override,
 * nor in a profile from Base, since neither applies. An object nests as a
 * group, so a field a newer schema adds still shows, and so does a key no
 * schema knows.
 */
export function YamlRows({ fields, parentPath, schemaDefaults }: t.YamlRowsProps) {
  const yaml = useYamlConfig();
  const yamlPaths = useMemo(() => new Set(collectLeafPaths(yaml ?? {})), [yaml]);
  return fields.map((field) => (
    <YamlRow
      key={field.key}
      field={field}
      path={`${parentPath}.${field.key}`}
      yaml={yaml}
      yamlPaths={yamlPaths}
      schemaDefaults={schemaDefaults}
    />
  ));
}
