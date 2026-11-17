import { SESSION_ERROR_HEADER } from '@/constants';
import { withBasePath } from './navigation';

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
