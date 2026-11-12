import { useId, useMemo, useState } from 'react';
import type * as t from '@/types';
import { formatPreviewYaml, previewSections, mergesUnappliedSettings } from './sections';
import { useLocalize, useConfigFeatures } from '@/hooks';
import { SelectField } from '../fields/SelectField';

/** Option value of "Every section"; never a config key. */
const ALL_SECTIONS = '\u0000all';

/**
 * The previewed config in librechat.yaml form, every section or one, with
 * the sections an admin override changes marked in the picker. Secrets are
 * shown as the server returns them (withheld, or as their masked preview).
 * Where Azure groups or Vertex AI read as merged but LibreChat doesn't apply
 * them yet (`mergesUnappliedSettings`), a note says members get
 * librechat.yaml's.
 */
export function PreviewConfig({ preview }: t.PreviewConfigProps) {
  const localize = useLocalize();
  const features = useConfigFeatures();
  const selectId = useId();
  const [section, setSection] = useState(ALL_SECTIONS);
  const sections = useMemo(() => previewSections(preview, localize), [preview, localize]);
  const changedCount = sections.filter((entry) => entry.changed).length;
  const known = section === ALL_SECTIONS || sections.some((entry) => entry.key === section);
  const shown = known ? section : ALL_SECTIONS;
  const text = useMemo(() => {
    if (shown === ALL_SECTIONS) return formatPreviewYaml(preview.resolved);
    if (preview.resolved[shown] === undefined) return null;
    return formatPreviewYaml({ [shown]: preview.resolved[shown] });
  }, [preview.resolved, shown]);

  const options: t.SelectOption[] = [
    { value: ALL_SECTIONS, label: localize('com_config_preview_all_sections') },
    ...sections.map((entry) => ({
      value: entry.key,
      label: entry.changed
        ? localize('com_config_preview_section_changed', { section: entry.label })
        : entry.label,
    })),
  ];

  return (
    <section aria-labelledby="config-preview-result" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3
            id="config-preview-result"
            className="m-0 text-xs font-semibold tracking-wide text-(--cui-color-text-muted) uppercase"
          >
            {localize('com_config_preview_result_title')}
          </h3>
          <p className="m-0 text-xs text-(--cui-color-text-muted)">
            {localize('com_config_preview_result_changed', { count: changedCount })}
          </p>
          {mergesUnappliedSettings(preview, features) && (
            <p className="m-0 text-xs text-(--settings-warn-fg)" data-preview-unapplied>
              {localize('com_config_preview_result_rederive_off')}
            </p>
          )}
        </div>
        <label htmlFor={selectId} className="sr-only">
          {localize('com_config_preview_section_label')}
        </label>
        <SelectField
          id={selectId}
          value={shown}
          options={options}
          onChange={setSection}
          width="M"
        />
      </div>
      {text === null ? (
        <p className="m-0 text-sm text-(--cui-color-text-muted)">
          {localize('com_config_preview_section_unset')}
        </p>
      ) : (
        <pre
          className="m-0 max-h-[60vh] overflow-auto rounded-md border border-(--cui-color-stroke-default) bg-(--cui-color-background-muted) p-3 font-mono text-xs leading-5 text-(--cui-color-text-default)"
          tabIndex={0}
          aria-label={localize('com_config_preview_result_title')}
          data-config-preview
        >
          <code>{text}</code>
        </pre>
      )}
    </section>
  );
}
