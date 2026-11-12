/**
 * The body of the one-time code exchange, with the PKCE verifier the admin
 * session stored when SSO started; `undefined` when the session lost it (for
 * HTTP deployments, an admin-session cookie the browser refused as `Secure`).
 * LibreChat enforces the challenge it stored, so the exchange is not attempted
 * without one: that would only consume the code.
 */
export function buildOAuthExchangePayload(
  code: string,
  codeVerifier: string | undefined,
): string | undefined {
  if (!codeVerifier) return undefined;
  return JSON.stringify({ code, code_verifier: codeVerifier });
}
