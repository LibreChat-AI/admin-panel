import { describe, it, expect } from 'vitest';
import {
  isProbeRequest,
  createFloodGuard,
  formatLoggedPath,
  createMemoryWatermark,
  reportOnBodyComplete,
  parseMemoryThresholdsMb,
} from './logging';

const MIB = 1024 * 1024;

describe('isProbeRequest', () => {
  it.each([
    ['kube-probe/1.29', true],
    ['kube-probe/1.31+', true],
    ['Mozilla/5.0 (Macintosh)', false],
    ['curl/8.7.1', false],
    ['', false],
    [null, false],
  ])('user-agent %s on the probe path -> %s', (userAgent, expected) => {
    expect(isProbeRequest(userAgent, '/health')).toBe(expected);
  });

  it.each(['/', '/api/config', '/admin/users'])(
    'refuses to suppress %s even for a probe user-agent',
    (pathname) => {
      expect(isProbeRequest('kube-probe/1.29', pathname)).toBe(false);
    },
  );
});

describe('formatLoggedPath', () => {
  it('passes short paths through unchanged', () => {
    expect(formatLoggedPath('/auth/openid/callback')).toBe('/auth/openid/callback');
  });

  it('truncates paths beyond 200 characters', () => {
    const long = `/${'a'.repeat(500)}`;
    const formatted = formatLoggedPath(long);
    expect(formatted).toBe(`${long.slice(0, 200)}...(truncated)`);
  });

  it('keeps a path of exactly 200 characters intact', () => {
    const exact = `/${'a'.repeat(199)}`;
    expect(formatLoggedPath(exact)).toBe(exact);
  });
});

describe('createFloodGuard', () => {
  it('admits requests up to the cap within one window', () => {
    const guard = createFloodGuard(3, 10_000);
    expect(guard.admit(1_000).admitted).toBe(true);
    expect(guard.admit(2_000).admitted).toBe(true);
    expect(guard.admit(3_000).admitted).toBe(true);
    expect(guard.admit(4_000).admitted).toBe(false);
    expect(guard.admit(5_000).admitted).toBe(false);
  });

  it('reports the suppressed count once when a new window opens', () => {
    const guard = createFloodGuard(2, 10_000);
    guard.admit(1_000);
    guard.admit(2_000);
    guard.admit(3_000);
    guard.admit(4_000);
    const next = guard.admit(12_000);
    expect(next.admitted).toBe(true);
    expect(next.suppressedInPriorWindow).toBe(2);
    expect(guard.admit(13_000).suppressedInPriorWindow).toBe(0);
  });

  it('resets the admission budget each window', () => {
    const guard = createFloodGuard(1, 10_000);
    expect(guard.admit(0).admitted).toBe(true);
    expect(guard.admit(1).admitted).toBe(false);
    expect(guard.admit(10_000).admitted).toBe(true);
    expect(guard.admit(10_001).admitted).toBe(false);
  });
});

describe('parseMemoryThresholdsMb', () => {
  it.each([
    [undefined, [256, 384, 448]],
    ['', [256, 384, 448]],
    ['100,200,300', [100, 200, 300]],
    ['300, 100, 200', [100, 200, 300]],
    ['512', [512]],
    ['abc,-5,0', [256, 384, 448]],
    ['abc,128', [128]],
  ])('parses %s -> %s', (raw, expected) => {
    expect(parseMemoryThresholdsMb(raw)).toEqual(expected);
  });
});

describe('createMemoryWatermark', () => {
  it('reports the highest crossed threshold regardless of caller ordering', () => {
    const watermark = createMemoryWatermark([448, 256, 384]);

    expect(watermark.check(500 * MIB)).toBe(448);
  });

  it('fires once per upward crossing and reports the highest threshold crossed', () => {
    const watermark = createMemoryWatermark([256, 384, 448]);
    expect(watermark.check(100 * MIB)).toBeNull();
    expect(watermark.check(260 * MIB)).toBe(256);
    expect(watermark.check(270 * MIB)).toBeNull();
    expect(watermark.check(460 * MIB)).toBe(448);
  });

  it('re-arms a threshold after memory drops back below it', () => {
    const watermark = createMemoryWatermark([256]);
    expect(watermark.check(300 * MIB)).toBe(256);
    expect(watermark.check(310 * MIB)).toBeNull();
    expect(watermark.check(200 * MIB)).toBeNull();
    expect(watermark.check(300 * MIB)).toBe(256);
  });

  it('stays silent while memory remains flat below every threshold', () => {
    const watermark = createMemoryWatermark([256, 384, 448]);
    expect(watermark.check(101 * MIB)).toBeNull();
    expect(watermark.check(102 * MIB)).toBeNull();
    expect(watermark.check(101 * MIB)).toBeNull();
  });
});

describe('reportOnBodyComplete', () => {
  it('reports immediately for a bodyless response', () => {
    const outcomes: string[] = [];
    const res = reportOnBodyComplete(new Response(null, { status: 204 }), (o) => outcomes.push(o));

    expect(outcomes).toEqual(['ok']);
    expect(res.status).toBe(204);
  });

  it('waits for the stream to drain before reporting success', async () => {
    const outcomes: string[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'));
        controller.close();
      },
    });

    const res = reportOnBodyComplete(new Response(body, { status: 200 }), (o) => outcomes.push(o));
    expect(outcomes).toEqual([]);

    await res.text();
    expect(outcomes).toEqual(['ok']);
  });

  it('reports a stream error when the upstream body fails mid-transfer', async () => {
    const outcomes: string[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'));
        controller.error(new Error('upstream died'));
      },
    });

    const res = reportOnBodyComplete(new Response(body, { status: 200 }), (o) => outcomes.push(o));
    await expect(res.text()).rejects.toThrow();
    expect(outcomes).toEqual(['stream-error']);
  });

  it('reports once when a cancel races a pending read', async () => {
    const outcomes: string[] = [];
    /** Never enqueues, so the wrapper's read is still pending when the cancel lands. */
    const body = new ReadableStream<Uint8Array>({ start() {} });

    const res = reportOnBodyComplete(new Response(body, { status: 200 }), (o) => outcomes.push(o));
    const reader = res.body!.getReader();
    const pending = reader.read();
    await reader.cancel('client gone');
    await pending.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(outcomes).toEqual(['stream-error']);
  });

  it('preserves status and headers', () => {
    const res = reportOnBodyComplete(
      new Response('csv', { status: 200, headers: { 'content-type': 'text/csv' } }),
      () => {},
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv');
  });
});
