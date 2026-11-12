import perfHooks from 'node:perf_hooks';
import { Registry, register } from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectDefaultMetrics, normalizeMetricsPath } from './metrics';
import { SSO_PROVIDER_IDS } from '@/constants';
import { ssoCallbackPath } from '@/utils';

const PRECISION_ENV = 'ADMIN_PANEL_METRICS_EVENT_LOOP_PRECISION_MS';

/** Runs the real prom-client collector and returns the resolution it handed `monitorEventLoopDelay`. */
function monitoredResolution(): number | undefined {
  const monitor = vi.spyOn(perfHooks, 'monitorEventLoopDelay');
  collectDefaultMetrics(new Registry());
  const [result] = monitor.mock.results;
  if (result?.type === 'return') result.value.disable();
  return monitor.mock.calls[0]?.[0]?.resolution;
}

describe('collectDefaultMetrics', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('registers the event-loop lag metrics on the registry /metrics serves', () => {
    expect(register.getSingleMetric('nodejs_eventloop_lag_p99_seconds')).toBeDefined();
  });

  it("samples event-loop delay once a second instead of prom-client's 10 ms default", () => {
    vi.stubEnv(PRECISION_ENV, undefined);
    expect(monitoredResolution()).toBe(1000);
  });

  it(`uses ${PRECISION_ENV} when it is a positive whole number of milliseconds`, () => {
    vi.stubEnv(PRECISION_ENV, '250');
    expect(monitoredResolution()).toBe(250);
  });

  it.each([[''], ['0'], ['-5'], ['1.5'], ['abc'], ['2147483648']])(
    `falls back to 1000 ms when ${PRECISION_ENV} is %j`,
    (raw) => {
      vi.stubEnv(PRECISION_ENV, raw);
      expect(monitoredResolution()).toBe(1000);
    },
  );
});

describe('normalizeMetricsPath', () => {
  it.each([
    ['/', '/'],
    ['/login', '/login'],
    ['/configuration/', '/configuration'],
    ['/auth/openid/callback', '/auth/openid/callback'],
  ])('keeps known app route %s bounded as %s', (input, expected) => {
    expect(normalizeMetricsPath(input)).toBe(expected);
  });

  it.each(SSO_PROVIDER_IDS.map(ssoCallbackPath))(
    'keeps the SSO callback %s of every provider as its own route',
    (path) => {
      expect(normalizeMetricsPath(path)).toBe(path);
      expect(normalizeMetricsPath(`${path}/`)).toBe(path);
    },
  );

  it('buckets the callback of a provider the panel does not offer as unknown', () => {
    expect(normalizeMetricsPath('/auth/evil/callback')).toBe('unknown');
  });

  it.each([
    ['/assets/index-abc123.js'],
    ['/favicon.ico'],
    ['/manifest.json'],
    ['/clickhouse-dark.svg'],
  ])('buckets static asset %s', (input) => {
    expect(normalizeMetricsPath(input)).toBe('static_asset');
  });

  it.each([
    ['/_server'],
    ['/_server/getUsersFn'],
    ['/_serverFn/getUsersFn'],
    ['/api/_server/getUsersFn'],
  ])('buckets server function path %s', (input) => {
    expect(normalizeMetricsPath(input)).toBe('server_function');
  });

  it.each([['/wp-login.php'], ['/users/123'], ['not-a-path']])(
    'buckets unknown path %s',
    (input) => {
      expect(normalizeMetricsPath(input)).toBe('unknown');
    },
  );
});
