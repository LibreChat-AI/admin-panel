import { Button } from '@clickhouse/click-ui';
import { useRef, useMemo, useState, useEffect, useCallback, useContext } from 'react';
import type * as t from '@/types';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { useLocalize, useValuesScope, useFieldState, useHiddenEntries } from '@/hooks';
import { ListOwnershipNotice } from '../../renderer/Collections';
import { ArrayObjectField } from '../../fields/ArrayObjectField';
import { SpecLeading, SpecSummary, specTitle } from './Summary';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { hasPathOrDescendant } from '../../renderer/paths';
import { CountBadge } from '@/components/shared';
import { SPEC_LIST_PATH } from './validation';
import { SpecListContext } from './context';
import { sourceLabel } from '../../values';
import { isConfigRecord, selectsHiddenEndpoint } from '@/utils';
import { SpecEditor } from './Editor';
import { SpecNote } from './Note';

function namesOf(list: t.ConfigValue): Set<string> {
  const names = new Set<string>();
  for (const spec of Array.isArray(list) ? list : []) {
    if (isConfigRecord(spec) && typeof spec.name === 'string') names.add(spec.name);
  }
  return names;
}

/**
 * Positions of the specs added in this session. A pending item's origin (the
 * loaded spec it came from) decides it, not its current name, so renaming a
 * saved spec never turns it into a new one; without pending edits (or their
 * record), an item counts as added when no loaded spec has its name.
 */
function addedIndexesOf(
  items: t.ConfigValue[],
  edit: t.CollectionEdit | undefined,
  savedNames: ReadonlySet<string>,
): Set<number> {
  const added = new Set<number>();
  items.forEach((item, index) => {
    const isAdded = edit
      ? edit.origins[index] == null
      : !(isConfigRecord(item) && typeof item.name === 'string' && savedNames.has(item.name));
    if (isAdded) added.add(index);
  });
  return added;
}

/** The list with one spec made the default (or soft default, or neither) and that role taken off the others. */
export function withDefault(
  items: t.ConfigValue[],
  index: number,
  kind: t.SpecDefaultKind,
): t.ConfigValue[] {
  return items.map((spec, i) => {
    if (!isConfigRecord(spec)) return spec;
    const { default: isDefault, softDefault: isSoft, ...rest } = spec;
    if (i === index) {
      if (kind === 'default') return { ...rest, default: true };
      if (kind === 'soft') return { ...rest, softDefault: true };
      return rest;
    }
    if (kind === 'default' && isDefault === true) {
      return { ...rest, ...(isSoft !== undefined && { softDefault: isSoft }) };
    }
    if (kind === 'soft' && isSoft === true) {
      return { ...rest, ...(isDefault !== undefined && { default: isDefault }) };
    }
    return spec;
  });
}

function hasPendingEdit(editedValues: t.FlatConfigMap | undefined, path: string): boolean {
  return Object.keys(editedValues ?? {}).some((key) => key === path || key.startsWith(`${path}.`));
}

/**
 * The spec list (MS-1/5/6): sortable cards (list order is menu order), each
 * with its icon, label, name, endpoint · model, group and badges, opening the
 * spec editor. In Base, a list the panel stores says it overrides
 * librechat.yaml and offers to revert it (D2). In a profile, the list Base
 * gives is shown read-only until "Customize list for …" takes a copy, since a
 * profile's list replaces Base's whole.
 */
export function SpecList({
  listField,
  items,
  options,
  problems,
  onChange,
  onResetField,
  onDiscardField,
  editedValues,
  disabled,
  permissions,
  dbOverridePaths,
  pendingResets,
  editSessionId,
  showConfiguredOnly,
}: t.SpecListProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const rowFilter = useContext(RowFilterContext);
  const listState = useFieldState(SPEC_LIST_PATH);
  const addRef = useRef<(() => void) | null>(null);
  const addButtonRef = useRef<HTMLSpanElement>(null);
  const [customizing, setCustomizing] = useState(false);
  useEffect(() => setCustomizing(false), [editSessionId, scope?.name]);
  /** "Customize list" disappears once used: focus moves on to Add spec. */
  useEffect(() => {
    if (customizing) addButtonRef.current?.querySelector('button')?.focus();
  }, [customizing]);

  const canEdit = !disabled && permissions?.canEdit !== false;
  const isPendingReset = Boolean(pendingResets?.has(SPEC_LIST_PATH)) || listState.isPendingReset;
  const ownsList =
    !isPendingReset &&
    (hasPathOrDescendant(SPEC_LIST_PATH, dbOverridePaths) || listState.isOverride);
  const isPending = hasPendingEdit(editedValues, SPEC_LIST_PATH) && !isPendingReset;
  const inheritedOnly = scope != null && !ownsList && !isPending && !customizing;
  const editable = canEdit && !inheritedOnly && !isPendingReset;
  const savedNames = useMemo(() => namesOf(listState.effective), [listState.effective]);
  /** Specs LibreChat leaves out for the profile, since it hides the endpoint they select (`keyedTombstones`). */
  const { hidden: hiddenEndpoints } = useHiddenEntries('endpoints.custom');
  const hiddenSpecs = useMemo(() => {
    const identities = new Set(hiddenEndpoints.keys());
    return items.filter((item) => selectsHiddenEndpoint(item, identities));
  }, [items, hiddenEndpoints]);
  const listEdit = useContext(CollectionEditsContext)[SPEC_LIST_PATH];
  const addedIndexes = useMemo(
    () => addedIndexesOf(items, listEdit, savedNames),
    [items, listEdit, savedNames],
  );

  const setDefault = useCallback(
    (index: number, kind: t.SpecDefaultKind) =>
      onChange(SPEC_LIST_PATH, withDefault(items, index, kind)),
    [items, onChange],
  );
  const contextValue = useMemo<t.SpecListContextValue>(
    () => ({
      items,
      problems,
      options,
      actions: { setDefault },
      savedNames,
      addedIndexes,
      configuredOnly: Boolean(showConfiguredOnly),
    }),
    [items, problems, options, setDefault, savedNames, addedIndexes, showConfiguredOnly],
  );
  const renderFields = useCallback<t.CollectionRenderFields>(
    (fields, value, path, change, _addField, sessionId, fieldsDisabled) => (
      <SpecEditor
        fields={fields}
        value={value}
        path={path}
        onChange={change}
        disabled={fieldsDisabled}
        editSessionId={sessionId}
      />
    ),
    [],
  );

  /** "Role: USER", as every other note names the open profile. */
  const scopeName = scope ? sourceLabel('scope', localize, scope) : '';
  const revert = canEdit && onResetField ? () => onResetField(SPEC_LIST_PATH) : undefined;

  const notice = (() => {
    if (isPendingReset) {
      return (
        <SpecNote
          tone="info"
          action={
            onDiscardField && (
              <button
                type="button"
                className="settings-row-action"
                onClick={() => onDiscardField(SPEC_LIST_PATH)}
              >
                {localize('com_config_ui_undo')}
              </button>
            )
          }
        >
          {localize(
            scope ? 'com_config_specs_pending_revert_scope' : 'com_config_specs_pending_revert',
          )}
        </SpecNote>
      );
    }
    if (inheritedOnly) {
      return (
        <SpecNote
          tone="info"
          action={
            canEdit && (
              <Button
                type="primary"
                htmlType="button"
                label={localize('com_config_ce_override_for', {
                  scope: scopeName,
                })}
                onClick={() => setCustomizing(true)}
              />
            )
          }
        >
          {localize('com_config_specs_inherited', { name: scopeName })}
        </SpecNote>
      );
    }
    if (ownsList) return <ListOwnershipNotice isScope={scope != null} onRevert={revert} />;
    if (scope) {
      return (
        <SpecNote
          tone="info"
          action={
            customizing && !isPending ? (
              <Button
                type="secondary"
                htmlType="button"
                label={localize('com_ui_cancel')}
                onClick={() => setCustomizing(false)}
              />
            ) : undefined
          }
        >
          {localize('com_config_specs_customizing', { name: scopeName })}
        </SpecNote>
      );
    }
    if (isPending) {
      return <SpecNote tone="info">{localize('com_config_specs_will_own')}</SpecNote>;
    }
    return null;
  })();

  const addButton = editable ? (
    <Button
      type="secondary"
      htmlType="button"
      iconLeft="plus"
      label={localize('com_config_specs_add')}
      onClick={() => addRef.current?.()}
    />
  ) : undefined;

  return (
    <section
      id={`section-${SPEC_LIST_PATH}`}
      aria-labelledby="modelSpecs-list-title"
      className="mt-2 flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id="modelSpecs-list-title" className="settings-heading flex items-center gap-2">
          <span className="settings-group-title">{localize('com_config_specs_list')}</span>
          <CountBadge configured={items.length} total={items.length} entries />
        </h3>
        <span ref={addButtonRef} className="ms-auto">
          {addButton}
        </span>
        <p className="settings-help m-0 basis-full">{localize('com_config_specs_list_desc')}</p>
      </div>
      {!rowFilter && notice}
      {!rowFilter && hiddenSpecs.length > 0 && (
        <SpecNote tone="warning">
          {localize('com_config_specs_hidden_endpoint', {
            name: scopeName,
            specs: hiddenSpecs.map((spec) => specTitle(spec, localize)).join(', '),
          })}
        </SpecNote>
      )}
      <SpecListContext.Provider value={contextValue}>
        <ArrayObjectField
          id="modelSpecs-list"
          path={SPEC_LIST_PATH}
          value={items}
          fields={listField.children ?? []}
          onChange={(next) => onChange(SPEC_LIST_PATH, next)}
          onEntryChange={(index, next) => onChange(`${SPEC_LIST_PATH}.${index}`, next)}
          disabled={!editable}
          hideAddButton
          addTriggerRef={addRef}
          renderFields={renderFields}
          getEntryTitle={(item) => specTitle(item, localize)}
          renderSummary={(item, index) => <SpecSummary spec={item} index={index} />}
          renderLeading={(item) => <SpecLeading spec={item} />}
          stackedSummary
          reorderable={editable}
          emptyLabel={localize(
            editable ? 'com_config_specs_empty' : 'com_config_specs_empty_readonly',
          )}
          editSessionId={editSessionId}
        />
      </SpecListContext.Provider>
    </section>
  );
}
