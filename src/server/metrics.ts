import { timingSafeEqual } from 'crypto';
import client, { register } from 'prom-client';
import type { Registry } from 'prom-client';

/** prom-client's own 10 ms default wakes an idle server about 100 times a second. */
const DEFAULT_EVENT_LOOP_PRECISION_MS = 1000;
/** The largest resolution Bun's `monitorEventLoopDelay` accepts; anything above it throws at startup. */
const MAX_EVENT_LOOP_PRECISION_MS = 2_147_483_647;

function eventLoopPrecision(raw: string | undefined): number {
  const value = Number(raw);
  const valid = Number.isInteger(value) && value >= 1 && value <= MAX_EVENT_LOOP_PRECISION_MS;
  return valid ? value : DEFAULT_EVENT_LOOP_PRECISION_MS;
}

/** Registers prom-client's process metrics, sampling event-loop delay every 1 s unless the env says otherwise. */
export function collectDefaultMetrics(registry: Registry = register): void {
  client.collectDefaultMetrics({
    register: registry,
    eventLoopMonitoringPrecision: eventLoopPrecision(
      process.env.ADMIN_PANEL_METRICS_EVENT_LOOP_PRECISION_MS,
    ),
  });
}

collectDefaultMetrics();

const KNOWN_APP_ROUTES = new Map<string, string>([
  ['/', '/'],
  ['/login', '/login'],
  ['/access', '/access'],
  ['/configuration', '/configuration'],
  ['/grants', '/grants'],
  ['/help', '/help'],
  ['/users', '/users'],
  ['/auth/openid/callback', '/auth/openid/callback'],
  ['/auth/google/callback', '/auth/google/callback'],
  ['/auth/saml/callback', '/auth/saml/callback'],
]);

const STATIC_ASSET_RE =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webmanifest|webp|woff2?)$/i;

const SERVER_FUNCTION_PREFIXES = [
  '/_server',
  '/_serverFn',
  '/__server',
  '/_tanstack',
  '/api/_server',
];

function canonicalPath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/unknown';
  if (pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '');
}

export function normalizeMetricsPath(pathname: string): string {
  const path = canonicalPath(pathname);

  const appRoute = KNOWN_APP_ROUTES.get(path);
  if (appRoute) return appRoute;

  if (path === '/metrics') return '/metrics';

  if (path.startsWith('/assets/') || STATIC_ASSET_RE.test(path)) {
    return 'static_asset';
  }

  if (SERVER_FUNCTION_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return 'server_function';
  }

  return 'unknown';
}

export const httpRequestsTotal = new client.Counter({
  name: 'admin_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status_code'] as const,
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'admin_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export async function metricsResponse(req: Request): Promise<Response> {
  const secret = process.env.ADMIN_PANEL_METRICS_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || !auth) return new Response(null, { status: 401 });

  const token = auth.replace(/^bearer\s+/i, '');
  const encode = (s: string) => new TextEncoder().encode(s);
  const expected = encode(secret);
  const actual = encode(token);
  const maxLen = Math.max(expected.byteLength, actual.byteLength);
  const paddedExpected = new Uint8Array(maxLen);
  const paddedActual = new Uint8Array(maxLen);
  paddedExpected.set(expected);
  paddedActual.set(actual);
  const lengthMatch = expected.byteLength === actual.byteLength;
  if (!timingSafeEqual(paddedExpected, paddedActual) || !lengthMatch) {
    return new Response(null, { status: 401 });
  }

  try {
    const data = await register.metrics();
    return new Response(data, { headers: { 'Content-Type': register.contentType } });
  } catch {
    return new Response(null, { status: 500 });
  }
}
