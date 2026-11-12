import { vi } from 'vitest';
import { useMemo, useState } from 'react';
import { act, render } from '@testing-library/react';
import { configSchema } from 'librechat-data-provider';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import type * as t from '@/types';
import {
  createPathIndex,
  createBaseLayers,
  mergeScopeLayer,
  deriveFieldValue,
  collectLeafPaths,
  filterInterfacePermissionChildren,
  flattenObject,
} from '@/utils';
import { extractSchemaTree, extractSchemaDefaults, getSchemaPathSet } from '@/server/config';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';

const TREE = extractSchemaTree(configSchema as t.ZodSchemaLike);
const SCHEMA_PATHS = getSchemaPathSet();
const SCHEMA_DEFAULTS = flattenObject(
  extractSchemaDefaults(configSchema as t.ZodSchemaLike) as t.ConfigRecord,
);

/** A top-level section's fields, as the page receives them (interface permissions filtered). */
export function sectionFields(key: string): t.SchemaField[] {
  const children = TREE.find((field) => field.key === key)?.children ?? [];
  return key === 'interface' ? filterInterfacePermissionChildren(children) : children;
}

interface SectionSetup {
  section: string;
  /** librechat.yaml (as LibreChat processes it). */
  yaml?: t.ConfigRecord;
  /** Base admin overrides. */
  overrides?: t.ConfigRecord;
  tombstones?: string[];
  edited?: t.FlatConfigMap;
  visibility?: Record<string, t.VisibilityEdit>;
  /** Data paths the tab filter matches. */
  filter?: string[];
  props?: Partial<t.FieldRendererProps>;
  /** Admin config features the server reports (none: an older server). */
  features?: Partial<t.ConfigFeatures>;
  /** The page's query client, with the server reads a test seeds (none: nothing is fetched). */
  client?: QueryClient;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * Renders a section renderer the way the configuration page does: real
 * schema fields, base value layers built from librechat.yaml and overrides,
 * `getValue` reading those layers, and pending edits and hides kept in state
 * (so a hide or an edit re-renders the section). Every edit callback is a
 * spy that also applies the edit.
 */
export function renderSection(Component: ComponentType<t.FieldRendererProps>, setup: SectionSetup) {
  const { section, yaml = {}, overrides = {}, tombstones = [] } = setup;
  const layers = createBaseLayers(
    {
      config: mergeScopeLayer(yaml, overrides),
      yamlConfig: yaml,
      yamlPaths: collectLeafPaths(yaml),
      dbOverrides: overrides,
      dbTombstones: tombstones,
      schemaDefaults: SCHEMA_DEFAULTS,
    },
    SCHEMA_PATHS,
  );
  const spies = {
    onChange: vi.fn(),
    onResetField: vi.fn(),
    onDiscardField: vi.fn(),
    onHideField: vi.fn(),
    onUnhideField: vi.fn(),
  };
  const configuredPaths = new Set([...collectLeafPaths(yaml), ...collectLeafPaths(overrides)]);
  const filter = setup.filter ? createPathIndex(setup.filter) : null;
  const contract: t.ConfigContract = {
    ...BUNDLED_CONFIG_CONTRACT,
    features: { ...BUNDLED_CONFIG_CONTRACT.features, ...setup.features },
  };
  let newSession = () => {};

  function Page() {
    const [edited, setEdited] = useState<t.FlatConfigMap>(setup.edited ?? {});
    const [visibility, setVisibility] = useState<Record<string, t.VisibilityEdit>>(
      setup.visibility ?? {},
    );
    const [editSessionId, setEditSessionId] = useState(0);
    newSession = () => {
      setEdited({});
      setVisibility({});
      setEditSessionId((id) => id + 1);
    };
    const values = useMemo<t.ConfigValuesData>(
      () => ({
        configValues: layers.effective,
        editedValues: edited,
        schemaDefaults: layers.schemaDefaults,
        isEditingScope: false,
        layers,
        visibilityEdits: visibility,
      }),
      [edited, visibility],
    );
    const props: t.FieldRendererProps = {
      fields: sectionFields(section),
      parentValue: layers.effective?.[section],
      parentPath: section,
      getValue: (path, fallback) => deriveFieldValue(path, fallback, values),
      editedValues: edited,
      configuredPaths,
      dbOverridePaths: new Set(collectLeafPaths(overrides)),
      permissions: { canView: true, canEdit: true, canAssign: true },
      editSessionId,
      onChange: (path, value) => {
        spies.onChange(path, value);
        setEdited((prev) => ({ ...prev, [path]: value }));
      },
      onResetField: spies.onResetField,
      onDiscardField: (path) => {
        spies.onDiscardField(path);
        setEdited((prev) => withoutKey(prev, path));
        setVisibility((prev) => withoutKey(prev, path));
      },
      onHideField: (path) => {
        spies.onHideField(path);
        setVisibility((prev) => ({ ...prev, [path]: 'hide' }));
      },
      onUnhideField: (path) => {
        spies.onUnhideField(path);
        setVisibility((prev) => ({ ...prev, [path]: 'unhide' }));
      },
      ...setup.props,
    };
    return (
      <ConfigContractContext.Provider value={contract}>
        <ConfigValuesProvider value={values}>
          <RowFilterContext.Provider value={filter}>
            <Component {...props} />
          </RowFilterContext.Provider>
        </ConfigValuesProvider>
      </ConfigContractContext.Provider>
    );
  }

  /** Discards every pending edit and starts a new edit session, as Discard does on the page. */
  const startNewSession = () => act(() => newSession());
  const page = setup.client ? (
    <QueryClientProvider client={setup.client}>
      <Page />
    </QueryClientProvider>
  ) : (
    <Page />
  );
  return { ...render(page), ...spies, startNewSession };
}
