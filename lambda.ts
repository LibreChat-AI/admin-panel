import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * AWS Lambda entry point for running the admin panel serverlessly. It supports
 * both event shapes a Lambda can receive from an HTTP front end:
 *
 *   - Lambda Function URL / API Gateway HTTP API (payload format 2.0)
 *   - Application Load Balancer target (`target_type = lambda`)
 *
 * The handler detects the shape from the event and replies in the matching
 * format. The same Lambda also serves the static client assets (`dist/client`,
 * bundled next to the handler as `client/`), so no CDN or S3 bucket is required
 * — the deployed zip is self-contained. Build it with `bun run build:lambda`.
 *
 * For ALB targets, enable multi-value headers on the target group so multiple
 * `Set-Cookie` headers survive.
 */

type AlbEvent = {
  requestContext: { elb: { targetGroupArn: string } };
  httpMethod: string;
  path: string;
  queryStringParameters?: Record<string, string>;
  multiValueQueryStringParameters?: Record<string, string[]>;
  headers?: Record<string, string>;
  multiValueHeaders?: Record<string, string[]>;
  body?: string;
  isBase64Encoded?: boolean;
};

type HttpEvent = {
  requestContext: { http: { method: string } };
  rawPath: string;
  rawQueryString: string;
  cookies?: string[];
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
};

type LambdaEvent = AlbEvent | HttpEvent;

type AlbResult = {
  statusCode: number;
  statusDescription: string;
  multiValueHeaders: Record<string, string[]>;
  body: string;
  isBase64Encoded: boolean;
};

type HttpResult = {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
  isBase64Encoded: boolean;
};

type Result = {
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  cookies: string[];
  body: string;
  isBase64Encoded: boolean;
};

type FetchHandler = { default: { fetch: (request: Request) => Promise<Response> } };

const { default: app } = (await import('./dist/server/server.js')) as FetchHandler;

const CLIENT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'client');
const BASE_PATH = (process.env.VITE_BASE_PATH || '').replace(/\/$/, '');
const NO_CACHE = 'no-cache, no-store, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NEVER_CACHE = new Set(['/manifest.json', '/robots.txt', '/sw.js']);

// Mirrors server.ts. Shipped report-only by default because TanStack Start's SSR
// injects an inline boot script; set ADMIN_PANEL_CSP_ENFORCE=true to enforce once
// a per-request nonce is wired up.
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
const CSP_HEADER_NAME =
  process.env.ADMIN_PANEL_CSP_ENFORCE === 'true'
    ? 'content-security-policy'
    : 'content-security-policy-report-only';

function applySecurityHeaders(headers: Record<string, string>): void {
  if (!(headers['content-type'] ?? '').toLowerCase().startsWith('text/html')) return;
  headers[CSP_HEADER_NAME] = CSP_VALUE;
  headers['x-content-type-options'] = 'nosniff';
  headers['referrer-policy'] = 'strict-origin-when-cross-origin';
  headers['x-frame-options'] = 'DENY';
  if (process.env.NODE_ENV === 'production') {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }
}

// ALB requires statusDescription to be a "<code> <reason>" line; a bare code
// (e.g. "307") makes the ALB return 502 Bad Gateway.
const REASON_PHRASES: Record<number, string> = {
  200: 'OK',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

const CONTENT_TYPES: Record<string, string> = {
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain',
  map: 'application/json',
};

function isAlb(event: LambdaEvent): event is AlbEvent {
  return 'elb' in event.requestContext;
}

function contentType(pathname: string): string {
  const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function isStaticPath(pathname: string): boolean {
  return (
    pathname.startsWith('/assets/') ||
    pathname.endsWith('.svg') ||
    pathname === '/favicon.ico' ||
    NEVER_CACHE.has(pathname)
  );
}

function isCompressible(contentType: string): boolean {
  return /javascript|css|json|html|svg|text|xml|manifest/.test(contentType);
}

// ALB Lambda targets cap the response at 1 MB (Function URLs and API Gateway
// allow ~6 MB). Gzipping compressible assets keeps large chunks (e.g. the icons
// bundle) under the cap and cuts transfer overall.
function encodeBody(
  buffer: Buffer,
  contentType: string,
  gzip: boolean,
): { body: string; contentEncoding?: string } {
  if (gzip && isCompressible(contentType) && buffer.length > 1024) {
    return { body: gzipSync(buffer).toString('base64'), contentEncoding: 'gzip' };
  }
  return { body: buffer.toString('base64') };
}

function albQueryString(event: AlbEvent): string {
  const params = new URLSearchParams();
  if (event.multiValueQueryStringParameters) {
    for (const [key, values] of Object.entries(event.multiValueQueryStringParameters)) {
      for (const value of values) params.append(key, value);
    }
  } else if (event.queryStringParameters) {
    for (const [key, value] of Object.entries(event.queryStringParameters)) params.append(key, value);
  }
  return params.toString();
}

function buildRequest(event: LambdaEvent): Request {
  const headers = new Headers();
  if (isAlb(event)) {
    if (event.multiValueHeaders) {
      for (const [name, values] of Object.entries(event.multiValueHeaders)) {
        for (const value of values) headers.append(name, value);
      }
    } else if (event.headers) {
      for (const [name, value] of Object.entries(event.headers)) headers.set(name, value);
    }
  } else {
    if (event.headers) {
      for (const [name, value] of Object.entries(event.headers)) headers.set(name, value);
    }
    if (event.cookies?.length) headers.set('cookie', event.cookies.join('; '));
  }

  const method = isAlb(event) ? event.httpMethod : event.requestContext.http.method;
  const path = isAlb(event) ? event.path : event.rawPath;
  const rawQuery = isAlb(event) ? albQueryString(event) : event.rawQueryString;

  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost';
  const proto = headers.get('x-forwarded-proto') ?? 'https';
  const url = `${proto}://${host}${path}${rawQuery ? `?${rawQuery}` : ''}`;

  const hasBody = event.body != null && method !== 'GET' && method !== 'HEAD';
  const body = hasBody
    ? event.isBase64Encoded
      ? Buffer.from(event.body as string, 'base64')
      : event.body
    : undefined;

  return new Request(url, { method, headers, body });
}

async function serveStatic(pathname: string, gzip: boolean): Promise<Result | null> {
  const filePath = join(CLIENT_DIR, pathname);
  if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR + sep)) return null;
  try {
    const data = await readFile(filePath);
    const ct = contentType(pathname);
    const cache = pathname.startsWith('/assets/') ? IMMUTABLE : NEVER_CACHE.has(pathname) ? NO_CACHE : '';
    const encoded = encodeBody(data, ct, gzip);
    const headers: Record<string, string> = { 'content-type': ct };
    if (cache) headers['cache-control'] = cache;
    if (encoded.contentEncoding) {
      headers['content-encoding'] = encoded.contentEncoding;
      headers['vary'] = 'accept-encoding';
    }
    return { status: 200, headers, cookies: [], body: encoded.body, isBase64Encoded: true };
  } catch {
    return null;
  }
}

async function toResult(response: Response, gzip: boolean): Promise<Result> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') headers[key] = value;
  });
  if (!headers['cache-control']) headers['cache-control'] = NO_CACHE;

  const cookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];

  const buffer = Buffer.from(await response.arrayBuffer());
  const ct = headers['content-type'] ?? '';
  const alreadyEncoded = 'content-encoding' in headers;
  const encoded = encodeBody(buffer, ct, gzip && !alreadyEncoded);
  if (encoded.contentEncoding) {
    headers['content-encoding'] = encoded.contentEncoding;
    headers['vary'] = headers['vary'] ? `${headers['vary']}, accept-encoding` : 'accept-encoding';
    delete headers['content-length'];
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    cookies,
    body: encoded.body,
    isBase64Encoded: true,
  };
}

async function route(path: string, request: Request, gzip: boolean): Promise<Result> {
  if (path === '/health') {
    return {
      status: 200,
      headers: { 'content-type': 'text/plain' },
      cookies: [],
      body: 'ok',
      isBase64Encoded: false,
    };
  }

  // Redirect the bare base path to its trailing-slash form, matching server.ts.
  if (BASE_PATH && path === BASE_PATH) {
    return {
      status: 302,
      headers: { location: `${BASE_PATH}/` },
      cookies: [],
      body: '',
      isBase64Encoded: false,
    };
  }

  // Assets live on disk without the base prefix; strip it (matching server.ts)
  // before the static lookup, but hand the app the original request — its router
  // is configured with the base path. When a base path is set, only serve assets
  // under it (server.ts exposes client files only at `${BASE_PATH}/…`).
  const hasBase = BASE_PATH ? path.startsWith(`${BASE_PATH}/`) : true;
  const assetPath = hasBase && BASE_PATH ? path.slice(BASE_PATH.length) : path;

  if (hasBase && isStaticPath(assetPath)) {
    const asset = await serveStatic(assetPath, gzip);
    if (asset) return asset;
  }

  return toResult(await app.fetch(request), gzip);
}

function toAlbResult(result: Result): AlbResult {
  const multiValueHeaders: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(result.headers)) multiValueHeaders[name] = [value];
  if (result.cookies.length) multiValueHeaders['set-cookie'] = result.cookies;
  return {
    statusCode: result.status,
    statusDescription: `${result.status} ${result.statusText || REASON_PHRASES[result.status] || 'OK'}`,
    multiValueHeaders,
    body: result.body,
    isBase64Encoded: result.isBase64Encoded,
  };
}

function toHttpResult(result: Result): HttpResult {
  return {
    statusCode: result.status,
    headers: result.headers,
    cookies: result.cookies.length ? result.cookies : undefined,
    body: result.body,
    isBase64Encoded: result.isBase64Encoded,
  };
}

export async function handler(event: LambdaEvent): Promise<AlbResult | HttpResult> {
  const path = isAlb(event) ? event.path : event.rawPath;
  const request = buildRequest(event);
  const gzip = (request.headers.get('accept-encoding') ?? '').includes('gzip');
  const result = await route(path, request, gzip);
  applySecurityHeaders(result.headers);
  return isAlb(event) ? toAlbResult(result) : toHttpResult(result);
}
