const GATEWAY_AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED';
const POST_LOGIN_REDIRECT_KEY = 'admin-panel:post-login-redirect';

const watchedTargets = new WeakSet<object>();

async function isGatewaySessionEnded(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { code?: string } | null;
  return body?.code === GATEWAY_AUTHENTICATION_REQUIRED;
}

/**
 * The governance SSO gateway answers background requests with a 401
 * AUTHENTICATION_REQUIRED once the central session has ended. Reloading turns
 * that into a page load, which the gateway redirects to its login page with
 * this page as returnTo. Concurrent failures share one reload.
 */
export function watchGatewaySessionEnd(
  target: Pick<Window, 'fetch'> & { location: Pick<Location, 'reload'> },
): void {
  if (watchedTargets.has(target)) return;
  watchedTargets.add(target);
  const fetchFromWindow = target.fetch.bind(target);
  let reloadStarted = false;
  target.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await fetchFromWindow(...args);
    if (!(await isGatewaySessionEnded(response)) || reloadStarted) return response;
    reloadStarted = true;
    target.location.reload();
    return response;
  };
}

function isSafeRedirect(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

/** LibreChat drops redirectTo from the OpenID flow, so the page is kept for the callback */
export function rememberPostLoginRedirect(path: string): void {
  try {
    if (isSafeRedirect(path) && path !== '/') sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, path);
  } catch {
    /* sessionStorage can be unavailable in private browsing */
  }
}

export function takePostLoginRedirect(): string {
  try {
    const path = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    return path && isSafeRedirect(path) ? path : '/';
  } catch {
    return '/';
  }
}
