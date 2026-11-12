import { render } from '@testing-library/react';
import { useEffect, useMemo, useState } from 'react';
import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  carryChanges,
  getScopeIndex,
  flattenObject,
  getValueAtPath,
  restateChanges,
  mergeScopeLayer,
  collectLeafPaths,
  createBaseLayers,
  planConfigChanges,
  filterInterfacePermissionChildren,
} from '@/utils';
import { useConfigEdits, useTabSections, runtimeDefaultAt, usePendingConfigValues } from '@/hooks';
import { extractSchemaTree, extractSchemaDefaults } from '@/server/config';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { buildConfigChanges } from '@/components/configuration/edits';
import { collectFieldPaths } from '@/components/configuration/counts';
import { BUNDLED_CONFIG_CONTRACT, getWriteRules } from '@/constants';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { ConfigTabContent } from '@/components/configuration';
import { ScopeActionsContext } from '@/contexts/ScopeContext';
import { RenamesContext } from '@/contexts/RenamesContext';
import { ExpandContext } from '@/contexts/ExpandContext';

/** The schema tree exactly as `extractSchemaTree` returns it (interface permissions included). */
export const RAW_TREE: t.SchemaField[] = extractSchemaTree(configSchema as t.ZodSchemaLike);

/** The schema tree the page receives: the server drops the interface permission fields (Access page). */
export const PAGE_TREE: t.SchemaField[] = RAW_TREE.map((section) =>
  section.key === 'interface' && section.children
    ? { ...section, children: filterInterfacePermissionChildren(section.children) }
    : section,
);

/** jsdom has no ResizeObserver; Radix controls measure themselves with one. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;

const SCHEMA_DEFAULTS = flattenObject(
  extractSchemaDefaults(configSchema as t.ZodSchemaLike) as t.ConfigRecord,
);
const EXPANDED: t.ExpandSignal = { mode: 'expand', seq: 1 };
const IDLE: t.ExpandSignal = { mode: null, seq: 0 };

export interface TabHarnessOptions {
  /** The configuration tab to render (`providers`, `custom`, `specs`, `mcp`, …). */
  tab: string;
  /** The schema tree the page gets from the server; defaults to the real one. */
  tree?: t.SchemaField[];
  /** librechat.yaml as LibreChat loaded it. */
  yaml?: t.ConfigRecord;
  /** The base admin overrides. */
  overrides?: t.ConfigRecord;
  /** The base admin tombstones (none by default). */
  tombstones?: string[];
  /** Press "Expand all" once rendered: every collapsible opens, lazily mounted ones too. */
  expandAll?: boolean;
  /** The connected server's admin config contract; the bundled one (an older server) by default. */
  contract?: t.ConfigContract;
  /** The profiles the page's scope index lists (none by default). */
  profiles?: t.ConfigScope[];
}

export interface TabHarness {
  /** The page's pending edits, as `useConfigEdits` holds them now. */
  edits: () => t.ConfigEditsState;
  /**
   * What Save would write now: the pending edits, with what renamed and
   * duplicated entries carry and the credentials they restate, through the
   * real change and write planners.
   */
  plan: () => t.WritePlan;
}

const NO_TOMBSTONES: string[] = [];

interface HarnessProps extends Required<Omit<TabHarnessOptions, 'expandAll' | 'profiles'>> {
  expandAll: boolean;
  state: { edits: t.ConfigEditsState | null; plan: (() => t.WritePlan) | null };
}

function TabPage({
  tab,
  tree,
  yaml,
  overrides,
  tombstones,
  expandAll,
  contract,
  state,
}: HarnessProps) {
  const schemaPathSet = useMemo(() => new Set(collectFieldPaths(tree)), [tree]);
  const config = useMemo(
    () => mergeScopeLayer(yaml, overrides, tombstones, getWriteRules(contract)),
    [yaml, overrides, tombstones, contract],
  );
  const layers = useMemo(
    () =>
      createBaseLayers(
        {
          config,
          yamlConfig: yaml,
          yamlPaths: collectLeafPaths(yaml),
          dbOverrides: overrides,
          dbTombstones: tombstones,
          schemaDefaults: SCHEMA_DEFAULTS,
        },
        schemaPathSet,
        runtimeDefaultAt,
      ),
    [config, yaml, overrides, tombstones, schemaPathSet],
  );
  const flatBaseline = useMemo(() => flattenObject(config), [config]);
  const edits = useConfigEdits({
    isEditingScope: false,
    flatBaseline,
    scopeResolvedValues: null,
    baseActiveConfigValues: config,
    schemaTree: tree,
    schemaPathSet,
  });
  const shown = usePendingConfigValues(config, edits.editedValues, layers);
  const sectionPermissions = useMemo(
    () =>
      Object.fromEntries(tree.map((section) => [section.key, { canView: true, canEdit: true }])),
    [tree],
  );
  const sections = useTabSections({
    schemaTree: tree,
    activeTab: tab,
    activeConfigValues: shown,
    sectionPermissions,
    editedValues: edits.editedValues,
  });
  const overridePaths = useMemo(() => new Set(layers.baseOverridePaths.paths), [layers]);
  const configuredPaths = useMemo(
    () => new Set([...layers.yamlPaths.paths, ...overridePaths]),
    [layers, overridePaths],
  );

  /** "Expand all" pressed once the tab has loaded, as the toolbar sends it. */
  const [signal, setSignal] = useState(IDLE);
  useEffect(() => {
    if (expandAll) setSignal(EXPANDED);
  }, [expandAll]);

  state.edits = edits;
  state.plan = () => {
    const changes = buildConfigChanges(edits.touchedPaths, edits.editedValues, schemaPathSet, {
      fields: tree,
      baselineAt: (path) => getValueAtPath(config, path),
      hasOverride: (path) => getValueAtPath(overrides, path) !== undefined,
      root: config,
      collections: edits.collectionEdits,
      visibility: edits.visibilityEdits,
      writeRules: getWriteRules(contract),
    });
    const ops = [
      ...changes.ops,
      ...carryChanges(edits.renameEdits, edits.copyEdits),
      ...restateChanges(edits.restateEdits),
    ];
    return planConfigChanges(
      ops,
      { stored: overrides, tombstones, lower: yaml, lowerKind: 'yaml' },
      contract.features,
      getWriteRules(contract),
      contract.limits,
    );
  };

  const renames = useMemo<t.EntryRenames>(
    () => ({ renames: edits.renameEdits, copies: edits.copyEdits }),
    [edits.renameEdits, edits.copyEdits],
  );

  return (
    <ExpandContext.Provider value={signal}>
      <CollectionEditsContext.Provider value={edits.collectionEdits}>
        <RenamesContext.Provider value={renames}>
          <ConfigTabContent
            sections={sections}
            configValues={shown}
            editedValues={edits.editedValues}
            onFieldChange={edits.handleFieldChange}
            onResetField={edits.handleResetField}
            onDiscardField={edits.handleDiscardField}
            previewMode={false}
            permissions={{ canView: true, canEdit: true, canAssign: true }}
            showChangedOnly={false}
            configuredPaths={configuredPaths}
            dbOverridePaths={overridePaths}
            touchedPaths={edits.touchedPaths}
            pendingResets={edits.pendingResets}
            sectionPermissions={sectionPermissions}
            schemaDefaults={SCHEMA_DEFAULTS}
            editSessionId={edits.editSessionId}
            valueLayers={layers}
            visibilityEdits={edits.visibilityEdits}
            onHideField={edits.handleHideField}
            onUnhideField={edits.handleUnhideField}
            onRenameEntry={edits.handleRenameEntry}
          />
        </RenamesContext.Provider>
      </CollectionEditsContext.Provider>
    </ExpandContext.Provider>
  );
}

/**
 * Renders one configuration tab the way the page does in Base: the tab's
 * sections from `useTabSections` over the given schema tree, the real value
 * layers and `useConfigEdits`, and `ConfigTabContent`. `plan()` is what Save
 * would write for the edits made so far.
 */
export function renderTab({
  tab,
  tree = PAGE_TREE,
  yaml = {},
  overrides = {},
  tombstones = NO_TOMBSTONES,
  expandAll = false,
  contract = BUNDLED_CONFIG_CONTRACT,
  profiles = [],
}: TabHarnessOptions): TabHarness & ReturnType<typeof render> {
  const state: HarnessProps['state'] = { edits: null, plan: null };
  const scopeActions: t.ScopeContextValue = {
    selectScope: () => undefined,
    index: getScopeIndex(profiles),
  };
  const result = render(
    <ConfigContractContext.Provider value={contract}>
      <ScopeActionsContext.Provider value={scopeActions}>
        <TabPage
          tab={tab}
          tree={tree}
          yaml={yaml}
          overrides={overrides}
          tombstones={tombstones}
          expandAll={expandAll}
          contract={contract}
          state={state}
        />
      </ScopeActionsContext.Provider>
    </ConfigContractContext.Provider>,
  );
  return {
    ...result,
    edits: () => {
      if (!state.edits) throw new Error('the tab has not rendered');
      return state.edits;
    },
    plan: () => {
      if (!state.plan) throw new Error('the tab has not rendered');
      return state.plan();
    },
  };
}
