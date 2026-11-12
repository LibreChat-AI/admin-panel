import type * as t from '@/types';
import { httpRequestsTotal, normalizeMetricsPath, httpRequestDurationSeconds } from './metrics';

/** The status recorded for a request the client abandoned before it was answered (nginx's convention). */
export const CLIENT_CLOSED_REQUEST = '499';
export const DEFAULT_MEMORY_THRESHOLDS_MB: readonly number[] = [256, 384, 448];

const FLOOD_WINDOW_MS = 10_000;
const FLOOD_MAX_REQUESTS = 200;
const MEMORY_CHECK_INTERVAL_MS = 10_000;
const MAX_LOGGED_PATH_LENGTH = 200;
const BYTES_PER_MIB = 1024 * 1024;

const OUTCOME_NOTES: Record<t.BodyOutcome, string> = {
  complete: '',
  error: ' stream-error',
  aborted: ' client-closed',
};

/** Never logs query strings (they can carry OAuth exchange codes); caps length against scanner URLs. */
export function formatLoggedPath(pathname: string): string {
  if (pathname.length <= MAX_LOGGED_PATH_LENGTH) return pathname;
  return `${pathname.slice(0, MAX_LOGGED_PATH_LENGTH)}...(truncated)`;
}

/**
 * Caps logged requests per fixed window so a request flood can't amplify into
 * a log flood; the count of suppressed requests is surfaced once when the
 * next window opens, so the flood itself stays visible.
 */
export function createFloodGuard(
  maxRequests: number = FLOOD_MAX_REQUESTS,
  windowMs: number = FLOOD_WINDOW_MS,
): t.FloodGuard {
  let windowStart = 0;
  let admittedInWindow = 0;
  let suppressedInWindow = 0;

  return {
    admit(nowMs: number): t.FloodGuardDecision {
      let suppressedInPriorWindow = 0;
      if (nowMs - windowStart >= windowMs) {
        suppressedInPriorWindow = suppressedInWindow;
        windowStart = nowMs;
        admittedInWindow = 0;
        suppressedInWindow = 0;
      }
      if (admittedInWindow < maxRequests) {
        admittedInWindow += 1;
        return { admitted: true, suppressedInPriorWindow };
      }
      suppressedInWindow += 1;
      return { admitted: false, suppressedInPriorWindow };
    },
  };
}

/** Reads `ADMIN_PANEL_MEMORY_LOG_THRESHOLDS_MB` (comma-separated MiB); the defaults apply when it lists no positive number. */
export function parseMemoryThresholdsMb(raw: string | undefined): readonly number[] {
  const thresholds = (raw ?? '').split(',').reduce<number[]>((valid, value) => {
    const mb = Number(value.trim());
    if (Number.isFinite(mb) && mb > 0) valid.push(mb);
    return valid;
  }, []);
  return thresholds.length > 0 ? thresholds : DEFAULT_MEMORY_THRESHOLDS_MB;
}

/**
 * Fires once per upward crossing of each threshold; a threshold re-arms when
 * RSS drops back below it, so a sawtooth pattern logs each climb without
 * repeating on every tick spent above a threshold.
 */
export function createMemoryWatermark(thresholdsMb: readonly number[]): t.MemoryWatermark {
  let lastRssMb = 0;

  return {
    check(rssBytes: number): number | null {
      const rssMb = rssBytes / BYTES_PER_MIB;
      const crossed = thresholdsMb.reduce<number | null>((highest, threshold) => {
        if (lastRssMb >= threshold || rssMb < threshold) return highest;
        return highest === null || threshold > highest ? threshold : highest;
      }, null);
      lastRssMb = rssMb;
      return crossed;
    },
  };
}

function toMib(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MIB);
}

/**
 * Checks RSS every 10s and logs `[mem] rss=… heapUsed=… (crossed …)` when it
 * climbs past a threshold, which timestamps an allocation burst even when no
 * request is in flight. Returns a function that stops the checks.
 */
export function watchMemory(
  thresholdsMb: readonly number[],
  intervalMs: number = MEMORY_CHECK_INTERVAL_MS,
): () => void {
  const watermark = createMemoryWatermark(thresholdsMb);
  const timer = setInterval(() => {
    const { rss, heapUsed } = process.memoryUsage();
    const crossedMb = watermark.check(rss);
    if (crossedMb === null) return;
    console.log(`[mem] rss=${toMib(rss)}Mi heapUsed=${toMib(heapUsed)}Mi (crossed ${crossedMb}Mi)`);
  }, intervalMs);
  return () => clearInterval(timer);
}

/**
 * Logs `[req] METHOD /path` before the handler runs, so a request that kills
 * the process leaves its method and path as the last log line, and returns
 * the function that writes its completion line.
 */
function logArrival(req: Request, floodGuard: t.FloodGuard): t.CompleteRequest | null {
  const { admitted, suppressedInPriorWindow } = floodGuard.admit(Date.now());
  if (suppressedInPriorWindow > 0) {
    console.log(`[req] suppressed ${suppressedInPriorWindow} requests in prior window`);
  }
  if (!admitted) return null;

  const line = `[req] ${req.method} ${formatLoggedPath(new URL(req.url).pathname)}`;
  const startedAt = performance.now();
  console.log(line);
  return (statusCode, outcome = 'complete') => {
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(`${line} ${statusCode} ${elapsedMs}ms${OUTCOME_NOTES[outcome]}`);
  };
}

/**
 * Passes the body through and reports once: when it drains, when it fails,
 * or when the client goes away. Bun neither reads nor cancels the body of a
 * request the client abandoned, so waiting on the stream alone would leave
 * that request looking like one the process died holding; the request's
 * abort signal settles it instead.
 */
function reportOnSettle(
  res: Response,
  signal: AbortSignal,
  report: (outcome: t.BodyOutcome) => void,
): Response {
  if (res.body === null) {
    report('complete');
    return res;
  }

  let settled = false;
  const settle = (outcome: t.BodyOutcome): void => {
    if (settled) return;
    settled = true;
    signal.removeEventListener('abort', onAbort);
    report(outcome);
  };
  const onAbort = (): void => settle('aborted');
  signal.addEventListener('abort', onAbort, { once: true });

  const source = res.body.getReader();
  const monitored = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await source.read();
        if (done) {
          controller.close();
          settle('complete');
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
        settle('error');
      }
    },
    cancel(reason) {
      settle('aborted');
      return source.cancel(reason);
    },
  });

  return new Response(monitored, res);
}

/**
 * Wraps route handlers so each request is recorded in the HTTP metrics and,
 * with `logRequests`, logged on arrival and once more when it is answered as
 * `[req] METHOD /path STATUS Nms`; an arrival line without a completion line
 * names a request the process died holding. Both record one status: 499 when
 * the client abandoned the request before it was answered, else the
 * response's own.
 *
 * The completion line waits for a streamed body to drain, except for an
 * abandoned request (nothing will read its body), a HEAD request (Bun sends
 * no body: it reads one chunk and cancels, which would log a misleading
 * `client-closed`), and `monitorBody: false`, which keeps a native file body
 * that Bun sends with sendfile and its own Content-Length. A wrapped body
 * hides its length from Bun, so it goes out chunked.
 */
export function createRequestObserver({
  logRequests,
  floodGuard = createFloodGuard(),
}: t.RequestObserverOptions): t.ObserveRequest {
  return async (req, pathname, getResponse, { monitorBody = true } = {}) => {
    const path = normalizeMetricsPath(pathname);
    const end = httpRequestDurationSeconds.startTimer({ method: req.method, path });
    const complete = logRequests ? logArrival(req, floodGuard) : null;
    const res = await getResponse();
    const aborted = req.signal.aborted;
    /** TanStack Start answers an aborted server function with 500; that is the client leaving, not a server error. */
    const statusCode = aborted ? CLIENT_CLOSED_REQUEST : String(res.status);
    httpRequestsTotal.inc({ method: req.method, path, status_code: statusCode });
    end({ status_code: statusCode });
    if (complete === null) return res;

    if (aborted || !monitorBody || req.method === 'HEAD') {
      complete(statusCode);
      return res;
    }
    return reportOnSettle(res, req.signal, (outcome) => complete(statusCode, outcome));
  };
}
