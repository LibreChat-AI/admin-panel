import type * as t from '@/types';
import { optionLabels, settingRows } from '../../values';
import { UnknownSettings } from '../../UnknownSettings';
import { labelForPath } from '../../meta';
import { isConfigRecord } from '@/utils';
import { useLocalize } from '@/hooks';

const PII_KEY = 'pii';
const SURFACE_LISTED_KEYS: ReadonlySet<string> = new Set([PII_KEY]);
const PII_LISTED_KEYS: ReadonlySet<string> = new Set([
  'action',
  'fields',
  'starterPatterns',
  'customPatterns',
]);

/** The label of each action a filter takes; one a newer LibreChat adds shows by its own name. */
const ACTION_LABEL_KEYS: Readonly<Record<string, string>> = {
  block: 'com_config_features_filters_block',
  audit: 'com_config_features_filters_audit',
  redact: 'com_config_features_filters_redact',
};

/** Actions that let content through (logged, or with matches replaced), on an info badge; blocking warns. */
const PASSING_ACTIONS: ReadonlySet<string> = new Set(['audit', 'redact']);

function childField(field: t.SchemaField | undefined, key: string): t.SchemaField | undefined {
  return field?.children?.find((child) => child.key === key);
}

/** What one surface's filter does, read from librechat.yaml's value and the schema's labels. */
function summarizeSurface(
  surface: t.SchemaField,
  value: t.ConfigValue,
  localize: t.LocalizeFn,
): t.FilterSurfaceSummary {
  const record = isConfigRecord(value) ? value : {};
  const piiField = childField(surface, PII_KEY);
  const pii = isConfigRecord(record[PII_KEY]) ? record[PII_KEY] : undefined;
  const extras = [
    ...settingRows(surface.children ?? [], record, localize, {
      path: surface.path,
      skip: SURFACE_LISTED_KEYS,
    }),
    ...(pii
      ? settingRows(piiField?.children ?? [], pii, localize, {
          path: `${surface.path}.${PII_KEY}`,
          skip: PII_LISTED_KEYS,
        })
      : []),
  ];
  const custom = Array.isArray(pii?.customPatterns) ? pii.customPatterns : [];
  return {
    key: surface.key,
    label: labelForPath(surface.path, localize),
    action: pii ? String(pii.action ?? 'block') : undefined,
    fields:
      pii?.fields == null ? [] : optionLabels(childField(piiField, 'fields'), pii.fields, localize),
    starterPatterns:
      pii?.starterPatterns == null
        ? null
        : optionLabels(childField(piiField, 'starterPatterns'), pii.starterPatterns, localize),
    customPatterns: custom.map((pattern) =>
      isConfigRecord(pattern) ? String(pattern.label ?? pattern.id ?? '') : String(pattern),
    ),
    extras,
  };
}

function SurfaceCard({ summary }: t.SurfaceCardProps) {
  const localize = useLocalize();
  const passes = summary.action != null && PASSING_ACTIONS.has(summary.action);
  const actionKey = summary.action ? ACTION_LABEL_KEYS[summary.action] : undefined;
  const builtIn = (() => {
    if (summary.starterPatterns == null) return localize('com_config_features_filters_all_builtin');
    if (summary.starterPatterns.length === 0) {
      return localize('com_config_features_filters_no_builtin');
    }
    return summary.starterPatterns.join(', ');
  })();
  return (
    <li className="flex flex-col gap-2 rounded-md border border-(--cui-color-stroke-default) px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-(--cui-color-text-default)">{summary.label}</span>
        {summary.action && (
          <span
            className={
              passes
                ? 'rounded-full bg-(--settings-info-bg) px-2 py-0.5 text-xs font-medium text-(--settings-info-fg)'
                : 'rounded-full bg-(--settings-warn-bg) px-2 py-0.5 text-xs font-medium text-(--settings-warn-fg)'
            }
          >
            {actionKey ? localize(actionKey) : summary.action}
          </span>
        )}
      </div>
      <dl className="m-0 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">
        {summary.action && (
          <>
            <dt className="text-(--settings-muted-fg)">
              {localize('com_config_features_filters_scans')}
            </dt>
            <dd className="m-0 text-(--cui-color-text-default)">
              {summary.fields.length > 0
                ? summary.fields.join(', ')
                : localize('com_config_features_filters_all_fields')}
            </dd>
            <dt className="text-(--settings-muted-fg)">
              {localize('com_config_features_filters_patterns')}
            </dt>
            <dd className="m-0 text-(--cui-color-text-default)">
              {summary.customPatterns.length > 0
                ? localize('com_config_features_filters_patterns_custom', {
                    builtIn,
                    custom: summary.customPatterns.join(', '),
                  })
                : builtIn}
            </dd>
          </>
        )}
        {summary.extras.map((extra) => (
          <div key={extra.path} className="contents">
            <dt className="text-(--settings-muted-fg)">{extra.label}</dt>
            <dd className="m-0 text-(--cui-color-text-default)">{extra.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/**
 * Content filters (FX-1). LibreChat reads `filters` only from librechat.yaml
 * (`BASE_ONLY_CONFIG_SECTIONS`), so instead of a dozen empty editable groups
 * the section summarizes what librechat.yaml sets: per surface, the action
 * (block or audit), the fields scanned and the patterns used, with the
 * surfaces nothing filters listed together.
 */
export function ContentFiltersRenderer({
  fields,
  getValue,
  parentPath,
  parentValue,
}: t.FieldRendererProps) {
  const localize = useLocalize();
  const summaries = fields.map((surface) =>
    summarizeSurface(surface, getValue(`${parentPath}.${surface.key}`, undefined), localize),
  );
  const active = summaries.filter((summary) => summary.action || summary.extras.length > 0);
  const inactive = summaries.filter((summary) => !summary.action && summary.extras.length === 0);
  return (
    <div className="flex flex-col gap-3 pt-1 pb-2">
      {active.length === 0 ? (
        <p className="m-0 text-sm text-(--cui-color-text-default)">
          {localize('com_config_features_filters_none')}
        </p>
      ) : (
        <ul
          className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2"
          aria-label={localize('com_config_features_filters_active')}
        >
          {active.map((summary) => (
            <SurfaceCard key={summary.key} summary={summary} />
          ))}
        </ul>
      )}
      {inactive.length > 0 && (
        <p className="m-0 text-xs text-(--settings-muted-fg)">
          {localize(
            active.length === 0
              ? 'com_config_features_filters_available'
              : 'com_config_features_filters_unfiltered',
            { surfaces: inactive.map((summary) => summary.label).join(', ') },
          )}
        </p>
      )}
      <p className="m-0 text-xs text-(--settings-muted-fg)">
        {localize('com_config_features_filters_how')}
      </p>
      <UnknownSettings fields={fields} value={parentValue} path={parentPath} />
    </div>
  );
}
