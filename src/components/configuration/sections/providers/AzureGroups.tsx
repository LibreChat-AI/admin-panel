import { Button, TextField as CUITextField } from '@clickhouse/click-ui';
import { useId, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type * as t from '@/types';
import {
  useLocalize,
  useValuesScope,
  useAzureGroupRows,
  useConfigFeatures,
  useStoredGroupHides,
  useConfigKeyProblem,
  useEntryOverrideNotes,
} from '@/hooks';
import { RevealTargetContext } from '@/contexts/RevealTargetContext';
import { ConfigErrorsContext } from '@/contexts/ConfigErrorsContext';
import { describeOverrideNotes, sourceLabel } from '../../values';
import { diffOverride, findDroppedGroupKey } from '@/utils';
import { AzureGroupEditor } from './AzureGroupEditor';
import { AzureGroupDrawer } from './AzureGroupDrawer';
import { EndpointDrawer } from '../endpoints/Drawer';
import { WarningList } from '@/components/shared';
import { Banner } from '../endpoints/Banner';
import { toFieldId } from '../../renderer';
import { formatIssue } from '../../issues';
import { Badge } from '../endpoints/List';
import { labelForPath } from '../../meta';
import { toAzureGroups } from './azure';

const GROUP_KEY = 'group';

/** Id of the new group's name input. */
const NEW_GROUP_ID = 'endpoints-azureOpenAI-groups-new';

/** Where each kind of group comes from, said atop its editor. */
const ORIGIN_NOTICE_KEYS: Readonly<Record<t.EndpointOrigin, string>> = {
  yaml: 'com_config_providers_azure_notice_yaml',
  inherited: 'com_config_providers_azure_notice_inherited',
  admin: 'com_config_providers_azure_notice_admin',
  scope: 'com_config_providers_azure_notice_scope',
};

/**
 * Where a group comes from: "librechat.yaml", "librechat.yaml + overrides",
 * "Added in admin panel"; in a profile "Inherited from Base", "Base + Role:
 * USER" or "Added in Role: USER".
 */
function GroupSourceBadge({ entry }: t.AzureGroupSourceBadgeProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const params = { scope: scope ? sourceLabel('scope', localize, scope) : '' };
  const [tone, key]: [t.AzureGroupBadgeTone, string] = (() => {
    if (entry.origin === 'yaml') {
      return entry.overridden
        ? ['override', 'com_config_providers_azure_source_yaml_overrides']
        : ['yaml', 'com_config_providers_azure_source_yaml'];
    }
    if (entry.origin === 'inherited') {
      return entry.overridden
        ? ['scope', 'com_config_providers_azure_source_inherited_overrides']
        : ['inherited', 'com_config_providers_azure_source_inherited'];
    }
    return [
      'added',
      entry.origin === 'scope'
        ? 'com_config_providers_azure_source_scope'
        : 'com_config_providers_azure_source_admin',
    ];
  })();
  return (
    <Badge
      tone={tone}
      label={localize(key, params)}
      description={localize(`${key}_desc`, params)}
    />
  );
}

/** The column headers both tables share; the details (or edit) column is last. */
function TableHead({ actionLabel }: t.AzureGroupsHeadProps) {
  const localize = useLocalize();
  return (
    <thead>
      <tr>
        <th scope="col">{localize('com_config_providers_azure_col_group')}</th>
        <th scope="col" className="azure-col-wide">
          {localize('com_config_providers_azure_col_target')}
        </th>
        <th scope="col" className="azure-col-optional">
          {localize('com_config_providers_azure_col_version')}
        </th>
        <th scope="col" className="azure-col-number">
          {localize('com_config_providers_azure_col_models')}
        </th>
        <th scope="col" className="azure-col-optional">
          {localize('com_config_providers_azure_col_serverless')}
        </th>
        <th scope="col" className="azure-col-optional">
          {localize('com_config_providers_azure_col_assistants')}
        </th>
        <th scope="col">
          <span className="sr-only">{actionLabel}</span>
        </th>
      </tr>
    </thead>
  );
}

/** The cells of a group between its name and its action. */
function GroupCells({ row }: t.AzureGroupCellsProps) {
  const localize = useLocalize();
  const yesNo = (on: boolean) =>
    localize(on ? 'com_config_providers_azure_yes' : 'com_config_providers_azure_no');
  return (
    <>
      <td className="azure-col-wide">
        <span className="azure-target" title={row.baseURL ?? row.instanceName}>
          {row.baseURL ?? row.instanceName ?? '—'}
        </span>
      </td>
      <td className="azure-col-optional azure-col-version">{row.version ?? '—'}</td>
      <td className="azure-col-number">{row.models.length}</td>
      <td className="azure-col-optional">{yesNo(row.serverless)}</td>
      <td className="azure-col-optional">{yesNo(row.assistants)}</td>
    </>
  );
}

/**
 * Azure OpenAI groups as a read-only table (AP-1 phase 1, D13): Group |
 * Instance or base URL | API version | Models | Serverless | Assistants,
 * each with a details drawer (credentials masked), while LibreChat applies
 * Azure groups only from librechat.yaml. Each row is a search target: a found
 * group lands on its row, with its Details button focused.
 */
function ReadOnlyGroups({ path, value, field }: t.AzureGroupsTableProps) {
  const localize = useLocalize();
  const rows = useMemo(() => toAzureGroups(value), [value]);
  const [selected, setSelected] = useState<t.AzureGroupRow | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  if (rows.length === 0) {
    return <p className="settings-help m-0 py-2">{localize('com_config_providers_azure_empty')}</p>;
  }

  return (
    <div id={path.replace(/\./g, '-')} className="azure-groups">
      <table className="azure-groups-table">
        <TableHead actionLabel={localize('com_config_providers_azure_details')} />
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.group} id={`section-${path.replace(/\./g, '-')}-${index}`}>
              <th
                scope="row"
                id={toFieldId(`${path}.${row.index}.group`)}
                className="azure-group-name"
              >
                {row.group}
              </th>
              <GroupCells row={row} />
              <td className="azure-col-action">
                <button
                  type="button"
                  className="azure-details-btn"
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setSelected(row);
                  }}
                  aria-label={localize('com_config_providers_azure_details_aria', {
                    group: row.group,
                  })}
                  aria-haspopup="dialog"
                >
                  {localize('com_config_providers_azure_details')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AzureGroupDrawer
        group={selected}
        path={path}
        field={field}
        onClose={() => setSelected(null)}
        returnFocus={opener}
      />
    </div>
  );
}

/** "Add group": a name, then the new group opens in the editor. */
function CreateGroup({ names, onCreate }: t.AzureGroupCreateProps) {
  const localize = useLocalize();
  const keyProblem = useConfigKeyProblem();
  const errorId = useId();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const problem = names.includes(trimmed)
    ? localize('com_config_providers_azure_name_taken', { name: trimmed })
    : keyProblem(trimmed);
  const close = () => {
    setName('');
    setAdding(false);
  };
  const submit = () => {
    if (trimmed === '' || problem) return;
    onCreate(trimmed);
    close();
  };

  if (!adding) {
    return (
      <div>
        <Button
          type="secondary"
          htmlType="button"
          iconLeft="plus"
          label={localize('com_config_providers_azure_add')}
          onClick={() => setAdding(true)}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="cui-field flex w-64 max-w-full flex-col gap-1">
        <CUITextField
          id={NEW_GROUP_ID}
          value={name}
          onChange={setName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape') close();
          }}
          placeholder={localize('com_config_providers_azure_add_placeholder')}
          aria-label={localize('com_config_providers_azure_add_name')}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
          autoFocus
        />
        {problem && (
          <span id={errorId} role="alert" className="text-xs text-(--cui-color-text-danger)">
            {problem}
          </span>
        )}
      </div>
      <Button
        type="primary"
        htmlType="button"
        label={localize('com_config_providers_azure_add_submit')}
        disabled={trimmed === '' || problem != null}
        onClick={submit}
      />
      <Button
        type="secondary"
        htmlType="button"
        label={localize('com_ui_cancel')}
        onClick={close}
      />
    </div>
  );
}

/** `endpoints.azureOpenAI.groups.3.models` → 3, for a path inside the list. */
function indexIn(target: string, listPath: string): number | null {
  if (!target.startsWith(`${listPath}.`)) return null;
  const [segment] = target.slice(listPath.length + 1).split('.');
  return /^\d+$/.test(segment) ? Number(segment) : null;
}

/**
 * Azure OpenAI groups as an editor (`editsAzureGroups`): LibreChat merges
 * what Base or a profile sets into the group of the same name beneath it,
 * and adds the groups it names that aren't there. Each row says where the
 * group comes from and opens it in the editor drawer; a group librechat.yaml
 * (or, in a profile, Base) defines can be changed but not renamed or removed
 * (D1), and one the target adds can. Edits are staged on the page.
 */
function EditableGroups({
  path,
  value,
  field,
  onChange,
  disabled,
  editSessionId,
}: t.AzureGroupsEditorProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const { secretRebinding } = useConfigFeatures();
  const pageErrors = useContext(ConfigErrorsContext);
  const revealTarget = useContext(RevealTargetContext);
  const overrideNotes = useEntryOverrideNotes(path);
  const hides = useStoredGroupHides();
  const items = useMemo(() => (Array.isArray(value) ? value : []), [value]);
  const { rows, removals } = useAzureGroupRows(items);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openAfterCreate, setOpenAfterCreate] = useState<string | null>(null);
  const latestRef = useRef<t.ConfigRecord>({});
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const scopeName = scope ? sourceLabel('scope', localize, scope) : '';
  const domId = path.replace(/\./g, '-');

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    if (!revealTarget) return;
    const index = indexIn(revealTarget, path);
    const found = rowsRef.current.find((entry) => entry.row.index === index);
    if (found) setOpenKey(found.key);
  }, [revealTarget, path]);

  useEffect(() => {
    if (!openAfterCreate) return;
    const created = rows.find((entry) => entry.isNew && entry.row.group === openAfterCreate);
    if (!created) return;
    setOpenAfterCreate(null);
    setOpenKey(created.key);
  }, [openAfterCreate, rows]);

  const open = openKey ? rows.find((entry) => entry.key === openKey) : undefined;
  if (open) latestRef.current = open.value;
  const names = [...rows.map((entry) => entry.row.group), ...removals.map((item) => item.name)];
  const listError = pageErrors?.[path];
  const closeDrawer = () => setOpenKey(null);
  const fromLower = (entry: t.AzureGroupEntry) =>
    entry.origin === 'yaml' || entry.origin === 'inherited';

  const handleFieldChange = (key: string, next: t.ConfigValue) => {
    if (!open) return;
    const entry = { ...latestRef.current, [key]: next };
    if (next === undefined) delete entry[key];
    latestRef.current = entry;
    onChange(`${path}.${open.row.index}`, entry);
  };

  const handleDelete = (entry: t.AzureGroupEntry) => {
    closeDrawer();
    onChange(
      path,
      items.filter((_, index) => index !== entry.row.index),
    );
  };

  /** Back to the group the layer beneath defines: the target's override of it is dropped on save. */
  const handleRevert = (entry: t.AzureGroupEntry) => {
    if (entry.lower) onChange(`${path}.${entry.row.index}`, entry.lower);
  };

  const handleUndo = (removal: t.AzureGroupRemoval) => {
    const at = Math.min(removal.restoreIndex, items.length);
    onChange(path, [...items.slice(0, at), removal.value, ...items.slice(at)]);
  };

  const handleCreate = (name: string) => {
    onChange(path, [...items, { [GROUP_KEY]: name }]);
    setOpenAfterCreate(name);
  };

  /** The names the groups were loaded with, the ones a pending edit removes included. */
  const loadedNames = new Set([
    ...rows.flatMap((entry) => (entry.loadedName === undefined ? [] : [entry.loadedName])),
    ...removals.map((removal) => removal.name),
  ]);

  /**
   * What a group's pending change in Base does to the profiles that override
   * groups by name (`useEntryOverrideNotes`): a rename leaves their overrides
   * under the saved name, and a rename or new group onto a name they still
   * override takes theirs.
   */
  const profileNotesOf = (entry: t.AzureGroupEntry): string[] => {
    const name = entry.row.group;
    const { loadedName } = entry;
    const isSaved = loadedNames.has(name);
    if (loadedName !== undefined && loadedName !== name) {
      const taken = rows.some((other) => other !== entry && other.row.group === loadedName);
      const left = overrideNotes.left(loadedName, { next: name, taken });
      return describeOverrideNotes(
        isSaved ? left : [...left, ...overrideNotes.took(name)],
        localize,
      );
    }
    return isSaved ? [] : describeOverrideNotes(overrideNotes.took(name), localize);
  };

  /** "Instance name": what inside its group a stored hide names, none for the whole group. */
  const insideLabels = (hide: t.KeyedPath): string[] => {
    const segments = hide.rest ? hide.rest.split('.') : [];
    return segments.map((_, at) =>
      labelForPath(`${path}.0.${segments.slice(0, at + 1).join('.')}`, localize),
    );
  };

  /** "region-sweden › Instance name": a group a stored hide names, and what inside it. */
  const hideLabel = (hide: t.KeyedPath): string => [hide.key, ...insideLabels(hide)].join(' › ');

  /**
   * The stored hides (`useStoredGroupHides`) LibreChat will apply to the group
   * once saved: those naming the group as it is written now, so a rename
   * shows the hides of its new name and drops those of its old one.
   */
  const hidesOf = (entry: t.AzureGroupEntry): t.KeyedPath[] =>
    hides.filter((hide) => hide.key === (entry.row.group ?? entry.loadedName));

  /**
   * Marks a group the target's stored hides name, which LibreChat applies
   * and the editor doesn't: hidden whole, or settings inside it hidden.
   */
  const hiddenBadge = (entry: t.AzureGroupEntry) => {
    const own = hidesOf(entry);
    if (own.length === 0) return null;
    if (own.some((hide) => !hide.rest)) {
      return (
        <Badge
          tone="warning"
          label={localize('com_config_providers_azure_hidden')}
          description={localize(
            scope
              ? 'com_config_providers_azure_hidden_desc_scope'
              : 'com_config_providers_azure_hidden_desc',
            { scope: scopeName },
          )}
        />
      );
    }
    return (
      <Badge
        tone="warning"
        label={localize('com_config_providers_azure_part_hidden')}
        description={localize(
          scope
            ? 'com_config_providers_azure_part_hidden_desc_scope'
            : 'com_config_providers_azure_part_hidden_desc',
          {
            scope: scopeName,
            fields: own.map((hide) => insideLabels(hide).join(' › ')).join(', '),
          },
        )}
      />
    );
  };

  /** The stored hides of groups by name (`useStoredGroupHides`) among `list`, which the editor doesn't apply. */
  const hidesNotice = (list: t.KeyedPath[]) =>
    list.length === 0 ? null : (
      <Banner tone="warning" role="status">
        {localize(
          scope ? 'com_config_providers_azure_hides_scope' : 'com_config_providers_azure_hides',
          { scope: scopeName, hides: list.map(hideLabel).join(', ') },
        )}
      </Banner>
    );

  /** Positions of the groups with a problem: the page's errors at or inside them, and saved groups that don't resolve. */
  const errorRows = new Set([
    ...Object.keys(pageErrors ?? {}).flatMap((errorPath) => {
      const index = indexIn(errorPath, path);
      return index === null ? [] : [index];
    }),
    ...rows.flatMap((entry) => (entry.unresolved.length > 0 ? [entry.row.index] : [])),
  ]);

  /** Why LibreChat ignores every group the target sets: this saved group doesn't resolve. */
  const unresolvedNotice = (entry: t.AzureGroupEntry) => {
    if (entry.unresolved.length === 0) return null;
    const problems = entry.unresolved.map(
      (issue) => formatIssue(issue, issue.path, localize).inline,
    );
    return (
      <Banner tone="danger" role="alert">
        {localize(
          scope
            ? 'com_config_providers_azure_unresolved_scope'
            : 'com_config_providers_azure_unresolved',
          { scope: scopeName, problems: problems.join('; ') },
        )}
      </Banner>
    );
  };

  /** The group's problems no field of the editor shows inline: the group's own, and its model list's. */
  const notice = (entry: t.AzureGroupEntry) => {
    const prefix = `${path}.${entry.row.index}`;
    const own = [pageErrors?.[prefix], pageErrors?.[`${prefix}.models`]].filter(Boolean).join(' ');
    /** The inherited key LibreChat no longer sends, since the edit moves the group's destination. */
    const moved =
      secretRebinding && entry.lower
        ? findDroppedGroupKey(entry.lower, diffOverride(entry.lower, entry.value).value)
        : [];
    const profileNotes = profileNotesOf(entry);
    return (
      <>
        <Banner tone="info">
          {localize(ORIGIN_NOTICE_KEYS[entry.origin], { scope: scopeName })}
        </Banner>
        {profileNotes.length > 0 && (
          <Banner tone="warning" role="status">
            <span className="flex flex-col gap-1">
              {profileNotes.map((note) => (
                <span key={note}>{note}</span>
              ))}
            </span>
          </Banner>
        )}
        {moved.length > 0 && (
          <Banner tone="warning" role="status">
            {localize('com_config_providers_azure_key_not_sent', {
              fields: moved
                .map((key) => labelForPath(`${path}.${entry.row.index}.${key}`, localize))
                .join(', '),
            })}
          </Banner>
        )}
        {own && (
          <Banner tone="danger" role="alert">
            {own}
          </Banner>
        )}
        {unresolvedNotice(entry)}
        {hidesNotice(hidesOf(entry))}
      </>
    );
  };

  const footer = (entry: t.AzureGroupEntry) => (
    <>
      {!disabled && !fromLower(entry) && (
        <Button
          type="danger"
          htmlType="button"
          iconLeft="trash"
          label={localize('com_config_providers_azure_delete')}
          onClick={() => handleDelete(entry)}
        />
      )}
      {!disabled && fromLower(entry) && (entry.overridden || entry.edited) && entry.lower && (
        <Button
          type="secondary"
          htmlType="button"
          iconLeft="refresh"
          label={localize(
            entry.origin === 'inherited'
              ? 'com_config_providers_azure_revert_scope'
              : 'com_config_providers_azure_revert_yaml',
            { scope: scopeName },
          )}
          onClick={() => handleRevert(entry)}
        />
      )}
      <span className="ml-auto text-xs text-(--cui-color-text-muted)">
        {disabled ? null : localize('com_config_ce_drawer_staged')}
      </span>
      <Button
        type="primary"
        htmlType="button"
        label={localize('com_config_ce_done')}
        onClick={closeDrawer}
      />
    </>
  );

  return (
    <div id={domId} className="flex flex-col gap-3">
      {listError && (
        <Banner tone="danger" role="alert">
          {listError}
        </Banner>
      )}
      {hidesNotice(hides)}
      {rows.length === 0 ? (
        <p className="settings-help m-0 py-2">
          {localize(
            scope ? 'com_config_providers_azure_empty_scope' : 'com_config_providers_azure_empty',
          )}
        </p>
      ) : (
        <div className="azure-groups">
          <table className="azure-groups-table">
            <TableHead actionLabel={localize('com_config_providers_azure_edit')} />
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.key} id={`section-${domId}-${entry.row.index}`}>
                  <th scope="row" className="azure-group-name">
                    <span className="flex flex-col items-start gap-1">
                      <span>{entry.row.group}</span>
                      <span className="flex flex-wrap gap-1 font-normal">
                        <span className="azure-group-source">
                          <GroupSourceBadge entry={entry} />
                        </span>
                        {hiddenBadge(entry)}
                        {entry.isNew && (
                          <Badge
                            tone="edited"
                            dot
                            label={localize('com_config_ce_state_new')}
                            description={localize('com_config_ce_state_new_desc')}
                          />
                        )}
                        {entry.edited && (
                          <Badge
                            tone="edited"
                            dot
                            label={localize('com_config_ui_state_edited')}
                            description={localize('com_config_ui_state_edited_desc')}
                          />
                        )}
                        {errorRows.has(entry.row.index) && (
                          <Badge tone="error" label={localize('com_config_ce_status_invalid')} />
                        )}
                      </span>
                    </span>
                  </th>
                  <GroupCells row={entry.row} />
                  <td className="azure-col-action">
                    <button
                      type="button"
                      className="azure-details-btn"
                      onClick={(event) => {
                        openerRef.current = event.currentTarget;
                        setOpenKey(entry.key);
                      }}
                      aria-label={localize(
                        disabled
                          ? 'com_config_providers_azure_details_aria'
                          : 'com_config_providers_azure_edit_aria',
                        { group: entry.row.group },
                      )}
                      aria-haspopup="dialog"
                    >
                      {localize(
                        disabled
                          ? 'com_config_providers_azure_details'
                          : 'com_config_providers_azure_edit',
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {removals.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {removals.map((removal) => (
            <li
              key={removal.key}
              className="flex flex-wrap items-center gap-2 text-sm text-(--cui-color-text-muted)"
            >
              <span className="line-through">{removal.name}</span>
              <span>{localize('com_config_providers_azure_removed')}</span>
              {!disabled && (
                <button
                  type="button"
                  className="settings-row-action"
                  onClick={() => handleUndo(removal)}
                  aria-label={localize('com_config_ctl_entry_undo_a11y', { name: removal.name })}
                >
                  {localize('com_config_ctl_entry_undo')}
                </button>
              )}
              <WarningList
                notes={describeOverrideNotes(overrideNotes.left(removal.name), localize)}
              />
            </li>
          ))}
        </ul>
      )}
      {!disabled && <CreateGroup names={names} onCreate={handleCreate} />}
      <EndpointDrawer
        open={open != null}
        onClose={closeDrawer}
        title={open?.row.group ?? ''}
        badges={
          open ? (
            <>
              <GroupSourceBadge entry={open} />
              {hiddenBadge(open)}
            </>
          ) : undefined
        }
        subtitle={
          open
            ? (open.row.baseURL ??
              open.row.instanceName ??
              localize('com_config_providers_azure_drawer_desc_edit'))
            : undefined
        }
        notice={open ? notice(open) : undefined}
        footer={open ? footer(open) : null}
        returnFocus={() => openerRef.current}
      >
        {open && (
          <AzureGroupEditor
            key={open.key}
            path={`${path}.${open.row.index}`}
            fields={field?.children ?? []}
            entry={open}
            onFieldChange={handleFieldChange}
            otherNames={names.filter((name) => name !== open.row.group)}
            disabled={disabled}
            editSessionId={editSessionId}
          />
        )}
      </EndpointDrawer>
    </div>
  );
}

/**
 * The Azure OpenAI groups of the providers tab: an editor where LibreChat
 * derives groups from Base and the profiles again (`onChange`), else the
 * read-only table with its details drawer.
 */
export function AzureGroupsTable(props: t.AzureGroupsTableProps) {
  const { onChange } = props;
  if (onChange) return <EditableGroups {...props} onChange={onChange} />;
  return <ReadOnlyGroups {...props} />;
}
