import { useState } from 'react';
import { render } from '@testing-library/react';
import { configSchema, PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  flattenObject,
  getValueAtPath,
  setValueAtPath,
  withScopeLayer,
  createBaseLayers,
  collectLeafPaths,
  mergeScopeLayer,
} from '@/utils';
import { extractSchemaTree, extractSchemaDefaults, getSchemaPathSet } from '@/server/config';
import { SECTION_META } from '@/components/configuration/configMeta';
import { ConfigTabContent } from '@/components/configuration';
import { runtimeDefaultAt } from '@/hooks/config/layers';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { BUNDLED_CONFIG_CONTRACT, getWriteRules } from '@/constants';

const TREE = extractSchemaTree(configSchema as t.ZodSchemaLike);
const SCHEMA_DEFAULTS = flattenObject(
  extractSchemaDefaults(configSchema as t.ZodSchemaLike) as t.ConfigRecord,
);
const SCHEMA_PATHS = getSchemaPathSet();

/** A tab's sections built from the real schema, as `useTabSections` does (`extraFields` stands in for a newer schema). */
export function tabSections(
  keys: string[],
  extraFields: Readonly<Record<string, t.SchemaField[]>> = {},
  contract: t.ConfigContract = BUNDLED_CONFIG_CONTRACT,
): t.ConfigSectionConfig[] {
  const { readOnlySections } = getWriteRules(contract);
  return keys.flatMap((key) => {
    const field = TREE.find((section) => section.key === key);
    if (!field) return [];
    const children = [...(field.children ?? []), ...(extraFields[key] ?? [])];
    const structured = (field.isObject || field.type === 'record') && children.length > 0;
    const readOnlyReason = readOnlySections.get(key);
    return [
      {
        id: key,
        titleKey: SECTION_META[key]?.titleKey ?? key,
        descriptionKey: SECTION_META[key]?.descriptionKey,
        fields: structured ? children : [],
        ...(!structured && { sectionField: field }),
        ...(readOnlyReason && { readOnlyReason }),
      },
    ];
  });
}

export interface SectionsHarnessOptions {
  sections: string[];
  /** librechat.yaml as LibreChat loaded it. */
  yaml?: t.ConfigRecord;
  /** The base admin overrides. */
  overrides?: t.ConfigRecord;
  /** The USER role profile's own overrides: renders the sections in profile mode. */
  profile?: t.ConfigRecord;
  /** Called with every staged change, after the harness applies it. */
  onChange?: (path: string, value: t.ConfigValue) => void;
  onReset?: (path: string) => void;
  readOnly?: boolean;
  /** "Set values only" is on. */
  showConfiguredOnly?: boolean;
  /** Fields a newer schema adds to a section, by section key. */
  extraFields?: Readonly<Record<string, t.SchemaField[]>>;
  /** The server's admin config contract (the bundled one: an older server). */
  contract?: t.ConfigContract;
}

/** Profile-mode (USER role) value layers over Base, built by the page's own code. */
function profileLayers(
  base: t.ValueLayers,
  profile: t.ConfigRecord,
  rules: t.ConfigWriteRules,
): t.ValueLayers {
  const paths = collectLeafPaths(profile);
  return withScopeLayer(
    base,
    { principalType: PrincipalType.ROLE, name: 'USER' },
    {
      resolvedConfig: flattenObject(profile),
      changedPaths: paths,
      overrides: profile,
      tombstones: [],
    },
    SCHEMA_PATHS,
    rules,
  );
}

/**
 * Base-mode value layers from a librechat.yaml and base overrides, built by
 * the page's own code under a server's write `rules` (the bundled ones by default).
 */
export function baseLayers(
  yaml: t.ConfigRecord,
  overrides: t.ConfigRecord,
  rules?: t.ConfigWriteRules,
): t.ValueLayers {
  return createBaseLayers(
    {
      config: mergeScopeLayer(yaml, overrides, [], rules),
      yamlConfig: yaml,
      yamlPaths: collectLeafPaths(yaml),
      dbOverrides: overrides,
      dbTombstones: [],
      schemaDefaults: SCHEMA_DEFAULTS,
    },
    SCHEMA_PATHS,
    runtimeDefaultAt,
  );
}

/** The page around a tab's sections; re-render it with new options to keep its staged edits. */
export function SectionsHarness({
  sections,
  yaml = {},
  overrides = {},
  onChange,
  onReset,
  readOnly,
  profile,
  showConfiguredOnly,
  extraFields,
  contract = BUNDLED_CONFIG_CONTRACT,
}: SectionsHarnessOptions) {
  const rules = getWriteRules(contract);
  const base = baseLayers(yaml, overrides, rules);
  const layers = profile ? profileLayers(base, profile, rules) : base;
  const [edited, setEdited] = useState<t.FlatConfigMap>({});
  const [values, setValues] = useState<t.ConfigRecord>(layers.effective ?? {});
  const configured = new Set(
    profile
      ? collectLeafPaths(profile)
      : [...collectLeafPaths(yaml), ...collectLeafPaths(overrides)],
  );
  const stage = (path: string, value: t.ConfigValue) => {
    setEdited((prev) => ({ ...prev, [path]: value }));
    setValues((prev) =>
      setValueAtPath(prev, path, value === undefined ? getValueAtPath(yaml, path) : value),
    );
    onChange?.(path, value);
  };
  const discard = (path: string) => {
    setEdited((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setValues((prev) => setValueAtPath(prev, path, getValueAtPath(layers.effective ?? {}, path)));
  };
  const permissions = Object.fromEntries(
    sections.map((key) => [key, { canView: true, canEdit: true }]),
  );
  return (
    <ConfigContractContext.Provider value={contract}>
      <ConfigTabContent
        sections={tabSections(sections, extraFields, contract)}
        configValues={values}
        editedValues={edited}
        onFieldChange={stage}
        onResetField={(path) => {
          onReset?.(path);
          stage(path, undefined);
        }}
        onDiscardField={discard}
        readOnly={readOnly}
        permissions={{ canView: true, canEdit: !readOnly }}
        sectionPermissions={permissions}
        configuredPaths={configured}
        dbOverridePaths={new Set(collectLeafPaths(overrides))}
        touchedPaths={new Set(Object.keys(edited))}
        pendingResets={new Set()}
        schemaDefaults={SCHEMA_DEFAULTS}
        valueLayers={layers}
        isEditingScope={profile != null}
        showConfiguredOnly={showConfiguredOnly}
      />
    </ConfigContractContext.Provider>
  );
}

/** Renders a tab's sections through the real `ConfigTabContent`, with staged edits applied. */
export function renderSections(options: SectionsHarnessOptions) {
  return render(<SectionsHarness {...options} />);
}
