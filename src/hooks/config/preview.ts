import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { baseConfigOptions, configPreviewOptions, availableScopesOptions } from '@/server';
import { useConfigFeatures, useConfigWriteRules } from './contract';
import { isSameScope, estimateConfigPreview } from '@/utils';
import { scopeConfigOptions } from './layers';
import { BASE_PRINCIPAL } from '@/constants';

/** The principal a preview target resolves: Base, or the role, group or user. */
function previewPrincipal(target: t.PreviewTarget): t.ConfigPrincipal {
  if (target.type === 'BASE') return BASE_PRINCIPAL;
  const { principalType, principalId } = target.principal;
  return { principalType, principalId };
}

/** Locale key of why the server refused a preview. */
function previewErrorKey(
  result: Extract<t.ConfigPreviewResult, { ok: false }>,
  principal: t.ConfigPrincipal,
): string {
  if (result.status === 403) {
    return principal.principalType === PrincipalType.USER
      ? 'com_config_preview_error_user_forbidden'
      : 'com_config_preview_error_forbidden';
  }
  if (result.status === 404) return 'com_config_preview_error_not_found';
  return 'com_config_preview_error';
}

/** Locale key of why a server preview failed: the request, or the server's refusal; none when it loaded. */
function serverErrorKey(
  failed: boolean,
  result: t.ConfigPreviewResult | undefined,
  principal: t.ConfigPrincipal,
): string | undefined {
  if (failed) return 'com_config_preview_error';
  if (!result || result.ok) return undefined;
  return previewErrorKey(result, principal);
}

/**
 * The config `target` gets, for the preview. A server with
 * `resolvedApi` resolves it: what Base, a role or a group resolves to, or a
 * user over every profile that applies to them, with what LibreChat leaves
 * out of each document. Otherwise the panel estimates it from Base and the
 * principal's own profile (`estimateConfigPreview`), as the editor does.
 */
export function useConfigPreview(target: t.PreviewTarget): t.PreviewState {
  const { resolvedApi, keyedTombstones } = useConfigFeatures();
  const rules = useConfigWriteRules();
  const principal = previewPrincipal(target);
  const isBase = target.type === 'BASE';
  const estimates = !resolvedApi;

  const server = useQuery({ ...configPreviewOptions(principal), enabled: resolvedApi });
  const base = useQuery({ ...baseConfigOptions, enabled: estimates });
  const scopes = useQuery({ ...availableScopesOptions, enabled: estimates && !isBase });
  const scope = isBase ? undefined : scopes.data?.find((entry) => isSameScope(entry, principal));
  const own = useQuery({
    ...scopeConfigOptions(estimates && scope ? principal : null),
    enabled: estimates && scope != null,
  });

  const estimate = useMemo(() => {
    if (resolvedApi || !base.data) return undefined;
    if (!isBase && (!scopes.data || (scope && !own.data))) return undefined;
    return estimateConfigPreview({
      base: base.data,
      scope,
      own: own.data,
      rules,
      keyedTombstones,
    });
  }, [resolvedApi, base.data, isBase, scopes.data, scope, own.data, rules, keyedTombstones]);

  if (resolvedApi) {
    const result = server.data;
    return {
      preview: result?.ok ? result.preview : undefined,
      isLoading: server.isLoading,
      errorKey: serverErrorKey(server.isError, result, principal),
      retry: () => void server.refetch(),
    };
  }
  const failed = base.isError || scopes.isError || own.isError;
  return {
    preview: estimate,
    isLoading: !estimate && !failed,
    errorKey: failed ? 'com_config_preview_error' : undefined,
    retry: () => {
      void base.refetch();
      if (!isBase) void scopes.refetch();
      if (scope) void own.refetch();
    },
  };
}
