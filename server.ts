import { Glob } from 'bun';
import { join } from 'node:path';
import {
  isProbeRequest,
  reportOnBodyComplete,
  createFloodGuard,
  formatLoggedPath,
  createMemoryWatermark,
  parseMemoryThresholdsMb,
} from './src/server/logging';
import {
  metricsResponse,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  normalizeMetricsPath,
} from './src/server/metrics';

const CLIENT_DIR = join(import.meta.dir, 'dist', 'client');
const SERVER_ENTRY = new URL('./dist/server/server.js', import.meta.url);

const env = process.env;
const BASE_PATH = (env.VITE_BASE_PATH || '').replace(/\/$/, '');

// Fail fast on a missing/short SESSION_SECRET. Otherwise the session module throws
// lazily on the first server-function call, which Bun then surfaces as a confusing
// "Server function module export not resolved" error on every subsequent request.
const MIN_SESSION_SECRET_LENGTH = 32;
if (env.NODE_ENV !== 'development') {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
    console.error(
      `[admin-panel] SESSION_SECRET must be set to at least ${MIN_SESSION_SECRET_LENGTH} characters ` +
        `(got ${secret ? secret.length : 0}). Refusing to start.`,
    );
    process.exit(1);
  }
}

const ONE_DAY = 86400;
const rawMaxAge = Number(env.ADMIN_PANEL_STATIC_CACHE_MAX_AGE ?? env.STATIC_CACHE_MAX_AGE);
const rawSMaxAge = Number(env.ADMIN_PANEL_STATIC_CACHE_S_MAX_AGE ?? env.STATIC_CACHE_S_MAX_AGE);
const maxAge = Number.isNaN(rawMaxAge) ? ONE_DAY * 2 : rawMaxAge;
const sMaxAge = Number.isNaN(rawSMaxAge) ? ONE_DAY : rawSMaxAge;

const NO_CACHE: Record<string, string> = {
  'Cache-Control':
    env.ADMIN_PANEL_INDEX_CACHE_CONTROL ??
    env.INDEX_CACHE_CONTROL ??
    'no-cache, no-store, must-revalidate',
  Pragma: env.ADMIN_PANEL_INDEX_PRAGMA ?? env.INDEX_PRAGMA ?? 'no-cache',
  Expires: env.ADMIN_PANEL_INDEX_EXPIRES ?? env.INDEX_EXPIRES ?? '0',
};

const LONG_CACHE: Record<string, string> = {
  'Cache-Control': `public, max-age=${maxAge}, s-maxage=${sMaxAge}`,
};

const NEVER_CACHE = new Set(['manifest.json', 'sw.js', 'robots.txt']);

function getCacheHeaders(filePath: string): Record<string, string> {
  const fileName = filePath.split('/').pop() ?? '';
  if (NEVER_CACHE.has(fileName)) return NO_CACHE;
  if (filePath.startsWith('assets/')) return LONG_CACHE;
  return {};
}

// 'unsafe-inline' in style-src is required because Tailwind 4 + click-ui inject inline styles at runtime.
// TanStack Start's SSR injects an inline `<script type="module">import("/_build/...")</script>` to
// boot the client. Without a nonce or 'unsafe-inline' for script-src, browsers will block hydration.
// Threading a per-request nonce through TanStack Start's manifest is non-trivial; until that wiring
// lands we ship the policy as report-only so it surfaces violations in dev tooling without breaking
// hydration in prod. Set ADMIN_PANEL_CSP_ENFORCE=true to switch back to enforcement (only safe once
// the nonce path is in place).
const CSP_VALUE = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const CSP_ENFORCE = process.env.ADMIN_PANEL_CSP_ENFORCE === 'true';
const CSP_HEADER_NAME = CSP_ENFORCE
  ? 'Content-Security-Policy'
  : 'Content-Security-Policy-Report-Only';

function applySecurityHeaders(headers: Headers): void {
  const contentType = headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('text/html')) return;
  headers.set(CSP_HEADER_NAME, CSP_VALUE);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  if (process.env.NODE_ENV === 'production') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

type Handler = { default: { fetch: (req: Request) => Promise<Response> } };

const { default: handler } = (await import(SERVER_ENTRY.href)) as Handler;

const REQUEST_LOG = process.env.ADMIN_PANEL_REQUEST_LOG !== 'false';
const floodGuard = createFloodGuard();

async function withHttpObservability(
  req: Request,
  pathname: string,
  getResponse: () => Response | Promise<Response>,
  options?: { monitorBody?: boolean },
): Promise<Response> {
  const path = normalizeMetricsPath(pathname);
  const end = httpRequestDurationSeconds.startTimer({ method: req.method, path });

  // The arrival line is logged before the handler runs so that a request that
  // kills the process still leaves its method and path as the last log line.
  let logCompletion = false;
  let startedAt = 0;
  let loggedPath = '';
  if (REQUEST_LOG && !isProbeRequest(req.headers.get('user-agent'), new URL(req.url).pathname)) {
    const { admitted, suppressedInPriorWindow } = floodGuard.admit(Date.now());
    if (suppressedInPriorWindow > 0) {
      console.log(`[req] suppressed ${suppressedInPriorWindow} requests in prior window`);
    }
    if (admitted) {
      loggedPath = formatLoggedPath(new URL(req.url).pathname);
      startedAt = performance.now();
      console.log(`[req] ${req.method} ${loggedPath}`);
      logCompletion = true;
    }
  }

  const logDone = (status: string, note = ''): void => {
    const elapsed = Math.round(performance.now() - startedAt);
    console.log(`[req] ${req.method} ${loggedPath} ${status} ${elapsed}ms${note}`);
  };

  let res: Response;
  try {
    res = await getResponse();
  } catch (err) {
    // Bun's error callback turns this into a 500, but that line carries no method or
    // path, so the arrival tombstone would otherwise never be closed out.
    httpRequestsTotal.inc({ method: req.method, path, status_code: '500' });
    end({ status_code: '500' });
    if (logCompletion) logDone('500', ' handler-error');
    throw err;
  }

  const statusCode = String(res.status);
  httpRequestsTotal.inc({ method: req.method, path, status_code: statusCode });
  end({ status_code: statusCode });
  if (!logCompletion) return res;

  // Bun discards a HEAD body without reading or cancelling it, so a monitored
  // stream would never settle and the completion line would never be emitted.
  // A native file body must also be left intact: replacing it with a JavaScript
  // stream costs Bun's sendfile path and the Content-Length it derives from the
  // file, turning every static asset into a chunked transfer.
  if (req.method === 'HEAD' || options?.monitorBody === false) {
    logDone(statusCode);
    return res;
  }

  return reportOnBodyComplete(res, (outcome) =>
    logDone(statusCode, outcome === 'stream-error' ? ' stream-error' : ''),
  );
}

async function buildStaticRoutes(): Promise<Record<string, (req: Request) => Promise<Response>>> {
  const routes: Record<string, (req: Request) => Promise<Response>> = {};
  for await (const path of new Glob('**/*').scan(CLIENT_DIR)) {
    const file = Bun.file(`${CLIENT_DIR}/${path}`);
    const cache = getCacheHeaders(path);
    const routePath = `${BASE_PATH}/${path}`;
    routes[routePath] = (req) =>
      withHttpObservability(
        req,
        routePath,
        () => {
          const res = new Response(file, { headers: { 'Content-Type': file.type, ...cache } });
          applySecurityHeaders(res.headers);
          return res;
        },
        { monitorBody: false },
      );
  }
  return routes;
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    ...(await buildStaticRoutes()),
    '/metrics': (req) => metricsResponse(req),
    '/health': () => new Response('ok'),
    ...(BASE_PATH ? { [`${BASE_PATH}`]: () => Response.redirect(`${BASE_PATH}/`, 302) } : {}),
    '/*': async (req) => {
      const url = new URL(req.url);
      const metricsPath = BASE_PATH && url.pathname.startsWith(BASE_PATH)
        ? url.pathname.slice(BASE_PATH.length) || '/'
        : url.pathname;
      const res = await withHttpObservability(req, metricsPath, () => handler.fetch(req));
      const patched = new Response(res.body, res);
      for (const [k, v] of Object.entries(NO_CACHE)) {
        patched.headers.set(k, v);
      }
      applySecurityHeaders(patched.headers);
      return patched;
    },
  },
  error(error: Error): Response {
    console.error(`[error] unhandled server error: ${error.message}`, error.stack ?? '');
    return new Response('Internal Server Error', { status: 500 });
  },
});

const memoryWatermark = createMemoryWatermark(
  parseMemoryThresholdsMb(env.ADMIN_PANEL_MEMORY_LOG_THRESHOLDS_MB),
);
const MEMORY_CHECK_INTERVAL_MS = 10_000;
setInterval(() => {
  const { rss, heapUsed } = process.memoryUsage();
  const crossedMb = memoryWatermark.check(rss);
  if (crossedMb !== null) {
    const mib = 1024 * 1024;
    console.log(
      `[mem] rss=${Math.round(rss / mib)}Mi heapUsed=${Math.round(heapUsed / mib)}Mi (crossed ${crossedMb}Mi)`,
    );
  }
}, MEMORY_CHECK_INTERVAL_MS);

console.log(`Admin panel listening on http://localhost:${server.port}${BASE_PATH}/`);

if (!process.env.ADMIN_PANEL_METRICS_SECRET) {
  console.warn(
    '[metrics] ADMIN_PANEL_METRICS_SECRET is not set — /metrics will return 401 for all requests',
  );
}
