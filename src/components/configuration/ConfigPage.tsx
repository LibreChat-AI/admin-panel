import { useState, useMemo, useCallback } from 'react';
import { getRouteApi, useBlocker } from '@tanstack/react-router';
import type * as t from '@/types';
import {
  useLocalize,
  useTabCounts,
  useConfigSave,
  useTabSections,
  useConfigEdits,
  useConfigTabs,
  useProfileMap,
  useConfigLayers,
  useConfigImport,
  useHighlightRef,
  useActiveSection,
  useScopeSelection,
  useResetBaseConfig,
  usePendingConfigValues,
} from '@/hooks';
import { ConfigTableOfContents } from './ConfigTableOfContents';
import { ResetBaseConfigDialog } from './ResetBaseConfigDialog';
import { ConfirmSaveDialog } from './ConfirmSaveDialog';
import { StickyActionBar } from '@/components/shared';
import { ConfigTabContent } from './ConfigTabContent';
import { ImportYamlDialog } from './ImportYamlDialog';
import { ContentToolbar } from './ContentToolbar';
import { SystemCapabilities } from '@/constants';
import { ScopeSelector } from './ScopeSelector';
import { HeaderActions } from './HeaderActions';
import { ConfigTabBar } from './ConfigTabBar';
import { InfoBanner } from './InfoBanner';
import { notifyError } from '@/utils';

const routeApi = getRouteApi('/_app/configuration/');

/** Keys AppService adds to the resolved config that are runtime state, not settings. */
const APP_SERVICE_INTERNAL_KEYS = new Set(['paths', 'config', 'availableTools']);

export function ConfigPage({ initialTab, highlightField, initialScope }: t.ConfigPageProps) {
  const localize = useLocalize();
  const { tree: schemaTree } = routeApi.useLoaderData();

  const {
    sectionPermissions,
    visibleTabs,
    activeTab,
    handleTabChange,
    canManageConfig,
    canEditActiveTab,
    permissions,
  } = useConfigTabs({ schemaTree, initialTab });

  const {
    selectedScope,
    selectScope,
    isEditingScope,
    editingScope,
    scopeSelectorOpen,
    setScopeSelectorOpen,
  } = useScopeSelection({ initialScope });

  const layers = useConfigLayers({ schemaTree, selectedScope, sectionPermissions });
  const { profileMap, handleProfileChange } = useProfileMap(layers.fieldPaths);

  const edits = useConfigEdits({
    isEditingScope,
    flatBaseline: layers.flatBaseline,
    scopeResolvedValues: layers.scopeResolvedValues,
    baseActiveConfigValues: layers.baseActiveConfigValues,
  });
  const { editedValues, isDirty, discardEdits, startNewSession } = edits;

  const activeConfigValues = usePendingConfigValues(layers.displayConfigValues, editedValues);

  const tabConfiguredCounts = useTabCounts({
    schemaTree,
    visibleTabs,
    activeConfiguredPaths: layers.activeConfiguredPaths,
    activeConfigValues,
  });

  const [showConfiguredOnly, setShowConfiguredOnly] = useState(false);

  const shouldBlockNavigation = useCallback(
    ({ current, next }: { current: { pathname: string }; next: { pathname: string } }) => {
      if (!isDirty) return false;
      if (current.pathname === next.pathname) return false;
      return !window.confirm(localize('com_config_unsaved_leave'));
    },
    [isDirty, localize],
  );
  const shouldPromptBeforeUnload = useCallback(() => isDirty, [isDirty]);

  useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    enableBeforeUnload: shouldPromptBeforeUnload,
  });

  const save = useConfigSave({
    schemaTree,
    schemaPathSet: layers.schemaPathSet,
    editingScope,
    layers,
    edits,
  });
  const { closeReview } = save;

  const resetBase = useResetBaseConfig({ onReset: edits.resetEdits });

  const imports = useConfigImport({
    schemaTree,
    schemaPathSet: layers.schemaPathSet,
    writeChanges: save.writeChanges,
    announceWrite: save.announceWrite,
  });

  const handleScopeChange = useCallback(
    (newSelection: t.ScopeSelection) => {
      if (isDirty) {
        if (!window.confirm(localize('com_config_unsaved_leave'))) return;
        discardEdits();
      }
      startNewSession();
      closeReview();
      selectScope(newSelection);
    },
    [isDirty, localize, discardEdits, startNewSession, closeReview, selectScope],
  );

  const highlightRef = useHighlightRef(highlightField);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [tocEl, setTocEl] = useState<HTMLElement | null>(null);
  const scrollCallbackRef = useCallback(
    (el: HTMLDivElement | null) => {
      setScrollEl(el);
      highlightRef(el);
    },
    [highlightRef],
  );
  const setActiveSection = useActiveSection(scrollEl, tocEl, activeTab);

  const sectionsForActiveTab = useTabSections({
    schemaTree,
    activeTab,
    activeConfigValues,
    sectionPermissions,
  });

  /** Top-level settings the bundled schema doesn't know (newer LibreChat), listed read-only on System. */
  const topLevelUnknown = useMemo(() => {
    if (activeTab !== 'system' || !activeConfigValues) return undefined;
    const value: Record<string, t.ConfigValue> = {};
    for (const [key, entry] of Object.entries(activeConfigValues)) {
      if (!APP_SERVICE_INTERNAL_KEYS.has(key)) value[key] = entry;
    }
    return { fields: schemaTree, value };
  }, [activeTab, activeConfigValues, schemaTree]);

  const renderBanner = () => {
    if (imports.importSuccess) {
      return (
        <InfoBanner
          text={imports.importSuccessMessage ?? localize('com_config_import_success')}
          dismissible={false}
        />
      );
    }
    return null;
  };

  const banner = renderBanner();

  const resetBaseTitle = (() => {
    if (!canManageConfig) {
      return localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_CONFIGS });
    }
    if (isDirty) return localize('com_config_reset_base_dirty');
    return undefined;
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2">
      <div className="shrink-0 px-4">
        {banner && <div className="pt-4 pb-2">{banner}</div>}
        <HeaderActions
          showImport
          importDisabled={isDirty || !canManageConfig}
          importTitle={
            !canManageConfig
              ? localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_CONFIGS })
              : undefined
          }
          onImportClick={() => imports.setImportOpen(true)}
          showReset={!isEditingScope && layers.dbOverridePaths.size > 0}
          resetDisabled={isDirty || !canManageConfig}
          resetTitle={resetBaseTitle}
          onResetClick={resetBase.openResetBase}
          showScope={permissions.canView}
          scopeSelection={selectedScope}
          onScopeClick={() => setScopeSelectorOpen(true)}
        />
        <ConfigTabBar
          tabs={visibleTabs}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          tabCounts={tabConfiguredCounts}
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-h-0 flex-1">
          {activeTab !== 'custom' && (
            <div className="pointer-events-none absolute top-2 right-3 z-(--z-floating)">
              <ContentToolbar
                scrollContainer={scrollEl}
                showConfiguredOnly={showConfiguredOnly}
                onShowConfiguredOnlyChange={setShowConfiguredOnly}
                showConfiguredToggle={layers.activeConfiguredPaths.size > 0}
              />
            </div>
          )}
          <div
            className="h-full scrollbar-gutter-stable overflow-auto pl-4"
            ref={scrollCallbackRef}
          >
            <ConfigTabContent
              sections={sectionsForActiveTab}
              configValues={activeConfigValues}
              editedValues={editedValues}
              onFieldChange={edits.handleFieldChange}
              onResetField={edits.handleResetField}
              onDiscardField={edits.handleDiscardField}
              profileMap={profileMap}
              previewMode={false}
              previewScope={editingScope}
              previewChangedPaths={layers.scopeChangedPaths}
              resolvedValues={layers.scopeResolvedValues}
              permissions={permissions}
              onProfileChange={handleProfileChange}
              showChangedOnly={false}
              readOnly={!canEditActiveTab}
              configuredPaths={layers.activeConfiguredPaths}
              dbOverridePaths={layers.overridePaths}
              touchedPaths={edits.touchedPaths}
              pendingResets={edits.pendingResets}
              sectionPermissions={sectionPermissions}
              schemaDefaults={layers.schemaDefaults}
              showConfiguredOnly={showConfiguredOnly}
              isEditingScope={isEditingScope}
              baseRecordKeys={layers.baseRecordKeys}
              onValidationError={(message) => notifyError(message)}
              editSessionId={edits.editSessionId}
              unknownSettings={topLevelUnknown}
            />
          </div>
        </div>
        <ConfigTableOfContents
          sections={sectionsForActiveTab}
          scrollContainer={scrollEl}
          tocRef={setTocEl}
          showConfiguredOnly={showConfiguredOnly}
          configuredPaths={layers.activeConfiguredPaths}
          onNavigate={setActiveSection}
        />
      </div>

      {isDirty && canEditActiveTab && (
        <StickyActionBar
          message={localize('com_config_unsaved_changes')}
          discardLabel={localize('com_config_discard')}
          saveLabel={localize('com_config_save')}
          onDiscard={edits.handleDiscard}
          onSave={save.openReview}
        />
      )}

      <ConfirmSaveDialog
        open={save.confirmSaveOpen}
        title={
          editingScope
            ? localize('com_config_confirm_save_scope_title', { name: editingScope.name })
            : localize('com_config_confirm_save_title')
        }
        editedValues={save.review.editedValues}
        originalValues={save.review.originalValues}
        revertValues={save.review.revertValues}
        skipped={save.savePlan.skipped}
        unsafeKeys={save.unsafeKeys}
        saving={save.saving}
        error={edits.saveError}
        onConfirm={save.handleConfirmSave}
        onCancel={save.cancelReview}
      />

      <ScopeSelector
        open={scopeSelectorOpen}
        onOpenChange={setScopeSelectorOpen}
        currentSelection={selectedScope}
        onSelect={handleScopeChange}
        permissions={permissions}
        onError={(msg) => notifyError(msg)}
      />

      <ImportYamlDialog
        open={imports.importOpen}
        onClose={() => imports.setImportOpen(false)}
        currentScope={editingScope}
        onImport={imports.handleImport}
      />

      <ResetBaseConfigDialog
        open={resetBase.resetBaseOpen}
        resetting={resetBase.resettingBase}
        error={resetBase.resetBaseError}
        onConfirm={resetBase.handleResetBaseConfig}
        onCancel={resetBase.cancelResetBase}
      />
    </div>
  );
}
