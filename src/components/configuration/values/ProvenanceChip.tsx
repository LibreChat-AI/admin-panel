import { HoverCard } from '@clickhouse/click-ui';
import { useContext, useId, useState } from 'react';
import type * as t from '@/types';
import { describeStack, sourceLabel, formatLayerValue, formatConfigValue } from './labels';
import { useLocalize, useFieldState, useValuesScope, useHasValueLayers } from '@/hooks';
import { GlobalRevealContext } from '@/contexts/GlobalRevealContext';
import { DecorativeIcon } from '@/components/shared';
import { labelForPath } from '../meta';
import { cn } from '@/utils';

/** The settings-row chip style (WS6 `state-chip-*`) each value source is drawn with. */
const SOURCE_CHIPS: Readonly<Record<t.ProvenanceSource, string>> = {
  default: 'default',
  runtimeDefault: 'default',
  yaml: 'yaml',
  admin: 'override',
  scope: 'scope',
  inherited: 'inherited',
};

/** Sources a row leaves unmarked: its "Default: …" hint already says it. */
const DEFAULT_SOURCES: ReadonlySet<t.ProvenanceSource> = new Set(['default', 'runtimeDefault']);

/** A default, including one a profile inherits from a Base that does not set it. */
function isDefaultValue(state: t.FieldState): boolean {
  if (DEFAULT_SOURCES.has(state.source)) return true;
  const inherited = state.inherited?.source;
  return state.source === 'inherited' && inherited != null && DEFAULT_SOURCES.has(inherited);
}

/**
 * Whether a field marks the value Global (`endpoints.all`) overrules: only one
 * it holds (librechat.yaml, an override or an edit). An unset field already
 * names Global's value as its Default, and the provider's banner explains why.
 */
export function showsShadow(
  state: t.FieldState,
): state is t.FieldState & { shadowedBy: t.ShadowedBy } {
  return state.shadowedBy != null && (state.isConfigured || state.isOverride || state.isEdited);
}

/** How a shadowed value's source is named in the reason: "Edited" while it is a pending edit. */
export function shadowedSourceLabel(
  state: t.FieldState,
  localize: t.LocalizeFn,
  scope?: Pick<t.ScopeLayer, 'principalType' | 'name'> | null,
): string {
  if (state.isEdited) return localize('com_config_ui_state_edited');
  return sourceLabel(state.source, localize, scope);
}

/** Why a value is ignored: what Global sets (or that it sets nothing, so LibreChat's default applies). */
function shadowReason(shadowedBy: t.ShadowedBy, source: string, localize: t.LocalizeFn): string {
  const field = labelForPath(shadowedBy.path, localize);
  if (shadowedBy.value === undefined) {
    return localize(
      shadowedBy.precedence === 'pair'
        ? 'com_config_providers_shadow_pair'
        : 'com_config_providers_shadow_block_unset',
      { field, source },
    );
  }
  const value = formatConfigValue(shadowedBy.value, localize, shadowedBy.path);
  return localize(
    shadowedBy.precedence === 'block'
      ? 'com_config_providers_shadow_block'
      : 'com_config_providers_shadow_field',
    { field, value, source },
  );
}

/**
 * "Overridden by Global: gpt-5.6-luna" (D11): a value Global overrides
 * (`endpoints.all`) take precedence over. The chip is a disclosure: pressing
 * it (mouse, keyboard or touch) shows why the value is ignored, naming the
 * row's own source (`source`, e.g. librechat.yaml), so the row carries one
 * chip; screen readers hear the reason as its description. On the AI
 * providers tab it links to the Global value.
 */
export function ShadowBadge({ shadowedBy, source }: t.ShadowBadgeProps) {
  const localize = useLocalize();
  const reveal = useContext(GlobalRevealContext);
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const field = labelForPath(shadowedBy.path, localize);
  const value = formatConfigValue(shadowedBy.value, localize, shadowedBy.path);
  const reason = shadowReason(shadowedBy, source, localize);
  return (
    <>
      <span className="state-chip state-chip-shadowed" data-state-chip="shadowed">
        <button
          type="button"
          className="state-chip-link m-0 max-w-52 truncate"
          aria-expanded={open}
          aria-describedby={reasonId}
          onClick={() => setOpen((current) => !current)}
        >
          {shadowedBy.value !== undefined
            ? localize('com_config_providers_shadow_label_value', { value })
            : localize('com_config_providers_shadow_label')}
        </button>
        {reveal && (
          <button
            type="button"
            className="state-chip-link"
            onClick={() => reveal(shadowedBy.path)}
            aria-label={localize('com_config_providers_shadow_go', { field })}
            title={localize('com_config_providers_shadow_go', { field })}
          >
            <DecorativeIcon name="arrow-right" size="xs" />
          </button>
        )}
      </span>
      <span id={reasonId} hidden={!open} className="state-chip-reason">
        {reason}
      </span>
    </>
  );
}

/**
 * Where a field's value comes from (EV-1): Default, LibreChat default,
 * librechat.yaml, Admin override, "Role: USER", Inherited from Base or Hidden.
 * Hovering shows the layer stack ("Default 20,000 · librechat.yaml 1,000,000
 * · Admin override 2,500,000"); screen readers get the same summary. A field
 * shadowed by `endpoints.all` gets an extra warning badge. WS6 places it in
 * the settings row's `chips` slot.
 */
export function ProvenanceChip({
  state,
  scope,
  hideDefault,
  path = '',
  formatLayer,
}: t.ProvenanceChipProps) {
  const localize = useLocalize();
  if (state.ignoredOverride) {
    return (
      <span
        title={localize('com_config_values_ignored_override_desc')}
        className="state-chip state-chip-shadowed"
        data-state-chip="ignored-override"
      >
        {localize('com_config_values_ignored_override')}
        <span className="sr-only">{`, ${localize('com_config_values_ignored_override_desc')}`}</span>
      </span>
    );
  }
  const text = state.isHidden
    ? localize('com_config_values_source_hidden')
    : sourceLabel(state.source, localize, scope);
  if (showsShadow(state)) {
    return (
      <ShadowBadge
        shadowedBy={state.shadowedBy}
        source={shadowedSourceLabel(state, localize, scope)}
      />
    );
  }
  if (hideDefault && isDefaultValue(state) && !state.isHidden) return null;

  const chip = state.isHidden ? 'hidden' : SOURCE_CHIPS[state.source];
  const stack = state.stack ?? [];
  const summary = describeStack(state, localize, path, scope, formatLayer);
  const topIndex = stack.length - 1;

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1">
      <HoverCard openDelay={300}>
        <HoverCard.Trigger asChild>
          <span
            className={cn('state-chip', `state-chip-${chip}`)}
            data-provenance={state.isHidden ? 'hidden' : state.source}
          >
            {text}
            {summary && (
              <span className="sr-only">
                {localize('com_config_values_stack_aria', { stack: summary })}
              </span>
            )}
          </span>
        </HoverCard.Trigger>
        {stack.length > 0 && (
          <HoverCard.Content side="bottom" align="start" className="max-w-xs">
            <div className="flex flex-col gap-1.5 p-1 text-xs" aria-hidden="true">
              <span className="font-semibold text-(--cui-color-text-default)">
                {localize('com_config_values_stack_title')}
              </span>
              <ol className="flex flex-col gap-1">
                {stack.map((layer, index) => (
                  <li
                    key={`${layer.source}-${index}`}
                    className={cn(
                      'flex items-baseline justify-between gap-3',
                      index === topIndex
                        ? 'font-medium text-(--cui-color-text-default)'
                        : 'text-(--cui-color-text-muted)',
                    )}
                  >
                    <span>{sourceLabel(layer.source, localize, scope)}</span>
                    <span className="truncate">
                      {formatLayer?.(layer) ?? formatLayerValue(layer, localize, path)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </HoverCard.Content>
        )}
      </HoverCard>
    </span>
  );
}

/**
 * The provenance chip of one field, read from the nearest `ConfigValuesProvider`;
 * nothing outside a provider that has the layer model.
 */
export function FieldProvenance({ path, hideDefault, formatLayer }: t.FieldProvenanceProps) {
  const state = useFieldState(path);
  const scope = useValuesScope();
  const hasLayers = useHasValueLayers();
  if (!hasLayers) return null;
  return (
    <ProvenanceChip
      state={state}
      scope={scope}
      hideDefault={hideDefault}
      path={path}
      formatLayer={formatLayer}
    />
  );
}
