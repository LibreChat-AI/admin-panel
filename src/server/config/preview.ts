import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { CONFIG_PREVIEW_QUERY_KEY, PREVIEW_IGNORE_REASON_KEYS } from '@/constants';
import { isConfigRecord } from '@/utils';
import { apiFetch } from '../utils/api';

const IGNORE_REASONS: ReadonlySet<string> = new Set(Object.keys(PREVIEW_IGNORE_REASON_KEYS));
const PRINCIPAL_TYPES: ReadonlySet<string> = new Set(Object.values(PrincipalType));

function toStrings(value: t.ConfigValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toTree(value: t.ConfigValue): t.ConfigRecord {
  return isConfigRecord(value) ? value : {};
}

function toPrincipal(value: t.ConfigValue): t.ConfigPrincipal | null {
  if (!isConfigRecord(value)) return null;
  const { principalType, principalId } = value;
  if (typeof principalType !== 'string' || !PRINCIPAL_TYPES.has(principalType)) return null;
  if (typeof principalId !== 'string' || principalId === '') return null;
  return { principalType: principalType as PrincipalType, principalId };
}

/** What the merge leaves out of a layer; a reason a newer server adds reads as `unknown`. */
function toIgnored(value: t.ConfigValue): t.PreviewIgnored[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): t.PreviewIgnored[] => {
    if (!isConfigRecord(item)) return [];
    const segments = toStrings(item.segments);
    if (segments.length === 0) return [];
    const reason =
      typeof item.reason === 'string' && IGNORE_REASONS.has(item.reason)
        ? (item.reason as t.PreviewIgnoreReason)
        : 'unknown';
    return [
      {
        segments,
        reason,
        tombstone: item.tombstone === true,
        ...(typeof item.code === 'string' && { code: item.code }),
      },
    ];
  });
}

function toLayer(value: t.ConfigValue): t.PreviewLayer[] {
  const principal = toPrincipal(value);
  if (!principal || !isConfigRecord(value)) return [];
  return [
    {
      ...principal,
      priority: typeof value.priority === 'number' ? value.priority : 0,
      isActive: value.isActive !== false,
      overrides: toTree(value.overrides),
      tombstones: toStrings(value.tombstones),
      ignored: toIgnored(value.ignored),
    },
  ];
}

/**
 * A resolution the server returns (`GET /resolved/…` or `GET /effective`),
 * as the preview reads it: librechat.yaml, the documents in merge order with
 * what the merge leaves out of each, and the result, all in librechat.yaml
 * shape, read-filtered and with secrets redacted as the server returns them.
 * Null for a reply without a result.
 */
export function toConfigPreview(body: t.ConfigValue): t.ConfigPreview | null {
  if (!isConfigRecord(body) || !isConfigRecord(body.resolved)) return null;
  const principals = Array.isArray(body.principals)
    ? body.principals.flatMap((item) => toPrincipal(item) ?? [])
    : undefined;
  return {
    source: 'server',
    yaml: toTree(body.yaml),
    layers: Array.isArray(body.layers) ? body.layers.flatMap(toLayer) : [],
    resolved: body.resolved,
    ...(principals && { principals }),
  };
}

/** The admin route that resolves a principal: a user over every profile that applies to them, else one profile over Base. */
export function previewPath(principal: t.ConfigPrincipal): string {
  if (principal.principalType === PrincipalType.USER) {
    return `/api/admin/config/effective?userId=${encodeURIComponent(principal.principalId)}`;
  }
  return `/api/admin/config/resolved/${principal.principalType}/${encodeURIComponent(principal.principalId)}`;
}

/**
 * The config a principal gets, resolved by LibreChat (`resolvedApi`): Base
 * (`role` `__base__`), a role or group over Base, or a user over Base, their
 * role, their groups and their own profile. A refusal comes back as its
 * status and code, so the preview can say why.
 */
export const getConfigPreviewFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({ principalType: z.nativeEnum(PrincipalType), principalId: z.string().min(1) }),
  )
  .handler(async ({ data }: { data: t.ConfigPrincipal }): Promise<t.ConfigPreviewResult> => {
    const response = await apiFetch(previewPath(data));
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as t.ApiErrorBody;
      return {
        ok: false,
        status: response.status,
        ...(typeof body.code === 'string' && { code: body.code }),
        ...(typeof body.error === 'string' && { message: body.error }),
      };
    }
    const preview = toConfigPreview((await response.json()) as t.ConfigValue);
    return preview ? { ok: true, preview } : { ok: false, status: response.status };
  });

/** A principal's server-resolved preview; saves and profile changes make it stale (`RESOLVED_READ_QUERY_KEYS`). */
export const configPreviewOptions = (principal: t.ConfigPrincipal) =>
  queryOptions({
    queryKey: [CONFIG_PREVIEW_QUERY_KEY, principal.principalType, principal.principalId] as const,
    queryFn: () => getConfigPreviewFn({ data: principal }),
    staleTime: 30_000,
    retry: false,
  });
