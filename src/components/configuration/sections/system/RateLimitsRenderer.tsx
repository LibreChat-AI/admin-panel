import { useContext } from 'react';
import type * as t from '@/types';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { isConfigRecord, getValueAtPath } from '@/utils';
import { UnknownSettings } from '../../UnknownSettings';
import { SettingList, settingRows } from '../../values';
import { useLocalize, useYamlConfig } from '@/hooks';
import { isRowShown } from '../files/FieldRow';
import { RATE_LIMITERS } from '@/constants';
import { toFieldId } from '../../renderer';
import { labelForPath } from '../../meta';

const SECTION = 'rateLimits';
/** The settings of a limiter the table shows; a limiter's other settings are listed under it. */
const LIMIT_FIELDS: ReadonlySet<string> = new Set([
  'ipMax',
  'ipWindowInMinutes',
  'userMax',
  'userWindowInMinutes',
]);

/** The entries of `value` the schema `fields` name, outside `skip` (unknown keys are listed apart). */
function schemaEntries(
  fields: readonly t.SchemaField[],
  value: t.ConfigValue,
  skip: ReadonlySet<string>,
): t.ConfigRecord {
  if (!isConfigRecord(value)) return {};
  const keys = new Set(fields.map((field) => field.key));
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => keys.has(key) && !skip.has(key)),
  );
}

/** Where a limit's two numbers come from, when librechat.yaml sets one, both or neither. */
const SOURCE_KEYS = {
  both: 'com_config_ratelimits_from_yaml',
  max: 'com_config_ratelimits_from_yaml_max',
  window: 'com_config_ratelimits_from_yaml_window',
  none: 'com_config_ratelimits_default',
} as const;

const valueClass = (fromYaml: boolean) =>
  fromYaml ? 'text-(--cui-color-text-default)' : 'text-(--settings-muted-fg)';

/**
 * A number librechat.yaml sets. LibreChat reads rate limits from that file
 * alone: no override applies, Base's in a profile included.
 */
function yamlNumber(yaml: t.ConfigRecord | null, path: string): number | undefined {
  const value = getValueAtPath(yaml, path);
  return typeof value === 'number' ? value : undefined;
}

/** One limit (requests and window), from librechat.yaml or LibreChat's fallback. */
function LimitCell({ limiter, scope }: { limiter: t.RateLimiterInfo; scope: 'ip' | 'user' }) {
  const localize = useLocalize();
  const yaml = useYamlConfig();
  const maxField: t.RateLimitField = scope === 'ip' ? 'ipMax' : 'userMax';
  const windowField: t.RateLimitField =
    scope === 'ip' ? 'ipWindowInMinutes' : 'userWindowInMinutes';
  const maxPath = `${SECTION}.${limiter.key}.${maxField}`;
  const windowPath = `${SECTION}.${limiter.key}.${windowField}`;
  const defaultMax = limiter.defaults[maxField];
  const defaultWindow = limiter.defaults[windowField];
  if (defaultMax === undefined || defaultWindow === undefined) {
    return (
      <span className="text-(--cui-color-text-muted)">
        {localize('com_config_ratelimits_not_limited')}
      </span>
    );
  }
  const setMax = yamlNumber(yaml, maxPath);
  const setWindow = yamlNumber(yaml, windowPath);
  const shownMax = setMax ?? defaultMax;
  const shownWindow = setWindow ?? defaultWindow;
  const maxFromYaml = setMax !== undefined;
  const windowFromYaml = setWindow !== undefined;
  /** librechat.yaml can set only one of the two; the other is then LibreChat's default. */
  const source = (() => {
    if (maxFromYaml && windowFromYaml) return SOURCE_KEYS.both;
    if (maxFromYaml) return SOURCE_KEYS.max;
    return windowFromYaml ? SOURCE_KEYS.window : SOURCE_KEYS.none;
  })();
  const envNames = `${limiter.envPrefix}_${scope.toUpperCase()}_MAX, ${limiter.envPrefix}_${scope.toUpperCase()}_WINDOW`;
  return (
    <span className="flex flex-col" title={envNames}>
      <span>
        <span id={toFieldId(maxPath)} className={valueClass(maxFromYaml)}>
          {localize('com_config_ratelimits_requests', { max: shownMax.toLocaleString() })}
        </span>
        <span className={valueClass(maxFromYaml && windowFromYaml)}>{' / '}</span>
        <span id={toFieldId(windowPath)} className={valueClass(windowFromYaml)}>
          {localize('com_config_ratelimits_window', { window: shownWindow.toLocaleString() })}
        </span>
      </span>
      <span className="text-xs text-(--settings-muted-fg)">{localize(source)}</span>
      <span className="sr-only">{envNames}</span>
    </span>
  );
}

/**
 * Rate limits as one read-only table (FX-12): for each limiter, the requests
 * allowed per IP address and per user, and their window, from librechat.yaml
 * or LibreChat's defaults (which `.env` variables can change). LibreChat sets
 * its limiters from librechat.yaml when it starts, so the panel only shows them,
 * read from librechat.yaml alone (an override, Base's in a profile, never applies).
 * With "Set values only", a limiter librechat.yaml leaves unset is left out.
 */
export function RateLimitsRenderer(props: t.FieldRendererProps) {
  const { fields } = props;
  const localize = useLocalize();
  const yaml = useYamlConfig();
  const rowFilter = useContext(RowFilterContext);
  const known = new Set(fields.map((field) => field.key));
  const limiters = RATE_LIMITERS.filter(
    (limiter) =>
      known.has(limiter.key) && isRowShown(rowFilter, `${SECTION}.${limiter.key}`, props),
  );
  const yamlValue = getValueAtPath(yaml, SECTION);
  const record = isConfigRecord(yamlValue) ? yamlValue : {};
  const tabled = new Set(RATE_LIMITERS.map((limiter) => limiter.key));
  const childrenOf = (key: string) => fields.find((field) => field.key === key)?.children ?? [];
  /** What librechat.yaml sets that the table has no column for: a newer limiter or setting. */
  const otherRows = rowFilter
    ? []
    : [
        ...settingRows(fields, schemaEntries(fields, record, tabled), localize, {
          path: SECTION,
        }),
        ...limiters.flatMap((limiter) => {
          const path = `${SECTION}.${limiter.key}`;
          const children = childrenOf(limiter.key);
          return settingRows(
            children,
            schemaEntries(children, record[limiter.key], LIMIT_FIELDS),
            localize,
            { path, prefix: labelForPath(path, localize) },
          );
        }),
      ];
  return (
    <>
      {limiters.length > 0 && (
        <div
          role="table"
          aria-label={localize('com_config_section_rate_limits')}
          className="flex flex-col py-1"
        >
          <div
            role="row"
            className="hidden grid-cols-[minmax(9rem,1.1fr)_1fr_1fr] gap-4 border-b border-(--cui-color-stroke-default) px-4 pb-2 text-xs font-medium text-(--cui-color-text-muted) sm:grid"
          >
            <span role="columnheader">{localize('com_config_ratelimits_col_limit')}</span>
            <span role="columnheader">{localize('com_config_ratelimits_col_ip')}</span>
            <span role="columnheader">{localize('com_config_ratelimits_col_user')}</span>
          </div>
          {limiters.map((limiter) => {
            const path = `${SECTION}.${limiter.key}`;
            return (
              <div
                key={limiter.key}
                role="row"
                id={`section-${path}`}
                className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-(--cui-color-stroke-default) px-4 py-2.5 text-sm last:border-b-0 sm:grid-cols-[minmax(9rem,1.1fr)_1fr_1fr]"
              >
                <span
                  role="rowheader"
                  className="col-span-2 font-medium text-(--cui-color-text-default) sm:col-span-1"
                >
                  {labelForPath(path, localize)}
                </span>
                <span role="cell" className="flex flex-col gap-0.5">
                  <span className="text-xs text-(--cui-color-text-muted) sm:hidden">
                    {localize('com_config_ratelimits_col_ip')}
                  </span>
                  <LimitCell limiter={limiter} scope="ip" />
                </span>
                <span role="cell" className="flex flex-col gap-0.5">
                  <span className="text-xs text-(--cui-color-text-muted) sm:hidden">
                    {localize('com_config_ratelimits_col_user')}
                  </span>
                  <LimitCell limiter={limiter} scope="user" />
                </span>
              </div>
            );
          })}
        </div>
      )}
      <SettingList rows={otherRows} label={localize('com_config_ratelimits_other')} />
      {!rowFilter && isConfigRecord(yamlValue) && (
        <>
          <UnknownSettings fields={fields} value={record} path={SECTION} />
          {fields.map((field) => (
            <UnknownSettings
              key={field.key}
              fields={field.children ?? []}
              value={record[field.key]}
              path={`${SECTION}.${field.key}`}
            />
          ))}
        </>
      )}
      <p className="m-0 px-4 pb-1 text-xs text-(--cui-color-text-muted)">
        {localize('com_config_ratelimits_env_note')}
      </p>
    </>
  );
}
