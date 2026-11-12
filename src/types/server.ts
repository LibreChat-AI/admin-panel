import type { TUser } from 'librechat-data-provider';
import type { SsoProviderId } from './auth';

export type SerializableUser = Pick<TUser, 'id' | 'email' | 'name' | 'role'>;

export interface SessionData {
  user?: SerializableUser;
  token?: string;
  refreshToken?: string;
  /** How the admin signed in: a password (`librechat`), or the SSO provider. */
  tokenProvider?: 'librechat' | SsoProviderId;
  /** Absolute expiry of `token` (ms epoch). Drives proactive refresh. */
  expiresAt?: number;
  lastVerified?: number;
  lastActivity?: number;
  codeVerifier?: string;
  /** The provider an SSO sign-in started with, which its callback's session belongs to. */
  ssoProvider?: SsoProviderId;
  /** The in-app path an SSO sign-in started from, for its callback to return to. */
  ssoRedirect?: string;
}

/** What the `admin-session` cookie seals: the envelope TanStack Start's former `useSession` (h3) wrote. */
export interface SessionRecord {
  id: string;
  createdAt: number;
  data: SessionData;
}

/** The current request's admin session. */
export interface SessionManager {
  readonly data: SessionData;
  /** Merges the fields into the session and reissues its cookie. */
  update: (update: Partial<SessionData>) => Promise<void>;
}

export interface SessionCookieOptions {
  path: string;
  secure: boolean;
  sameSite: 'lax';
  httpOnly: true;
  maxAge: number;
}

export interface SessionSettings {
  password: string;
  cookie: SessionCookieOptions;
}

/** One `Set-Cookie` of a chunked cookie write; `remove` expires that cookie. */
export interface CookieWrite {
  name: string;
  value: string;
  remove: boolean;
}

export interface AdminLoginResponse {
  token: string;
  user: SerializableUser;
  twoFAPending?: boolean;
  tempToken?: string;
}

export interface TwoFAVerifyResponse {
  token: string;
  user: SerializableUser;
}

export interface AdminVerifyResponse {
  user: SerializableUser;
}

export interface OAuthExchangeResponse {
  token: string;
  refreshToken?: string;
  user: SerializableUser;
  expiresAt?: number;
}

/** One page of an admin list endpoint: the items at an offset, and how many exist in all. */
export interface ListPage<T> {
  items: T[];
  total: number;
}

/** Whether a request is logged, and how many requests the current window has turned away. */
export interface FloodGuardDecision {
  admitted: boolean;
  /** Requests turned away in the window that just closed; reported once, when the next one opens. */
  suppressedInPriorWindow: number;
}

/** Caps how many requests are logged per window so a request flood does not become a log flood. */
export interface FloodGuard {
  admit: (nowMs: number) => FloodGuardDecision;
}

export interface MemoryWatermark {
  /** Returns the highest threshold (in MiB) newly crossed upward, or null. */
  check: (rssBytes: number) => number | null;
}

/** How a streamed response body settled: drained, failed, or abandoned by the client. */
export type BodyOutcome = 'complete' | 'error' | 'aborted';

/** Writes a request's `[req]` completion line with the status it was recorded under. */
export type CompleteRequest = (statusCode: string, outcome?: BodyOutcome) => void;

export interface RequestObserverOptions {
  /** Log `[req]` arrival and completion lines (`ADMIN_PANEL_REQUEST_LOG`); metrics are recorded either way. */
  logRequests: boolean;
  floodGuard?: FloodGuard;
}

export interface ObserveOptions {
  /** False leaves the body untouched, e.g. a `Bun.file` body Bun sends with sendfile and its own Content-Length. */
  monitorBody?: boolean;
}

/** Answers a request through `getResponse`, recording it in the HTTP metrics and the request log. */
export type ObserveRequest = (
  req: Request,
  pathname: string,
  getResponse: () => Response | Promise<Response>,
  options?: ObserveOptions,
) => Promise<Response>;
