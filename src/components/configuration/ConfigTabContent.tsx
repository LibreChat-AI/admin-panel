import { useMemo } from 'react';
import { MultiAccordion } from '@clickhouse/click-ui';
import type { KeyboardEvent } from 'react';
import type * as t from '@/types';
import { SECTION_RENDERERS, SELF_CONTAINED_SECTION_RENDERERS } from './sections';
import { FieldRenderer, SingleFieldRenderer } from './FieldRenderer';
import { hasDescendant, resolveFieldValue } from './utils';
import { UnknownSettings } from './UnknownSettings';
import { ConfigSection } from './ConfigSection';
import { CodeField } from './fields/CodeField';
import { isSectionDisabled } from '@/utils';
import { InfoBanner } from './InfoBanner';
import { useLocalize } from '@/hooks';

/** Sections where the configured count should reflect record entries rather
 *  than leaf schema paths. Add section IDs here for any record-type section
 *  whose schema describes the value shape (not the entry keys). */
const RECORD_ENTRY_COUNT_SECTIONS = new Set(['mcpServers']);

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

function isSimpleScalar(f: t.SchemaField): boolean {
  return !f.children?.length && !f.isArray && f.type !== 'record' && f.type !== 'object';
}

function countLeafFields(fields: t.SchemaField[], parentPath: string): string[] {
  const paths: string[] = [];
  for (const field of fields) {
    const path = `${parentPath}.${field.key}`;
    if (field.children && field.children.length > 0) {
      paths.push(...countLeafFields(field.children, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

export function ConfigTabContent({
  sections,
  configValues,
  editedValues,
  onFieldChange,
  onResetField,
  onDiscardField,
  profileMap,
  previewMode,
  previewScope,
  previewChangedPaths,
  resolvedValues,
  permissions,
  onProfileChange,
  showChangedOnly,
  readOnly,
  configuredPaths,
  dbOverridePaths,
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
}: t.ConfigTabContentProps) {
  const localize = useLocalize();
  const fieldsDisabled = readOnly;

  const getValue = (path: string, fallback: t.ConfigValue): t.ConfigValue =>
    resolveFieldValue(path, fallback, editedValues, resolvedValues, schemaDefaults);

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

  const sectionCounts = useMemo(() => {
    return sections.map((s) => {
      const key = s.schemaKey ?? s.id;

      // Record-type sections (e.g. mcpServers): count entries in the record
      // value rather than leaf schema paths, since the schema describes the
      // *value* shape while configured paths include dynamic entry keys
      // (mcpServers.cloudflare.type, not mcpServers.type).
      if (RECORD_ENTRY_COUNT_SECTIONS.has(s.id) && configValues) {
        const sectionValue = configValues[key];
        if (sectionValue && typeof sectionValue === 'object' && !Array.isArray(sectionValue)) {
          const count = Object.keys(sectionValue as Record<string, unknown>).length;
          return { id: s.id, total: count, configured: count };
        }
      }

      const leafPaths = s.sectionField ? [key] : countLeafFields(s.fields, key);
      if (!configuredPaths || configuredPaths.size === 0) {
        return { id: s.id, total: leafPaths.length, configured: 0 };
      }
      let configured = 0;
      for (const p of leafPaths) {
        if (configuredPaths.has(p) || hasDescendant(p, configuredPaths)) configured++;
      }
      return { id: s.id, total: leafPaths.length, configured };
    });
  }, [sections, configuredPaths, configValues]);

  const countsById = useMemo(() => {
    const map: Record<string, { total: number; configured: number }> = {};
    for (const c of sectionCounts) {
      map[c.id] = { total: c.total, configured: c.configured };
    }
    return map;
  }, [sectionCounts]);

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
    visibleSections = visibleSections.filter((s) => {
      const counts = countsById[s.id];
      return counts && counts.configured > 0;
    });
  }

  if ((filtering || showConfiguredOnly) && visibleSections.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-(--cui-color-text-muted)">
        <span className="text-sm">
          {localize(filtering ? 'com_scope_no_changed_in_tab' : 'com_config_no_fields')}
        </span>
      </div>
    );
  }

  const renderSectionContent = (section: t.ConfigSectionConfig) => {
    const dataKey = section.schemaKey ?? section.id;
    const sectionValue = configValues?.[dataKey];
    const sectionDisabled =
      section.readOnlyReason != null ||
      isSectionDisabled(!!fieldsDisabled, sectionPermissions, dataKey);
    const CustomSectionRenderer =
      section.fields.length > 0 ? SECTION_RENDERERS[section.id] : undefined;
    const fieldRendererProps: t.FieldRendererProps = {
      fields: section.fields,
      parentValue: sectionValue,
      parentPath: dataKey,
      getValue,
      onChange: onFieldChange,
      onResetField,
      onDiscardField,
      editedValues,
      disabled: sectionDisabled,
      profileMap,
      previewMode,
      previewScope,
      previewChangedPaths,
      resolvedValues,
      permissions,
      onProfileChange,
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
    };
    return (
      <>
        {section.bannerText && (
          <div className="mb-4">
            <InfoBanner text={section.bannerText} dismissible={!section.readOnlyReason} />
          </div>
        )}
        {section.fields.length > 0 &&
          (CustomSectionRenderer ? (
            <CustomSectionRenderer {...fieldRendererProps} />
          ) : (
            <FieldRenderer {...fieldRendererProps} />
          ))}
        {section.fields.length > 0 && !CustomSectionRenderer && !section.isRecord && (
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
            onProfileChange={onProfileChange}
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
  };

  const isInlineSection = (section: t.ConfigSectionConfig): boolean =>
    Boolean(
      (section.sectionField && isSimpleScalar(section.sectionField)) ||
      (section.fields.length === 1 && isSimpleScalar(section.fields[0])),
    );

  type SectionGroup =
    | { kind: 'inline'; section: t.ConfigSectionConfig }
    | { kind: 'accordion'; sections: t.ConfigSectionConfig[] }
    | { kind: 'flat'; section: t.ConfigSectionConfig };

  const groups = visibleSections.reduce<SectionGroup[]>((acc, section) => {
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
    <form
      aria-label={localize('com_nav_configuration')}
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={preventImplicitSubmit}
      className="flex flex-col gap-6 py-4"
    >
      <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />
      {groups.map((group) => {
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
              description={section.descriptionKey ? localize(section.descriptionKey) : undefined}
              learnMoreUrl={section.learnMoreUrl}
              configuredCount={counts?.configured ?? 0}
              totalCount={counts?.total ?? 0}
              inline
              showConfiguredOnly={showConfiguredOnly}
            >
              {renderSectionContent(section)}
            </ConfigSection>
          );
        }
        return (
          <MultiAccordion
            key={group.sections[0].id}
            type="multiple"
            showBorder
            showCheck={false}
            fillWidth
            defaultValue={group.sections.map((s) => s.id)}
            data-top-level-accordion
          >
            {group.sections.map((section) => (
              <MultiAccordion.Item
                key={section.id}
                id={`section-${section.id}`}
                data-section-id={`section-${section.id}`}
                value={section.id}
                title={section.title ?? localize(section.titleKey)}
              >
                {renderSectionContent(section)}
              </MultiAccordion.Item>
            ))}
          </MultiAccordion>
        );
      })}
      {unknownSettings && (
        <UnknownSettings fields={unknownSettings.fields} value={unknownSettings.value} path="" />
      )}
    </form>
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
