import { describe, expect, it } from 'vitest';
import { planChunkedCookie, readChunkedCookie } from './cookies';

const jar =
  (cookies: Record<string, string>) =>
  (name: string): string | undefined =>
    cookies[name];

describe('readChunkedCookie', () => {
  it('returns a cookie written whole', () => {
    expect(readChunkedCookie('s', jar({ s: 'sealed' }))).toBe('sealed');
  });

  it('joins the chunks a marker announces, in order', () => {
    const cookies = jar({ s: '__chunked__3', 's.1': 'ab', 's.2': 'cd', 's.3': 'e' });
    expect(readChunkedCookie('s', cookies)).toBe('abcde');
  });

  it('reads nothing when a chunk is missing', () => {
    expect(readChunkedCookie('s', jar({ s: '__chunked__2', 's.1': 'ab' }))).toBeUndefined();
  });

  it('reads nothing for a marker with no, zero or too many chunks', () => {
    expect(readChunkedCookie('s', jar({ s: '__chunked__' }))).toBeUndefined();
    expect(readChunkedCookie('s', jar({ s: '__chunked__0' }))).toBeUndefined();
    expect(readChunkedCookie('s', jar({ s: '__chunked__101' }))).toBeUndefined();
  });

  it('reads nothing when the cookie is absent', () => {
    expect(readChunkedCookie('s', jar({}))).toBeUndefined();
  });
});

describe('planChunkedCookie', () => {
  it('writes a value up to 4000 characters whole', () => {
    const value = 'v'.repeat(4000);
    expect(planChunkedCookie('s', value, undefined)).toEqual([{ name: 's', value, remove: false }]);
  });

  it('splits a longer value into 4000-character chunks behind a marker', () => {
    const value = `${'a'.repeat(4000)}${'b'.repeat(4000)}c`;
    expect(planChunkedCookie('s', value, 'sealed')).toEqual([
      { name: 's', value: '__chunked__3', remove: false },
      { name: 's.1', value: 'a'.repeat(4000), remove: false },
      { name: 's.2', value: 'b'.repeat(4000), remove: false },
      { name: 's.3', value: 'c', remove: false },
    ]);
  });

  it('expires every chunk when a chunked value fits one cookie again', () => {
    expect(planChunkedCookie('s', 'short', '__chunked__2')).toEqual([
      { name: 's.1', value: '', remove: true },
      { name: 's.2', value: '', remove: true },
      { name: 's', value: 'short', remove: false },
    ]);
  });

  it('expires only the chunks a shorter chunked value no longer fills', () => {
    const plan = planChunkedCookie('s', 'x'.repeat(8000), '__chunked__4');
    expect(plan.filter((write) => write.remove).map((write) => write.name)).toEqual(['s.3', 's.4']);
    expect(plan.filter((write) => !write.remove).map((write) => write.name)).toEqual([
      's',
      's.1',
      's.2',
    ]);
  });
});
