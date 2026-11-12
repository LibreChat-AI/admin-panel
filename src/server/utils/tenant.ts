import { createServerOnlyFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';

/**
 * The `X-Tenant-Id` the deployment (its reverse proxy or auth gateway) set on
 * the request to the panel, trimmed; `undefined` when it carried none, as in
 * single-tenant deploys.
 *
 * `createServerOnlyFn` (not a plain function): this file is reachable from a
 * client-bundled route (login.tsx -> @/server -> scopes.ts -> utils/api.ts ->
 * utils/refresh.ts) even though every actual caller is server-only, so the
 * bundler can't otherwise prove `getRequestHeader` stays out of the client build.
 */
export const readTenantHeader = createServerOnlyFn((): string | undefined => {
  const raw = getRequestHeader('x-tenant-id');
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
});

/**
 * Headers that carry the request's tenant to LibreChat on a call made before
 * the admin has a token (sign-in, 2FA, SSO, refresh), so that LibreChat's
 * `preAuthTenantMiddleware` scopes the user lookup to it. Empty without a
 * tenant header; LibreChat only reads it when it trusts the header.
 */
export function tenantHeaders(): Record<string, string> {
  const tenantId = readTenantHeader();
  return tenantId ? { 'X-Tenant-Id': tenantId } : {};
}
