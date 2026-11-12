import type * as t from '@/types';
import { isAgentSpec, problemsOf, specEndpoint } from './validation';
import { isConfigRecord, trimmedText } from '@/utils';
import { endpointLabelOf } from './options';
import { useSpecList } from './context';
import { useLocalize } from '@/hooks';
import { SpecIcon } from './Icon';

/** A spec's display title: its label, else its name, else "New spec". */
export function specTitle(spec: t.ConfigValue, localize: t.LocalizeFn): string {
  if (!isConfigRecord(spec)) return localize('com_config_specs_new');
  return trimmedText(spec.label) || trimmedText(spec.name) || localize('com_config_specs_new');
}

/** The icon before a spec's title in the list. */
export function SpecLeading({ spec }: { spec: t.ConfigValue }) {
  const localize = useLocalize();
  const record = isConfigRecord(spec) ? spec : {};
  return <SpecIcon iconURL={record.iconURL} label={specTitle(spec, localize)} />;
}

function SummaryChip({
  kind,
  label,
  description,
}: {
  kind: 'changed' | 'default' | 'hidden' | 'error' | 'warning';
  label: string;
  description?: string;
}) {
  return (
    <span className={`state-chip state-chip-${kind}`} title={description}>
      {label}
      {description && <span className="sr-only">{`, ${description}`}</span>}
    </span>
  );
}

/**
 * A collapsed spec row: Default / Soft default / Hidden badges, its problems,
 * then its name (when the label differs), endpoint · model and group, muted.
 */
export function SpecSummary({ spec, index }: t.SpecSummaryProps) {
  const localize = useLocalize();
  const { problems, options } = useSpecList();
  if (!isConfigRecord(spec)) return null;
  const preset = isConfigRecord(spec.preset) ? spec.preset : {};
  const own = problemsOf(problems, index);
  const errors = own.filter((problem) => problem.level === 'error').length;
  const warnings = own.length - errors;
  const name = trimmedText(spec.name);
  const label = trimmedText(spec.label);
  const target = isAgentSpec(spec) ? trimmedText(preset.agent_id) : trimmedText(preset.model);
  const details = [
    name && name !== label ? name : '',
    [endpointLabelOf(options, specEndpoint(spec)), target].filter(Boolean).join(' · '),
    trimmedText(spec.group)
      ? localize('com_config_specs_summary_group', { group: trimmedText(spec.group) })
      : '',
  ].filter(Boolean);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex shrink-0 items-center gap-1">
        {spec.default === true && (
          <SummaryChip
            kind="changed"
            label={localize('com_config_specs_badge_default')}
            description={localize('com_config_specs_badge_default_desc')}
          />
        )}
        {spec.softDefault === true && (
          <SummaryChip
            kind="default"
            label={localize('com_config_specs_badge_soft')}
            description={localize('com_config_specs_badge_soft_desc')}
          />
        )}
        {spec.showInMenu === false && (
          <SummaryChip
            kind="hidden"
            label={localize('com_config_specs_badge_hidden')}
            description={localize('com_config_specs_badge_hidden_desc')}
          />
        )}
        {errors > 0 && (
          <SummaryChip
            kind="error"
            label={localize('com_config_specs_badge_errors', { count: errors })}
          />
        )}
        {errors === 0 && warnings > 0 && (
          <SummaryChip
            kind="warning"
            label={localize('com_config_specs_badge_warnings', { count: warnings })}
          />
        )}
      </span>
      {details.length > 0 && <span className="min-w-0 truncate">{details.join(' · ')}</span>}
    </span>
  );
}
