import { useCallback, useContext, useRef } from 'react';
import type * as t from '@/types';
import { NestedGroup, FieldRenderer, toFieldId, renderCollectionEntryFields } from '../../renderer';
import { filledText, getValueAtPath, isConfigRecord, isRowVisible } from '@/utils';
import { ArrayObjectField } from '../../fields/ArrayObjectField';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../../UnknownSettings';
import { isRowShown } from '../files/FieldRow';
import { countConfigured } from '../../counts';
import { labelForPath } from '../../meta';
import { useLocalize } from '@/hooks';

const SECTION = 'skillSync';
const GITHUB = 'skillSync.github';
const SOURCES = 'skillSync.github.sources';

/** A source card's title: `owner/repo`, else its ID. */
function sourceTitle(item: t.ConfigValue): string | null {
  if (!isConfigRecord(item)) return null;
  const owner = filledText(item.owner);
  const repo = filledText(item.repo);
  if (owner && repo) return `${owner}/${repo}`;
  return filledText(item.id) ?? repo ?? owner ?? null;
}

/**
 * GitHub sources as cards (FX-13): titled `owner/repo`, summarized by branch
 * and folders, added with "Add source"; each card's fields are the source's
 * ID, owner, repository, ref, folders and credentials, in that order.
 */
function SourcesGroup({
  field,
  fieldProps,
}: {
  field: t.SchemaField;
  fieldProps: t.FieldRendererProps;
}) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const addTriggerRef = useRef<(() => void) | null>(null);
  const { getValue, onChange, disabled, editSessionId } = fieldProps;
  const value = getValue(SOURCES, getValueAtPath(fieldProps.parentValue ?? null, 'github.sources'));
  const items = Array.isArray(value) ? value : [];
  const handleEntryChange = useCallback(
    (index: number, entry: t.ConfigValue) => onChange(`${SOURCES}.${index}`, entry),
    [onChange],
  );
  if (!isRowShown(rowFilter, SOURCES, fieldProps)) return null;

  const summary = (item: t.ConfigValue) => {
    if (!isConfigRecord(item)) return null;
    const paths = Array.isArray(item.paths) ? item.paths : [];
    const isRoot = paths.length === 1 && (paths[0] === '.' || paths[0] === '/');
    const folders = (() => {
      if (paths.length === 0) return localize('com_config_skillsync_source_no_folders');
      if (isRoot) return localize('com_config_skillsync_source_whole_repo');
      return localize('com_config_skillsync_source_folders', { count: paths.length });
    })();
    return localize('com_config_skillsync_source_summary', {
      ref: filledText(item.ref) ?? 'main',
      paths: folders,
    });
  };

  return (
    <NestedGroup
      label={labelForPath(SOURCES, localize)}
      description={localize('com_config_desc_skillSync_github_sources')}
      sectionId={`section-${SOURCES}`}
      configuredCount={items.length}
      totalCount={items.length}
      entries
      defaultExpanded
      onAdd={disabled ? undefined : () => addTriggerRef.current?.()}
      addLabel={localize('com_config_skillsync_add_source')}
      disabled={disabled}
      revealPaths={[SOURCES]}
    >
      <ArrayObjectField
        id={toFieldId(SOURCES)}
        path={SOURCES}
        value={value}
        fields={field.children ?? []}
        onChange={(next) => onChange(SOURCES, next)}
        onEntryChange={handleEntryChange}
        disabled={disabled}
        hideAddButton
        addTriggerRef={addTriggerRef}
        renderFields={renderCollectionEntryFields}
        editSessionId={editSessionId}
        getEntryTitle={sourceTitle}
        renderSummary={summary}
        emptyLabel={localize('com_config_skillsync_no_sources')}
      />
    </NestedGroup>
  );
}

/**
 * Skill sync (FX-13): the GitHub settings as rows, and its sources as cards;
 * GitHub settings the schema doesn't know (a newer LibreChat's) are listed
 * read-only in the GitHub group.
 * Overrides apply to syncs LibreChat starts on request; the scheduled sync
 * reads librechat.yaml (the section banner says so).
 */
export function SkillSyncRenderer(props: t.FieldRendererProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const github = props.fields.find((field) => field.key === 'github');
  const sources = github?.children?.find((field) => field.key === 'sources');
  if (!github?.children || !sources) return <FieldRenderer {...props} />;
  const githubValue = getValueAtPath(props.parentValue ?? null, 'github');
  const settings = github.children.filter((field) => field.key !== 'sources');
  const others = props.fields.filter((field) => field.key !== 'github');
  const counts = countConfigured(github.children, GITHUB, props.configuredPaths);
  return (
    <>
      {isRowVisible(rowFilter, GITHUB) && (
        <NestedGroup
          label={labelForPath(GITHUB, localize)}
          sectionId={`section-${GITHUB}`}
          configuredCount={counts.configured}
          totalCount={counts.total}
          defaultExpanded
          revealPaths={[GITHUB]}
        >
          <FieldRenderer
            {...props}
            fields={settings}
            parentValue={isConfigRecord(githubValue) ? githubValue : {}}
            parentPath={GITHUB}
          />
          <SourcesGroup field={sources} fieldProps={props} />
          {!rowFilter && (
            <UnknownSettings fields={github.children} value={githubValue} path={GITHUB} />
          )}
        </NestedGroup>
      )}
      {others.length > 0 && <FieldRenderer {...props} fields={others} />}
      {!rowFilter && (
        <UnknownSettings fields={props.fields} value={props.parentValue} path={SECTION} />
      )}
    </>
  );
}
