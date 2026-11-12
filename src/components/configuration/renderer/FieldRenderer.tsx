import { Fragment, useContext } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  isBaseOnlyPath,
  isStartupOnlyPath,
  isYamlManagedPath,
  getReadOnlyReason,
} from '@/constants';
import { isRowVisible, getSecretPreviewValue, isInterfacePermissionPath } from '@/utils';
import { ConfiguredOnlyContext } from '@/contexts/ConfiguredOnlyContext';
import { countConfigured, hasPathOverlap, isPathSet } from '../counts';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { useLocalize, useConfigWriteRules } from '@/hooks';
import { getControlType, orderFields } from '../controls';
import { UnknownSettings } from '../UnknownSettings';
import { SingleFieldRenderer } from './SingleField';
import { ManagedNotice } from '../ManagedNotice';
import { NestedGroup } from './NestedGroup';
import { labelForPath } from '../meta';

const NO_PATHS: ReadonlySet<string> = new Set();

function isPlainRecord(value: t.ConfigValue): value is t.ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asEnabled(value: t.ConfigValue): boolean | undefined {
  if (value === true || isPlainRecord(value)) return true;
  if (value === false) return false;
  return undefined;
}

/**
 * Whether `path` is the root of a field managed only in librechat.yaml, which
 * shows the notice: not below another one, and not in a read-only section,
 * whose banner already says why.
 */
function isManagedRoot(path: string, parentPath: string, rules: t.ConfigWriteRules): boolean {
  return (
    isYamlManagedPath(path, rules) &&
    !isYamlManagedPath(parentPath, rules) &&
    getReadOnlyReason(path, rules) === undefined
  );
}

/** The notice a field managed only in librechat.yaml shows at its root (`isManagedRoot`), or null. */
function managedNoticeKind(
  path: string,
  parentPath: string,
  rules: t.ConfigWriteRules,
): t.ManagedNoticeKind | null {
  return isManagedRoot(path, parentPath, rules) ? noticeKindOf(path, rules) : null;
}

/** Why a managed field is read-only: read only at startup, kept from librechat.yaml, or not re-processed. */
function noticeKindOf(path: string, rules: t.ConfigWriteRules): t.ManagedNoticeKind {
  if (isStartupOnlyPath(path, rules)) return 'startup';
  return isBaseOnlyPath(path, rules) ? 'baseOnly' : 'yaml';
}

/**
 * Each managed field's notice, by the index of the field it is shown above,
 * with the paths it covers: consecutive startup-only fields share one notice
 * above the first of them, as do consecutive base-only ones. A managed group
 * shows its own notice inside it.
 */
function managedNoticeRuns(
  groups: ReadonlyArray<{ type: string; path: string }>,
  parentPath: string,
  rules: t.ConfigWriteRules,
): Map<number, string[]> {
  const runs = new Map<number, string[]>();
  let start = -1;
  let kind: t.ManagedNoticeKind | null = null;
  groups.forEach((group, index) => {
    const next = group.type === 'nested' ? null : managedNoticeKind(group.path, parentPath, rules);
    if (next !== null && next !== 'yaml' && next === kind) {
      runs.get(start)?.push(group.path);
      return;
    }
    kind = next;
    start = index;
    if (next != null) runs.set(index, [group.path]);
  });
  return runs;
}

/** `boolean | object` fields get an on/off header; interface permission fields stay plain groups. */
function isSwitchObject(field: t.SchemaField, path: string): boolean {
  return getControlType(field) === 'switch-object' && !isInterfacePermissionPath(path);
}

export function FieldRenderer({
  fields,
  parentValue,
  parentPath,
  getValue,
  onChange,
  onResetField,
  onDiscardField,
  editedValues,
  disabled,
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
  editSessionId,
}: t.FieldRendererProps) {
  const localize = useLocalize();
  const writeRules = useConfigWriteRules();
  const values =
    typeof parentValue === 'object' && parentValue !== null
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};

  const rowFilter = useContext(RowFilterContext);
  const filtering = showChangedOnly && previewMode && previewChangedPaths;
  const isPathChanged = (p: string) =>
    previewChangedPaths?.some((op) => op === p || op.startsWith(`${p}.`)) ?? false;

  const sorted = orderFields(fields, parentPath);

  const groups: Array<{
    type: 'single' | 'nested' | 'switch';
    field: t.SchemaField;
    value: t.ConfigValue;
    path: string;
  }> = [];

  for (const field of sorted) {
    const value = values[field.key];
    const path = `${parentPath}.${field.key}`;

    if (filtering && !isPathChanged(path)) continue;
    if (!isRowVisible(rowFilter, path)) continue;

    if (showConfiguredOnly && !previewMode && !isPathSet(path, configuredPaths, editedValues)) {
      continue;
    }

    if (isSwitchObject(field, path)) {
      groups.push({ type: 'switch', field, value, path });
    } else if (
      field.children &&
      field.children.length > 0 &&
      !field.isArray &&
      field.type !== 'record' &&
      !field.variants?.length
    ) {
      groups.push({ type: 'nested', field, value, path });
    } else {
      groups.push({ type: 'single', field, value, path });
    }
  }

  const noticeRuns = managedNoticeRuns(groups, parentPath, writeRules);

  /** The notice of managed fields (`settings`: how many it covers), offering to remove their stale overrides. */
  const managedNotice = (paths: string[], settings = paths.length): ReactNode => {
    const overridden = paths.filter((path) => hasPathOverlap(path, dbOverridePaths ?? NO_PATHS));
    return (
      <ManagedNotice
        kind={noticeKindOf(paths[0], writeRules)}
        count={settings}
        hasOverride={overridden.length > 0}
        pendingRemoval={
          overridden.length > 0 && overridden.every((path) => pendingResets?.has(path))
        }
        onRemoveOverride={
          disabled || !onResetField
            ? undefined
            : () => overridden.forEach((path) => onResetField(path))
        }
      />
    );
  };

  return (
    <ConfiguredOnlyContext.Provider value={Boolean(showConfiguredOnly && !previewMode)}>
      {groups.map((group, index) => {
        const managed = isYamlManagedPath(group.path, writeRules);
        const managedRoot = isManagedRoot(group.path, parentPath, writeRules);
        const noticeRun = noticeRuns.get(index);
        const groupDisabled = disabled || managed;
        if (group.type === 'nested') {
          const nestedValue =
            typeof group.value === 'object' && group.value !== null ? group.value : {};
          const nestedLabel = labelForPath(group.field.path, localize);
          const nestedCounts = countConfigured(group.field.children!, group.path, configuredPaths);
          return (
            <NestedGroup
              key={group.field.path}
              label={nestedLabel}
              sectionId={`section-${group.path}`}
              configuredCount={nestedCounts.configured}
              totalCount={nestedCounts.total}
              depth={group.field.depth}
              disabled={groupDisabled}
              revealPaths={[group.path]}
            >
              {managedRoot && managedNotice([group.path], group.field.children?.length)}
              <FieldRenderer
                fields={group.field.children!}
                parentValue={nestedValue}
                parentPath={group.path}
                getValue={getValue}
                onChange={onChange}
                onResetField={onResetField}
                onDiscardField={onDiscardField}
                editedValues={editedValues}
                disabled={groupDisabled}
                previewMode={previewMode}
                previewScope={previewScope}
                previewChangedPaths={previewChangedPaths}
                resolvedValues={resolvedValues}
                permissions={permissions}
                showChangedOnly={showChangedOnly}
                configuredPaths={configuredPaths}
                dbOverridePaths={dbOverridePaths}
                touchedPaths={touchedPaths}
                pendingResets={pendingResets}
                schemaDefaults={schemaDefaults}
                showConfiguredOnly={showConfiguredOnly}
                editSessionId={editSessionId}
              />
              {!rowFilter && (
                <UnknownSettings
                  fields={group.field.children!}
                  value={nestedValue}
                  path={group.path}
                />
              )}
            </NestedGroup>
          );
        }

        const single = (
          <SingleFieldRenderer
            field={group.field}
            value={group.value}
            path={group.path}
            getValue={getValue}
            onChange={onChange}
            onResetField={onResetField}
            onDiscardField={onDiscardField}
            editedValues={editedValues}
            disabled={groupDisabled}
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
            isSoleField={false}
            secretPreviewValue={getSecretPreviewValue(values, group.field.key)}
            editSessionId={editSessionId}
          />
        );

        if (group.type === 'switch') {
          const current = getValue(group.path, group.value);
          const enabled = asEnabled(current) ?? asEnabled(schemaDefaults?.[group.path]) ?? false;
          return (
            <Fragment key={group.field.path}>
              {noticeRun && managedNotice(noticeRun)}
              {single}
              {enabled && (group.field.children?.length ?? 0) > 0 && (
                <div className="settings-group">
                  <div className="settings-group-body">
                    <FieldRenderer
                      fields={group.field.children!}
                      parentValue={isPlainRecord(current) ? current : {}}
                      parentPath={group.path}
                      getValue={getValue}
                      onChange={onChange}
                      onResetField={onResetField}
                      onDiscardField={onDiscardField}
                      editedValues={editedValues}
                      disabled={groupDisabled}
                      previewMode={previewMode}
                      previewScope={previewScope}
                      previewChangedPaths={previewChangedPaths}
                      resolvedValues={resolvedValues}
                      permissions={permissions}
                      showChangedOnly={showChangedOnly}
                      configuredPaths={configuredPaths}
                      dbOverridePaths={dbOverridePaths}
                      touchedPaths={touchedPaths}
                      pendingResets={pendingResets}
                      schemaDefaults={schemaDefaults}
                      showConfiguredOnly={showConfiguredOnly}
                      editSessionId={editSessionId}
                    />
                  </div>
                </div>
              )}
            </Fragment>
          );
        }

        return (
          <Fragment key={group.field.path}>
            {noticeRun && managedNotice(noticeRun)}
            {single}
          </Fragment>
        );
      })}
    </ConfiguredOnlyContext.Provider>
  );
}
