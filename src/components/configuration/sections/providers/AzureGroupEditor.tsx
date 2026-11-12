import { useMemo, useRef } from 'react';
import type * as t from '@/types';
import { useLocalize, useValuesScope, useConfigKeyProblem } from '@/hooks';
import { EntryFieldChipsContext } from '@/contexts/EntryFieldChipsContext';
import { renderInlineField, toFieldId } from '../../renderer';
import { asConfigRecord, getValueAtPath } from '@/utils';
import { UnknownSettings } from '../../UnknownSettings';
import { DecorativeIcon } from '@/components/shared';
import { AZURE_GROUP_SECTIONS } from '@/constants';
import { SettingsRow } from '../../SettingsRow';
import { FieldChips } from '../endpoints/Chips';
import { sourceLabel } from '../../values';
import { TextField } from '../../fields';

const NAME_KEY = 'group';

/** Settings the editor's sections place; the name has its own row. */
const PLACED_KEYS: ReadonlySet<string> = new Set([
  NAME_KEY,
  ...AZURE_GROUP_SECTIONS.flatMap((section) => section.fields),
]);

/**
 * The group's name: editable for a group the target adds itself (a rename
 * the save carries by identity), locked for one librechat.yaml or Base
 * defines, since a merge by name would bring the original back.
 */
function NameRow({
  path,
  value,
  locked,
  lockNote,
  otherNames,
  onChange,
  disabled,
}: t.AzureGroupNameRowProps) {
  const localize = useLocalize();
  const keyProblem = useConfigKeyProblem();
  const id = toFieldId(`${path}.${NAME_KEY}`);
  const label = localize('com_config_providers_azure_field_group');
  if (locked || disabled) {
    return (
      <SettingsRow
        label={label}
        htmlFor={id}
        description={locked ? lockNote : undefined}
        control={
          <span className="flex items-center gap-1.5 self-start">
            {locked && (
              <span className="flex text-(--cui-color-text-muted)">
                <DecorativeIcon name="lock" size="xs" />
              </span>
            )}
            <span id={id} data-static-value className="static-value">
              {value}
            </span>
          </span>
        }
      />
    );
  }
  return (
    <SettingsRow
      label={label}
      htmlFor={id}
      description={localize('com_config_providers_azure_field_group_desc')}
      control={
        <TextField
          id={id}
          value={value}
          onChange={onChange}
          required
          width="M"
          validate={(next) => {
            const name = next.trim();
            if (otherNames.includes(name)) {
              return localize('com_config_providers_azure_name_taken', { name });
            }
            return keyProblem(name);
          }}
          aria-label={label}
        />
      }
    />
  );
}

/**
 * The editor of one Azure OpenAI group (`editsAzureGroups`): its name,
 * Connection (key, instance or base URL, deployment, API version), Models
 * and Request shaping, then any setting a newer schema adds. Each value the
 * target sets offers its revert to the layer beneath, and a key is a secret:
 * a stored one reads back as its masked preview and is kept unless replaced.
 */
export function AzureGroupEditor({
  path,
  fields,
  entry,
  onFieldChange,
  otherNames,
  disabled,
  editSessionId,
}: t.AzureGroupEditorProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const latestRef = useRef(entry.value);
  latestRef.current = entry.value;
  const fromLower = entry.origin === 'yaml' || entry.origin === 'inherited';
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const name = typeof entry.value.group === 'string' ? entry.value.group : '';

  /** Writes one setting of the group, merged into its latest value. */
  const change = (childPath: string, value: t.ConfigValue) => {
    const key = childPath.split('.').pop() ?? childPath;
    const next = { ...asConfigRecord(latestRef.current), [key]: value };
    if (value === undefined) delete next[key];
    latestRef.current = next;
    onFieldChange(key, value);
  };

  /** "Edited" with Undo, or the target's override of a value the layer beneath sets with its revert; none on a new group. */
  const renderChips = useMemo((): t.EntryFieldChipsRenderer | null => {
    if (entry.isNew || disabled) return null;
    const prefix = `${path}.`;
    return (props) => (
      <FieldChips
        {...props}
        saved={getValueAtPath(entry.saved ?? null, props.path.slice(prefix.length))}
        showOverride={fromLower}
      />
    );
  }, [entry.isNew, entry.saved, disabled, path, fromLower]);

  const render = (field: t.SchemaField) =>
    renderInlineField(
      field,
      entry.value,
      path,
      change,
      localize,
      disabled,
      undefined,
      !fromLower,
      editSessionId,
    );

  const others = fields.filter((field) => !PLACED_KEYS.has(field.key));
  const sections = [
    ...AZURE_GROUP_SECTIONS.map((section) => ({
      id: section.id,
      label: localize(section.labelKey),
      description: [
        section.descriptionKey ? localize(section.descriptionKey) : '',
        section.id === 'models' && fromLower
          ? localize('com_config_providers_azure_models_merge_note')
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      fields: section.fields.flatMap((key) => byKey.get(key) ?? []),
    })),
    {
      id: 'other',
      label: localize('com_config_providers_azure_section_other'),
      description: '',
      fields: others,
    },
  ].filter((section) => section.fields.length > 0);

  return (
    <EntryFieldChipsContext.Provider value={renderChips}>
      <div className="flex flex-col gap-6">
        <NameRow
          path={path}
          value={name}
          locked={fromLower}
          lockNote={localize(
            entry.origin === 'inherited'
              ? 'com_config_providers_azure_name_locked_inherited'
              : 'com_config_providers_azure_name_locked',
            { scope: scope ? sourceLabel('scope', localize, scope) : '' },
          )}
          otherNames={otherNames}
          onChange={(next) => change(NAME_KEY, next.trim())}
          disabled={disabled}
        />
        {sections.map((section) => {
          const headingId = `${toFieldId(path)}-section-${section.id}`;
          return (
            <section key={section.id} aria-labelledby={headingId} className="flex flex-col gap-2">
              <header className="flex flex-col gap-0.5 px-(--settings-row-px)">
                <h3
                  id={headingId}
                  className="m-0 text-sm font-semibold text-(--cui-color-text-default)"
                >
                  {section.label}
                </h3>
                {section.description && (
                  <p className="m-0 text-xs text-(--cui-color-text-muted)">{section.description}</p>
                )}
              </header>
              <div className="flex flex-col">{section.fields.map(render)}</div>
            </section>
          );
        })}
        <UnknownSettings fields={fields} value={entry.value} path={path} />
      </div>
    </EntryFieldChipsContext.Provider>
  );
}
