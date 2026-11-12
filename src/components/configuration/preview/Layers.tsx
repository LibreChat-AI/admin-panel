import { useMemo } from 'react';
import { Badge } from '@clickhouse/click-ui';
import { useQuery } from '@tanstack/react-query';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { isSameScope, countDocumentOverrides, formatScopeName, isBasePrincipal } from '@/utils';
import { allGroupsQueryOptions, availableScopesOptions } from '@/server';
import { PREVIEW_IGNORE_REASON_KEYS, PREVIEW_HIDDEN_IGNORE_REASON_KEYS } from '@/constants';
import { useLocalize, useConfigFeatures } from '@/hooks';
import { formatSegments } from './sections';
import { sourceLabel } from '../values';

/**
 * Display names of the principals a preview lists: the target's own, the
 * profiles' (which hold role, group and user names), then group names; a
 * principal none of them names shows its id.
 */
function usePrincipalLabel(
  preview: t.ConfigPreview,
  target: t.PreviewTarget,
): (principal: t.ConfigPrincipal) => string {
  const localize = useLocalize();
  const { data: scopes = [] } = useQuery(availableScopesOptions);
  const listsGroups = [...preview.layers, ...(preview.principals ?? [])].some(
    (principal) => principal.principalType === PrincipalType.GROUP,
  );
  const { data: groups = [] } = useQuery({ ...allGroupsQueryOptions, enabled: listsGroups });
  return useMemo(() => {
    const groupNames = new Map(groups.map((group) => [group.id, group.name]));
    return (principal: t.ConfigPrincipal) => {
      if (isBasePrincipal(principal)) return localize('com_config_preview_layer_base');
      const own =
        target.type === 'PRINCIPAL' && isSameScope(target.principal, principal)
          ? target.principal.name
          : undefined;
      const scope = scopes.find((entry) => isSameScope(entry, principal));
      const name =
        own ??
        (scope ? formatScopeName(scope) : undefined) ??
        groupNames.get(principal.principalId) ??
        principal.principalId;
      return sourceLabel('scope', localize, { principalType: principal.principalType, name });
    };
  }, [groups, scopes, target, localize]);
}

/** The locale key that says why `item` is not applied as written. */
function reasonKey(item: t.PreviewIgnored): string {
  const hidden = item.tombstone ? PREVIEW_HIDDEN_IGNORE_REASON_KEYS[item.reason] : undefined;
  return hidden ?? PREVIEW_IGNORE_REASON_KEYS[item.reason];
}

function IgnoredList({ ignored }: t.PreviewIgnoredListProps) {
  const localize = useLocalize();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-(--settings-warn-fg)">
        {localize('com_config_preview_ignored_title', { count: ignored.length })}
      </span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {ignored.map((item, index) => (
          <li
            key={`${item.reason}:${item.segments.join('\u0000')}:${index}`}
            className="flex flex-col text-xs"
            data-ignored-reason={item.reason}
          >
            <code className="font-mono wrap-break-word text-(--cui-color-text-default)">
              {item.tombstone
                ? localize('com_config_preview_ignored_hidden', {
                    path: formatSegments(item.segments),
                  })
                : formatSegments(item.segments)}
            </code>
            <span className="text-(--cui-color-text-muted)">
              {localize(reasonKey(item), { code: item.code ?? '' })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LayerRow({ layer, label }: t.PreviewLayerRowProps) {
  const localize = useLocalize();
  const features = useConfigFeatures();
  const settings = countDocumentOverrides(layer.overrides, features);
  const hidden = layer.tombstones.length;
  const details = [
    !isBasePrincipal(layer) && localize('com_scope_priority', { priority: layer.priority }),
    localize('com_config_preview_layer_settings', { count: settings }),
    hidden > 0 && localize('com_config_preview_layer_hidden', { count: hidden }),
  ].filter((item): item is string => typeof item === 'string');
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-(--cui-color-stroke-default) px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-(--cui-color-text-default)">{label}</span>
        {!layer.isActive && (
          <Badge text={localize('com_config_preview_layer_inactive')} state="warning" size="sm" />
        )}
      </div>
      <span className="text-xs text-(--cui-color-text-muted)">{details.join(' · ')}</span>
      {layer.ignored.length > 0 && <IgnoredList ignored={layer.ignored} />}
    </li>
  );
}

/**
 * The documents a preview merges, in merge order: librechat.yaml, then Base
 * and the profiles that apply, each with how much it sets and hides, whether
 * it is inactive (listed but not merged), and what LibreChat leaves out of it
 * and why (a server with `resolvedApi`). For a user, the role and groups
 * their requests resolve to.
 */
export function PreviewLayers({ preview, target }: t.PreviewLayersProps) {
  const localize = useLocalize();
  const labelOf = usePrincipalLabel(preview, target);
  const memberships = (preview.principals ?? []).filter(
    (principal) => principal.principalType !== PrincipalType.USER,
  );
  return (
    <section aria-labelledby="config-preview-layers" className="flex flex-col gap-2">
      <h3
        id="config-preview-layers"
        className="m-0 text-xs font-semibold tracking-wide text-(--cui-color-text-muted) uppercase"
      >
        {localize('com_config_preview_layers_title')}
      </h3>
      {memberships.length > 0 && (
        <p className="m-0 text-xs text-(--cui-color-text-muted)">
          {localize('com_config_preview_memberships', {
            names: memberships.map(labelOf).join(', '),
          })}
        </p>
      )}
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        <li className="flex flex-col gap-0.5 rounded-md border border-(--cui-color-stroke-default) px-3 py-2">
          <span className="text-sm font-medium text-(--cui-color-text-default)">
            {localize('com_config_values_source_yaml')}
          </span>
          <span className="text-xs text-(--cui-color-text-muted)">
            {localize('com_config_preview_layer_yaml')}
          </span>
        </li>
        {preview.layers.map((layer) => (
          <LayerRow
            key={`${layer.principalType}:${layer.principalId}`}
            layer={layer}
            label={labelOf(layer)}
          />
        ))}
      </ol>
      {preview.layers.length === 0 && (
        <p className="m-0 text-xs text-(--cui-color-text-muted)">
          {localize('com_config_preview_no_layers')}
        </p>
      )}
    </section>
  );
}
