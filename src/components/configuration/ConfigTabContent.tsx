import { Button } from '@clickhouse/click-ui';
import { useMemo, useEffect, useContext } from 'react';
import type { KeyboardEvent } from 'react';
import type * as t from '@/types';
import {
  SECTION_RENDERERS,
  READ_ONLY_DETAIL_KEYS,
  SECTION_GROUP_RENDERERS,
  UNFOLDED_READ_ONLY_SECTIONS,
  SELF_CONTAINED_SECTION_RENDERERS,
} from './sections';
import {
  countSection,
  hasPendingValueIn,
  countSectionOverrides,
  countEntrySectionOverrides,
} from './counts';
import { useLocalize, useAnnouncement, useConfigContract } from '@/hooks';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { RevealTargetContext } from '@/contexts/RevealTargetContext';
import { FieldRenderer, SingleFieldRenderer } from './renderer';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { deriveFieldValue, isSectionDisabled } from '@/utils';
import { ScreenReaderAnnouncer } from '@/components/shared';
import { SECTION_META, isPathInSection } from './configMeta';
import { ReadOnlySection } from './ReadOnlySection';
import { UnknownSettings } from './UnknownSettings';
import { ConfigSection } from './ConfigSection';
import { CodeField } from './fields/CodeField';
import { InfoBanner } from './InfoBanner';
import { ScopeGate } from './ScopeGate';
import { getWriteRules } from '@/constants';

/**
 * Enter in an input of the tab form must never submit it (and so "click" its
 * default button). Dialogs portaled from the tab (Create MCP server, Create
 * endpoint) are left alone: their keydown bubbles here through the React
 * tree, but they live outside the form's DOM and keep Enter-to-submit.
 */
function preventImplicitSubmit(event: KeyboardEvent<HTMLFormElement>) {
  const { target } = event;
  if (event.key !== 'Enter' || !(target instanceof HTMLInputElement)) return;
  if (event.currentTarget.contains(target)) event.preventDefault();
}

/** One row's worth of field: a scalar or a list of scalars (no nested fields, records or objects). */
function isSimpleScalar(f: t.SchemaField): boolean {
  return !f.children?.length && f.type !== 'record' && f.type !== 'object';
}

/** Why the tab shows no settings (a filter, "Set values only"), also put in the tab's status region. */
function EmptyTabState({ message, action, onShown }: t.EmptyTabStateProps) {
  useEffect(() => {
    onShown(message);
    return () => onShown('');
  }, [message, onShown]);
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-(--cui-color-text-muted)">
      <span className="text-sm">{message}</span>
      {action}
    </div>
  );
}

/**
 * The open tab's settings. Why it shows none (a filter that matches nothing,
 * "Set values only") is a status message (WCAG 4.1.3) from a region that
 * stays mounted while the settings come and go, so screen readers hear it
 * arrive.
 */
export function ConfigTabContent(props: t.ConfigTabContentProps) {
  const { message, announce } = useAnnouncement();
  return (
    <>
      <ScreenReaderAnnouncer message={message} />
      <TabSettings {...props} onEmptyState={announce} />
    </>
  );
}

function TabSettings({
  sections,
  configValues,
  editedValues,
  onFieldChange,
  onResetField,
  onDiscardField,
  previewMode,
  previewScope,
  previewChangedPaths,
  resolvedValues,
  permissions,
  showChangedOnly,
  readOnly,
  configuredPaths,
  dbOverridePaths,
  listOverrideCounts,
  touchedPaths,
  pendingResets,
  sectionPermissions,
  schemaDefaults,
  showConfiguredOnly,
  isEditingScope,
  baseRecordKeys,
  onValidationError,
  editSessionId,
  unknownSettings,
  valueLayers,
  visibilityEdits,
  onHideField,
  onUnhideField,
  onRenameEntry,
  visibleSectionIds,
  filterPaths,
  filterText,
  onClearFilter,
  onShowAll,
  onEmptyState,
}: t.TabSettingsProps) {
  const localize = useLocalize();
  const revealTarget = useContext(RevealTargetContext);
  const fieldsDisabled = readOnly;

  const filtering = showChangedOnly;

  const sectionHasChanges = useMemo(() => {
    if (!filtering || !previewChangedPaths) return null;
    const pathSet = new Set(previewChangedPaths);
    const result: Record<string, boolean> = {};
    for (const section of sections) {
      result[section.id] = section.sectionField
        ? pathSet.has(section.id)
        : hasChangedDescendant(section.fields, section.id, pathSet);
    }
    return result;
  }, [filtering, previewChangedPaths, sections]);

  /**
   * Counted over the fields each section shows (custom endpoints and providers
   * split `endpoints`). In a profile a section's count already is what it
   * sets, so only collections add the entries it overrides or hides.
   */
  const sectionCounts = useMemo(() => {
    const overridesOf = (section: t.ConfigSectionConfig): number => {
      if (isEditingScope && configuredPaths) {
        return countEntrySectionOverrides(section, configuredPaths, listOverrideCounts) ?? 0;
      }
      if (!dbOverridePaths) return 0;
      return countSectionOverrides(section, dbOverridePaths, listOverrideCounts);
    };
    return sections.map((s) => {
      const dataKey = s.schemaKey ?? s.id;
      const fields = s.fields.filter((f) => isPathInSection(s.id, dataKey, `${dataKey}.${f.key}`));
      const section = { ...s, fields };
      return {
        id: s.id,
        ...countSection(section, configuredPaths, configValues),
        overrides: overridesOf(section),
      };
    });
  }, [
    sections,
    configuredPaths,
    configValues,
    isEditingScope,
    dbOverridePaths,
    listOverrideCounts,
  ]);

  const countsById = useMemo(() => {
    const map: Record<string, t.SectionCount> = {};
    for (const { id, ...count } of sectionCounts) map[id] = count;
    return map;
  }, [sectionCounts]);

  const contract = useConfigContract();
  const valuesData = useMemo<t.ConfigValuesData>(
    () => ({
      writeRules: getWriteRules(contract),
      titleResolution: contract.rules.titleResolution,
      configValues,
      editedValues,
      resolvedValues,
      schemaDefaults,
      configuredPaths,
      overridePaths: dbOverridePaths,
      pendingResets,
      isEditingScope,
      layers: valueLayers,
      visibilityEdits,
    }),
    [
      configValues,
      editedValues,
      resolvedValues,
      schemaDefaults,
      configuredPaths,
      dbOverridePaths,
      pendingResets,
      isEditingScope,
      valueLayers,
      visibilityEdits,
      contract,
    ],
  );

  const getValue = (path: string, fallback: t.ConfigValue): t.ConfigValue =>
    deriveFieldValue(path, fallback, valuesData);

  if (sections.length === 0) {
    return (
      <div className="py-6">
        <CodeField
          id="config-raw"
          value={configValues}
          onChange={(v) => onFieldChange('_root', v)}
        />
      </div>
    );
  }

  let visibleSections =
    filtering && sectionHasChanges ? sections.filter((s) => sectionHasChanges[s.id]) : sections;

  if (showConfiguredOnly && !previewMode) {
    visibleSections = visibleSections.filter(
      (s) => (countsById[s.id]?.configured ?? 0) > 0 || hasPendingValueIn(s, editedValues),
    );
  }

  if (visibleSectionIds) {
    visibleSections = visibleSections.filter((s) => visibleSectionIds.has(s.id));
  }

  if (visibleSections.length === 0 && filtering) {
    return (
      <EmptyTabState message={localize('com_scope_no_changed_in_tab')} onShown={onEmptyState} />
    );
  }

  if (visibleSections.length === 0 && visibleSectionIds) {
    return (
      <EmptyTabState
        message={localize('com_config_shell_filter_empty', { query: filterText ?? '' })}
        onShown={onEmptyState}
        action={
          onClearFilter && (
            <Button
              htmlType="button"
              type="secondary"
              label={localize('com_config_shell_clear_filter')}
              onClick={onClearFilter}
            />
          )
        }
      />
    );
  }

  if (visibleSections.length === 0 && showConfiguredOnly) {
    return (
      <EmptyTabState
        message={localize('com_config_shell_nothing_customized')}
        onShown={onEmptyState}
        action={
          onShowAll && (
            <Button
              htmlType="button"
              type="secondary"
              label={localize('com_config_shell_show_all')}
              onClick={onShowAll}
            />
          )
        }
      />
    );
  }

  const isSectionReadOnly = (section: t.ConfigSectionConfig): boolean =>
    section.scopeGate != null ||
    section.readOnlyReason != null ||
    isSectionDisabled(!!fieldsDisabled, sectionPermissions, section.schemaKey ?? section.id);

  const buildFieldRendererProps = (section: t.ConfigSectionConfig): t.FieldRendererProps => {
    const dataKey = section.schemaKey ?? section.id;
    const sectionDisabled = isSectionReadOnly(section);
    return {
      fields: section.fields,
      parentValue: configValues?.[dataKey],
      parentPath: dataKey,
      getValue,
      onChange: onFieldChange,
      onResetField,
      onDiscardField,
      onHideField: sectionDisabled ? undefined : onHideField,
      editedValues,
      disabled: sectionDisabled,
      previewMode,
      previewScope,
      previewChangedPaths,
      resolvedValues,
      permissions,
      showChangedOnly,
      configuredPaths,
      dbOverridePaths,
      touchedPaths,
      pendingResets,
      schemaDefaults,
      showConfiguredOnly,
      isEditingScope,
      yamlBaseKeys: baseRecordKeys?.[dataKey],
      onValidationError,
      editSessionId,
      onUnhideField: sectionDisabled ? undefined : onUnhideField,
      onRenameEntry,
    };
  };

  const renderSectionContent = (section: t.ConfigSectionConfig) => {
    const dataKey = section.schemaKey ?? section.id;
    const sectionValue = configValues?.[dataKey];
    const sectionDisabled = isSectionReadOnly(section);
    const CustomSectionRenderer =
      section.fields.length > 0 ? SECTION_RENDERERS[section.id] : undefined;
    const fieldRendererProps = buildFieldRendererProps(section);
    const content = (
      <>
        {section.bannerText && !section.readOnlyReason && !section.scopeGate && (
          <div className="mb-4">
            <InfoBanner
              text={section.bannerText}
              link={section.bannerLink}
              dismissible
              dismissKey={`section:${section.id}`}
            />
          </div>
        )}
        {section.fields.length > 0 &&
          (CustomSectionRenderer ? (
            <CustomSectionRenderer {...fieldRendererProps} />
          ) : (
            <FieldRenderer {...fieldRendererProps} />
          ))}
        {section.fields.length > 0 &&
          !CustomSectionRenderer &&
          !section.isRecord &&
          !filterPaths && (
            <UnknownSettings fields={section.fields} value={sectionValue} path={dataKey} />
          )}
        {section.fields.length === 0 && section.sectionField && (
          <SingleFieldRenderer
            field={section.sectionField}
            value={sectionValue}
            path={section.id}
            getValue={getValue}
            onChange={onFieldChange}
            onResetField={onResetField}
            disabled={sectionDisabled}
            permissions={permissions}
            previewMode={previewMode}
            previewScope={previewScope}
            previewChangedPaths={previewChangedPaths}
            resolvedValues={resolvedValues}
            configuredPaths={configuredPaths}
            dbOverridePaths={dbOverridePaths}
            touchedPaths={touchedPaths}
            pendingResets={pendingResets}
            schemaDefaults={schemaDefaults}
            showConfiguredOnly={showConfiguredOnly}
            isSoleField={!section.sectionField.isArray && section.sectionField.type !== 'record'}
          />
        )}
        {section.fields.length === 0 && !section.sectionField && (
          <CodeField
            id={`${section.id}-raw`}
            value={sectionValue}
            onChange={(v) => onFieldChange(section.id, v)}
            disabled={sectionDisabled}
          />
        )}
      </>
    );
    if (section.scopeGate) {
      return (
        <ScopeGate
          reason={section.scopeGate}
          title={section.title ?? localize(section.titleKey)}
          section={dataKey}
        >
          {content}
        </ScopeGate>
      );
    }
    if (!section.readOnlyReason) return content;
    /** A single-field section is its row: nothing to fold. */
    const isEmpty =
      countsById[section.id]?.configured === 0 &&
      !UNFOLDED_READ_ONLY_SECTIONS.has(section.id) &&
      !isInlineSection(section);
    const detailKey = READ_ONLY_DETAIL_KEYS[section.id];
    const reveal =
      revealTarget != null && (revealTarget === dataKey || revealTarget.startsWith(`${dataKey}.`));
    return (
      <ReadOnlySection
        reason={section.readOnlyReason}
        message={detailKey ? localize(detailKey) : undefined}
        isEmpty={isEmpty && !filterPaths}
        reveal={reveal}
      >
        {content}
      </ReadOnlySection>
    );
  };

  const isInlineSection = (section: t.ConfigSectionConfig): boolean =>
    Boolean(
      (section.sectionField && isSimpleScalar(section.sectionField)) ||
      (section.fields.length === 1 && isSimpleScalar(section.fields[0])),
    );

  type SectionGroup =
    | { kind: 'inline'; section: t.ConfigSectionConfig }
    | { kind: 'accordion'; sections: t.ConfigSectionConfig[] }
    | { kind: 'flat'; section: t.ConfigSectionConfig }
    | { kind: 'group'; key: string; sections: t.ConfigSectionConfig[] };

  const groups = visibleSections.reduce<SectionGroup[]>((acc, section) => {
    /** Sections sharing a `SectionMeta.group` with a group renderer render as one card (e.g. Storage). */
    const groupKey = SECTION_META[section.id]?.group;
    if (groupKey && SECTION_GROUP_RENDERERS[groupKey]) {
      const existing = acc.find(
        (g): g is Extract<SectionGroup, { kind: 'group' }> =>
          g.kind === 'group' && g.key === groupKey,
      );
      if (existing) existing.sections.push(section);
      else acc.push({ kind: 'group', key: groupKey, sections: [section] });
      return acc;
    }
    if (SELF_CONTAINED_SECTION_RENDERERS.has(section.id)) {
      acc.push({ kind: 'flat', section });
      return acc;
    }
    if (isInlineSection(section)) {
      acc.push({ kind: 'inline', section });
      return acc;
    }
    const last = acc[acc.length - 1];
    if (last?.kind === 'accordion') {
      last.sections.push(section);
    } else {
      acc.push({ kind: 'accordion', sections: [section] });
    }
    return acc;
  }, []);

  return (
    <ConfigValuesProvider value={valuesData}>
      <RowFilterContext.Provider value={filterPaths ?? null}>
        <form
          aria-label={localize('com_nav_configuration')}
          onSubmit={(e) => e.preventDefault()}
          onKeyDown={preventImplicitSubmit}
          className="settings-content flex flex-col gap-4 py-4"
        >
          <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />
          {groups.map((group) => {
            if (group.kind === 'group') {
              const GroupRenderer = SECTION_GROUP_RENDERERS[group.key];
              if (!GroupRenderer) return null;
              return (
                <GroupRenderer
                  key={group.key}
                  sections={group.sections}
                  propsFor={buildFieldRendererProps}
                  renderSection={renderSectionContent}
                  counts={countsById}
                  showConfiguredOnly={showConfiguredOnly}
                />
              );
            }
            if (group.kind === 'flat') {
              return (
                <div key={group.section.id} id={`section-${group.section.id}`}>
                  {renderSectionContent(group.section)}
                </div>
              );
            }
            if (group.kind === 'inline') {
              const { section } = group;
              const counts = countsById[section.id];
              return (
                <ConfigSection
                  key={section.id}
                  sectionId={section.id}
                  title={section.title ?? localize(section.titleKey)}
                  description={
                    section.descriptionKey ? localize(section.descriptionKey) : undefined
                  }
                  learnMoreUrl={section.learnMoreUrl}
                  configuredCount={counts?.configured ?? 0}
                  totalCount={counts?.total ?? 0}
                  countsEntries={counts?.entries}
                  overrideCount={counts?.overrides}
                  inline
                  showConfiguredOnly={showConfiguredOnly}
                >
                  {renderSectionContent(section)}
                </ConfigSection>
              );
            }
            return group.sections.map((section) => {
              const counts = countsById[section.id];
              return (
                <ConfigSection
                  key={section.id}
                  sectionId={section.id}
                  title={section.title ?? localize(section.titleKey)}
                  description={
                    section.descriptionKey ? localize(section.descriptionKey) : undefined
                  }
                  learnMoreUrl={section.learnMoreUrl}
                  configuredCount={counts?.configured ?? 0}
                  totalCount={counts?.total ?? 0}
                  countsEntries={counts?.entries}
                  overrideCount={counts?.overrides}
                  defaultExpanded
                  showConfiguredOnly={showConfiguredOnly}
                >
                  {renderSectionContent(section)}
                </ConfigSection>
              );
            });
          })}
          {unknownSettings && !filterPaths && (
            <UnknownSettings
              fields={unknownSettings.fields}
              value={unknownSettings.value}
              path=""
            />
          )}
        </form>
      </RowFilterContext.Provider>
    </ConfigValuesProvider>
  );
}

function hasChangedDescendant(
  fields: t.SchemaField[],
  parentPath: string,
  pathSet: Set<string>,
): boolean {
  for (const field of fields) {
    const path = `${parentPath}.${field.key}`;
    if (pathSet.has(path)) return true;
    if (field.children && field.children.length > 0) {
      if (hasChangedDescendant(field.children, path, pathSet)) return true;
    }
  }
  return false;
}
