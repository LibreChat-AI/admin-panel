import type * as t from '@/types';
import { SESSION_ERROR_HEADER } from '@/constants';
import { withBasePath } from './navigation';

export function hasSessionRedirectHold(): boolean {
  return redirectHolds.size > 0;
}

const redirectHolds = new Set<(code: t.SessionErrorCode) => void>();

/** Keep unsaved work mounted and let its owner show session recovery. */
export function holdSessionRedirects(
  onError: (code: t.SessionErrorCode) => void = () => undefined,
): () => void {
  const listener = (code: t.SessionErrorCode) => onError(code);
  redirectHolds.add(listener);
  return () => {
    redirectHolds.delete(listener);
  };
}

/** Tell mounted draft owners why session recovery is needed. */
export function notifySessionRedirectHolds(code: t.SessionErrorCode): void {
  for (const onError of redirectHolds) onError(code);
}

/** A failed renewal reaches the login screen even when a server function catches the error. */
export async function sessionFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  const code = response.headers.get(SESSION_ERROR_HEADER);
  if (code !== 'OPENID_SESSION_ENDED' && code !== 'AUTH_SESSION_CHECK_UNAVAILABLE') {
    return response;
  }
  if (redirectHolds.size > 0) {
    notifySessionRedirectHolds(code);
    throw new Error(code);
  }
  const basePath = (import.meta.env.VITE_BASE_PATH ?? '').replace(/\/$/, '');
  const path = window.location.pathname;
  let pathname = path;
  if (path === basePath) pathname = '/';
  else if (basePath && path.startsWith(`${basePath}/`)) pathname = path.slice(basePath.length);
  const redirect = `${pathname}${window.location.search}${window.location.hash}`;
  const search = new URLSearchParams({
    session: code === 'OPENID_SESSION_ENDED' ? 'ended' : 'unavailable',
    redirect,
  });
  window.location.assign(withBasePath(`/login?${search}`, basePath));
  throw new Error(code);
}
