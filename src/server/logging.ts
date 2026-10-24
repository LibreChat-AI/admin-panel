import type * as t from '@/types';
const MAX_LOGGED_PATH_LENGTH = 200;
const DEFAULT_MEMORY_THRESHOLDS_MB = [256, 384, 448];

export const FLOOD_WINDOW_MS = 10_000;
export const FLOOD_MAX_REQUESTS = 200;

/** Paths a kubelet probe is allowed to reach; anything else must stay loggable. */
const PROBE_PATHS = new Set(['/health']);

/**
 * Kubelet health probes identify themselves via User-Agent, but that header is
 * client-controlled, so the path is required too. Without it any request could
 * claim to be a probe and suppress its own arrival and completion lines.
 */
export function isProbeRequest(userAgent: string | null, pathname: string): boolean {
  if (!PROBE_PATHS.has(pathname)) return false;
  return userAgent !== null && userAgent.startsWith('kube-probe/');
}

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

export function parseMemoryThresholdsMb(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_MEMORY_THRESHOLDS_MB;
  const parsed = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (parsed.length === 0) return DEFAULT_MEMORY_THRESHOLDS_MB;
  return [...parsed].sort((a, b) => a - b);
}

const BYTES_PER_MIB = 1024 * 1024;

/**
 * Fires once per upward crossing of each threshold; a threshold re-arms when
 * RSS drops back below it, so a sawtooth pattern logs each climb without
 * repeating on every tick spent above a threshold.
 */
export function createMemoryWatermark(thresholdsMb: number[]): t.MemoryWatermark {
  let lastRssMb = 0;

  return {
    check(rssBytes: number): number | null {
      const rssMb = rssBytes / BYTES_PER_MIB;
      let crossed: number | null = null;
      for (const threshold of thresholdsMb) {
        if (lastRssMb >= threshold || rssMb < threshold) continue;
        if (crossed === null || threshold > crossed) crossed = threshold;
      }
      lastRssMb = rssMb;
      return crossed;
    },
  };
}

/**
 * Wraps a streaming body so completion is reported once the bytes are actually
 * delivered. A handler that returns a `Response` built from an upstream stream
 * resolves before transfer, so logging at that point would claim success for a
 * transfer that can still fail mid-flight.
 */
export function reportOnBodyComplete(
  res: Response,
  report: (outcome: 'ok' | 'stream-error') => void,
): Response {
  if (res.body === null) {
    report('ok');
    return res;
  }

  let reported = false;
  const reportOnce = (outcome: 'ok' | 'stream-error'): void => {
    if (reported) return;
    reported = true;
    report(outcome);
  };

  const source = res.body.getReader();
  const monitored = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await source.read();
        if (done) {
          controller.close();
          reportOnce('ok');
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
        reportOnce('stream-error');
      }
    },
    cancel(reason) {
      /** A cancel races any in-flight read, whose rejection would otherwise report a second time. */
      reportOnce('stream-error');
      return source.cancel(reason);
    },
  });

  return new Response(monitored, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
