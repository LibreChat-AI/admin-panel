import { describe, it, expect } from 'vitest';
import { isCsrfRequestAllowed } from '@tanstack/react-start';
import type { RequestServerOptions } from '@tanstack/react-start';
import type { Register } from '@tanstack/react-router';
import { csrfOptions, parseOrigins, invalidOrigins } from './csrf';

/** What the panel's server sees behind a proxy that rewrites `Host` to its upstream. */
const UPSTREAM_URL = 'http://127.0.0.1:3000/_serverFn/getSessionFn';
const PUBLIC_ORIGIN = 'http://admin.example.com:8080';

function serverFnCall(
  headers: Record<string, string>,
  handlerType: RequestServerOptions<Register, unknown>['handlerType'] = 'serverFn',
): RequestServerOptions<Register, unknown> {
  return {
    request: new Request(UPSTREAM_URL, { method: 'POST', headers }),
    pathname: new URL(UPSTREAM_URL).pathname,
    context: undefined,
    next: () => {
      throw new Error('the CSRF check never calls next');
    },
    handlerType,
  };
}

describe('parseOrigins', () => {
  it('reduces each listed URL to its origin', () => {
    expect([
      ...parseOrigins(' https://Admin.Example.com:443/admin/ ,http://10.0.0.5:8080/login'),
    ]).toEqual(['https://admin.example.com', 'http://10.0.0.5:8080']);
  });

  it('skips blank, unparseable and opaque entries', () => {
    expect(parseOrigins(undefined).size).toBe(0);
    expect(parseOrigins('').size).toBe(0);
    expect([...parseOrigins(',not a url, ,data:text/plain,hi,http://ok.test')]).toEqual([
      'http://ok.test',
    ]);
  });
});

describe('invalidOrigins', () => {
  it('names the entries that are no origin, such as a host without its scheme', () => {
    expect(
      invalidOrigins('admin.example.com:8080, http://ok.test, ,10.0.0.5:3000,localhost:3000'),
    ).toEqual(['admin.example.com:8080', '10.0.0.5:3000', 'localhost:3000']);
    expect(invalidOrigins(undefined)).toEqual([]);
    expect(invalidOrigins('https://a.test,http://b.test:8080')).toEqual([]);
  });
});

describe('csrfOptions', () => {
  it('checks server functions only', async () => {
    const { filter } = csrfOptions(new Set());
    expect(await filter?.(serverFnCall({}))).toBe(true);
    expect(await filter?.(serverFnCall({}, 'router'))).toBe(false);
  });

  it('keeps the default checks when no origin is trusted', async () => {
    const options = csrfOptions(parseOrigins(undefined));
    const allowed = (headers: Record<string, string>) =>
      isCsrfRequestAllowed(options, serverFnCall(headers));

    expect(await allowed({ 'Sec-Fetch-Site': 'same-origin', Origin: PUBLIC_ORIGIN })).toBe(true);
    expect(await allowed({ 'Sec-Fetch-Site': 'same-site' })).toBe(false);
    expect(await allowed({ Origin: 'http://127.0.0.1:3000' })).toBe(true);
    expect(await allowed({ Referer: 'http://127.0.0.1:3000/login' })).toBe(true);
    expect(await allowed({ Origin: PUBLIC_ORIGIN })).toBe(false);
    expect(await allowed({ Referer: `${PUBLIC_ORIGIN}/login` })).toBe(false);
    expect(await allowed({})).toBe(false);
  });

  it('accepts a trusted public origin the proxy rewrote away', async () => {
    const options = csrfOptions(parseOrigins(`${PUBLIC_ORIGIN}/`));
    const allowed = (headers: Record<string, string>) =>
      isCsrfRequestAllowed(options, serverFnCall(headers));

    expect(await allowed({ Origin: PUBLIC_ORIGIN })).toBe(true);
    expect(await allowed({ Referer: `${PUBLIC_ORIGIN}/configuration?tab=yaml` })).toBe(true);
    expect(await allowed({ Origin: 'http://127.0.0.1:3000' })).toBe(true);
    expect(await allowed({ Origin: 'http://admin.example.com' })).toBe(false);
    expect(await allowed({ Origin: 'https://evil.test' })).toBe(false);
    expect(await allowed({ Referer: 'https://evil.test/admin.example.com:8080' })).toBe(false);
    expect(await allowed({ 'Sec-Fetch-Site': 'cross-site', Origin: PUBLIC_ORIGIN })).toBe(false);
    expect(await allowed({})).toBe(false);
  });
});
