// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type * as t from '@/types';
import {
  watchMemory,
  createFloodGuard,
  formatLoggedPath,
  createMemoryWatermark,
  createRequestObserver,
  CLIENT_CLOSED_REQUEST,
  parseMemoryThresholdsMb,
  DEFAULT_MEMORY_THRESHOLDS_MB,
} from './logging';
import { httpRequestsTotal } from './metrics';

const MIB = 1024 * 1024;
const PANEL = 'http://panel.test';
const encoder = new TextEncoder();

let logSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  httpRequestsTotal.reset();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function loggedLines(): string[] {
  return logSpy.mock.calls.map(([line]) => String(line));
}

async function recordedCount(statusCode: string, path: string): Promise<number> {
  const { values } = await httpRequestsTotal.get();
  const match = values.find(
    ({ labels }) => labels.status_code === statusCode && labels.path === path,
  );
  return match?.value ?? 0;
}

/** A body that sends `chunks` and then either ends or stays open, as a slow SSR stream does. */
function streamOf(chunks: string[], end: boolean): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      if (end) controller.close();
    },
  });
}

function observe(
  req: Request,
  res: Response,
  options?: t.ObserveOptions,
  observer: t.ObserveRequest = createRequestObserver({ logRequests: true }),
): Promise<Response> {
  return observer(req, new URL(req.url).pathname, () => res, options);
}

describe('createRequestObserver', () => {
  it('logs the arrival at once and the completion only after the body drains, without the query string', async () => {
    const req = new Request(`${PANEL}/configuration?code=secret-exchange-code`);
    const res = await observe(req, new Response(streamOf(['<html>', '</html>'], true)));

    expect(loggedLines()).toEqual(['[req] GET /configuration']);

    expect(await res.text()).toBe('<html></html>');
    const lines = loggedLines();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^\[req\] GET \/configuration 200 \d+ms$/);
    expect(lines.join('\n')).not.toContain('secret-exchange-code');
    expect(await recordedCount('200', '/configuration')).toBe(1);
  });

  it('records 499 and closes the request at once when the client left before it was answered', async () => {
    const client = new AbortController();
    const req = new Request(`${PANEL}/_serverFn/getUsersFn`, {
      method: 'POST',
      signal: client.signal,
    });
    /** TanStack Start answers a server function whose request was aborted with 500. */
    const answered = new Response('aborted', { status: 500 });

    const res = await createRequestObserver({ logRequests: true })(
      req,
      '/_serverFn/getUsersFn',
      () => {
        client.abort();
        return answered;
      },
    );

    expect(res).toBe(answered);
    const lines = loggedLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('[req] POST /_serverFn/getUsersFn');
    expect(lines[1]).toMatch(
      new RegExp(`^\\[req\\] POST /_serverFn/getUsersFn ${CLIENT_CLOSED_REQUEST} \\d+ms$`),
    );
    expect(await recordedCount(CLIENT_CLOSED_REQUEST, 'server_function')).toBe(1);
    expect(await recordedCount('500', 'server_function')).toBe(0);
  });

  it('closes the request when the client leaves mid-stream even though nothing reads or cancels the body', async () => {
    const client = new AbortController();
    const req = new Request(`${PANEL}/users`, { signal: client.signal });
    const res = await observe(req, new Response(streamOf(['<html>'], false)));

    expect(loggedLines()).toEqual(['[req] GET /users']);

    client.abort();
    const lines = loggedLines();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^\[req\] GET \/users 200 \d+ms client-closed$/);

    await res.body?.cancel();
    expect(loggedLines()).toHaveLength(2);
    expect(await recordedCount('200', '/users')).toBe(1);
  });

  it('reports once when the client leaves while a read is pending and the body is then cancelled', async () => {
    const client = new AbortController();
    const req = new Request(`${PANEL}/grants`, { signal: client.signal });
    const res = await observe(req, new Response(streamOf(['<html>'], false)));
    const reader = res.body!.getReader();

    await reader.read();
    const pending = reader.read();
    client.abort();
    await reader.cancel('client gone');
    await pending;

    const completions = loggedLines().slice(1);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatch(/^\[req\] GET \/grants 200 \d+ms client-closed$/);
  });

  it('notes a body that fails mid-transfer', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('partial'));
        controller.error(new Error('upstream died'));
      },
    });
    const res = await observe(new Request(`${PANEL}/access`), new Response(body));

    await expect(res.text()).rejects.toThrow('upstream died');
    const completions = loggedLines().slice(1);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatch(/^\[req\] GET \/access 200 \d+ms stream-error$/);
  });

  it.each<[string, string, t.ObserveOptions | undefined]>([
    ['a HEAD request', 'HEAD', undefined],
    ['a static file', 'GET', { monitorBody: false }],
  ])(
    'leaves the body of %s unwrapped and closes the request at once',
    async (_, method, options) => {
      const original = new Response(streamOf(['body'], false));
      const res = await observe(
        new Request(`${PANEL}/assets/index.js`, { method }),
        original,
        options,
      );

      expect(res).toBe(original);
      const lines = loggedLines();
      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatch(new RegExp(`^\\[req\\] ${method} /assets/index.js 200 \\d+ms$`));
    },
  );

  it('records metrics but logs nothing when the request log is off', async () => {
    const original = new Response(streamOf(['<html>'], true));
    const res = await observe(
      new Request(`${PANEL}/`),
      original,
      undefined,
      createRequestObserver({ logRequests: false }),
    );

    expect(res).toBe(original);
    expect(loggedLines()).toEqual([]);
    expect(await recordedCount('200', '/')).toBe(1);
  });

  it('logs a truncated path for a long URL', async () => {
    const longPath = `/${'a'.repeat(300)}`;
    await observe(new Request(`${PANEL}${longPath}`), new Response(null, { status: 404 }));

    expect(loggedLines()[0]).toBe(`[req] GET ${longPath.slice(0, 200)}...(truncated)`);
  });

  it('reports how many requests the flood guard held back once the next window opens', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const observer = createRequestObserver({
      logRequests: true,
      floodGuard: createFloodGuard(1, 10_000),
    });
    const send = (): Promise<Response> =>
      observe(new Request(`${PANEL}/help`), new Response(null), undefined, observer);

    await send();
    await send();
    await send();
    expect(loggedLines()).toHaveLength(2);
    expect(await recordedCount('200', '/help')).toBe(3);

    vi.setSystemTime(1_010_000);
    await send();
    const lines = loggedLines().slice(2);
    expect(lines[0]).toBe('[req] suppressed 2 requests in prior window');
    expect(lines[1]).toBe('[req] GET /help');
    expect(lines).toHaveLength(3);
  });
});

describe('formatLoggedPath', () => {
  it('passes short paths through unchanged', () => {
    expect(formatLoggedPath('/auth/openid/callback')).toBe('/auth/openid/callback');
  });

  it('keeps a path of exactly 200 characters intact', () => {
    const exact = `/${'a'.repeat(199)}`;
    expect(formatLoggedPath(exact)).toBe(exact);
  });

  it('truncates paths beyond 200 characters', () => {
    const long = `/${'a'.repeat(500)}`;
    expect(formatLoggedPath(long)).toBe(`${long.slice(0, 200)}...(truncated)`);
  });
});

describe('createFloodGuard', () => {
  it('admits requests up to the cap within one window', () => {
    const guard = createFloodGuard(3, 10_000);
    const admitted = [1_000, 2_000, 3_000, 4_000, 5_000].map((now) => guard.admit(now).admitted);
    expect(admitted).toEqual([true, true, true, false, false]);
  });

  it('reports the suppressed count once, when the next window opens', () => {
    const guard = createFloodGuard(2, 10_000);
    [1_000, 2_000, 3_000, 4_000].forEach((now) => guard.admit(now));

    expect(guard.admit(12_000)).toEqual({ admitted: true, suppressedInPriorWindow: 2 });
    expect(guard.admit(13_000).suppressedInPriorWindow).toBe(0);
  });

  it('still reports a flood when the next request comes several windows later', () => {
    const guard = createFloodGuard(1, 10_000);
    guard.admit(0);
    guard.admit(1);

    expect(guard.admit(45_000)).toEqual({ admitted: true, suppressedInPriorWindow: 1 });
  });

  it('resets the admission budget each window', () => {
    const guard = createFloodGuard(1, 10_000);
    const admitted = [0, 1, 10_000, 10_001].map((now) => guard.admit(now).admitted);
    expect(admitted).toEqual([true, false, true, false]);
  });
});

describe('parseMemoryThresholdsMb', () => {
  it.each<[string | undefined, readonly number[]]>([
    [undefined, DEFAULT_MEMORY_THRESHOLDS_MB],
    ['', DEFAULT_MEMORY_THRESHOLDS_MB],
    ['abc,-5,0', DEFAULT_MEMORY_THRESHOLDS_MB],
    ['100,200,300', [100, 200, 300]],
    ['300, 100 ,200', [300, 100, 200]],
    ['abc,128,', [128]],
  ])('parses %j as %j', (raw, expected) => {
    expect(parseMemoryThresholdsMb(raw)).toEqual(expected);
  });
});

describe('createMemoryWatermark', () => {
  it('reports the highest threshold crossed, whatever order they are listed in', () => {
    const watermark = createMemoryWatermark([448, 256, 384]);
    expect(watermark.check(500 * MIB)).toBe(448);
  });

  it('fires once per upward crossing', () => {
    const watermark = createMemoryWatermark([256, 384, 448]);
    const crossed = [100, 260, 270, 400, 460, 470].map((mb) => watermark.check(mb * MIB));
    expect(crossed).toEqual([null, 256, null, 384, 448, null]);
  });

  it('re-arms a threshold only after memory drops back below it', () => {
    const watermark = createMemoryWatermark([256, 384]);
    const crossed = [300, 310, 260, 300, 200, 300, 390].map((mb) => watermark.check(mb * MIB));
    expect(crossed).toEqual([256, null, null, null, null, 256, 384]);
  });

  it('stays silent while memory remains below every threshold', () => {
    const watermark = createMemoryWatermark(DEFAULT_MEMORY_THRESHOLDS_MB);
    const crossed = [101, 102, 101].map((mb) => watermark.check(mb * MIB));
    expect(crossed).toEqual([null, null, null]);
  });
});

describe('watchMemory', () => {
  it('logs RSS and heap on each tick that climbs past a threshold, until stopped', () => {
    vi.useFakeTimers();
    const rssMb = [100, 300, 310, 200, 300, 400];
    const usage = vi.spyOn(process, 'memoryUsage');
    rssMb.forEach((mb) =>
      usage.mockReturnValueOnce({
        rss: mb * MIB,
        heapUsed: 50 * MIB,
        heapTotal: 80 * MIB,
        external: 0,
        arrayBuffers: 0,
      }),
    );

    const stop = watchMemory([256], 10_000);
    vi.advanceTimersByTime(50_000);
    stop();
    vi.advanceTimersByTime(10_000);

    expect(usage).toHaveBeenCalledTimes(5);
    expect(loggedLines()).toEqual([
      '[mem] rss=300Mi heapUsed=50Mi (crossed 256Mi)',
      '[mem] rss=300Mi heapUsed=50Mi (crossed 256Mi)',
    ]);
  });
});
