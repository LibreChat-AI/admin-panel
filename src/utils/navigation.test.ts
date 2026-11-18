import { describe, it, expect } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  withBasePath,
  toSafeRedirect,
  scopeParamKey,
  parseScopeParam,
  findScopeByParam,
  formatScopeParam,
} from './navigation';

describe('withBasePath', () => {
  it('puts the base path before an in-app path and its search string', () => {
    expect(withBasePath('/grants?tab=audit', '/admin')).toBe('/admin/grants?tab=audit');
    expect(withBasePath('/', '/admin/')).toBe('/admin/');
  });

  it('leaves the path as it is without a base path', () => {
    for (const basePath of [undefined, '', '/']) {
      expect(withBasePath('/configuration', basePath)).toBe('/configuration');
    }
  });
});

describe('toSafeRedirect', () => {
  it('keeps in-app paths with their search string', () => {
    expect(toSafeRedirect('/configuration?tab=system&scope=role:USER')).toBe(
      '/configuration?tab=system&scope=role:USER',
    );
    expect(toSafeRedirect('/')).toBe('/');
  });

  it.each(['%0A', '%0D', '%09'])(
    'rejects an external redirect hidden by %s in the login query',
    (control) => {
      const search = new URLSearchParams(`redirect=/${control}/evil.example`);
      const path = toSafeRedirect(search.get('redirect') ?? undefined);
      expect(path).toBe('/');
      for (const basePath of [undefined, '', '/', '/admin', '/admin/']) {
        const target = new URL(withBasePath(path, basePath), 'https://panel.example/login');
        expect(target.origin).toBe('https://panel.example');
        expect(target.pathname).toBe(basePath?.startsWith('/admin') ? '/admin/' : '/');
      }
    },
  );

  it.each(['/a/..//evil.example', '/%2e//evil.example', '/a/..\\/evil.example', '/\n/['])(
    'rejects unsafe or malformed normalized paths: %j',
    (value) => expect(toSafeRedirect(value)).toBe('/'),
  );

  it('returns a normalized local path with its query and fragment', () => {
    const path = toSafeRedirect('/users/../configuration?tab=system&scope=group:a%2Fb#balance');
    expect(path).toBe('/configuration?tab=system&scope=group:a%2Fb#balance');
    expect(withBasePath(path, '/admin/')).toBe(
      '/admin/configuration?tab=system&scope=group:a%2Fb#balance',
    );
    expect(toSafeRedirect(path)).toBe(path);
  });

  it('falls back to / for anything that could leave the app', () => {
    for (const value of [
      undefined,
      '',
      'https://evil.example',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      'configuration',
    ]) {
      expect(toSafeRedirect(value)).toBe('/');
    }
  });
});

const scopes: t.ConfigScope[] = [
  {
    _id: '6ac389091d80b33fce8dfe8e',
    principalType: PrincipalType.ROLE,
    principalId: 'USER',
    name: 'USER',
    priority: 10,
    isActive: true,
  },
  {
    _id: '6ac38909aaaaaaaaaaaaaaaa',
    principalType: PrincipalType.GROUP,
    principalId: 'g1',
    name: 'Engineering',
    priority: 20,
    isActive: true,
  },
];

describe('scope params', () => {
  it('parses principal forms and legacy ids', () => {
    expect(parseScopeParam('role:USER')).toEqual({
      kind: 'principal',
      principalType: 'role',
      principalId: 'USER',
    });
    expect(parseScopeParam('group:a:b')).toEqual({
      kind: 'principal',
      principalType: 'group',
      principalId: 'a:b',
    });
    expect(parseScopeParam('6ac389091d80b33fce8dfe8e')).toEqual({
      kind: 'id',
      id: '6ac389091d80b33fce8dfe8e',
    });
    expect(parseScopeParam('public:x')).toEqual({ kind: 'id', id: 'public:x' });
    expect(parseScopeParam(undefined)).toBeNull();
    expect(parseScopeParam('')).toBeNull();
  });

  it('formats a profile as type:id and finds it by either form', () => {
    expect(formatScopeParam(scopes[1])).toBe('group:g1');
    expect(findScopeByParam(scopes, parseScopeParam('role:USER')!)?.name).toBe('USER');
    expect(findScopeByParam(scopes, parseScopeParam('6ac38909aaaaaaaaaaaaaaaa')!)?.name).toBe(
      'Engineering',
    );
    expect(findScopeByParam(scopes, parseScopeParam('role:ADMIN')!)).toBeUndefined();
  });

  it('compares scope params canonically', () => {
    expect(scopeParamKey('role:USER')).toBe(scopeParamKey('role:USER'));
    expect(scopeParamKey(undefined)).toBeUndefined();
    expect(scopeParamKey('role:USER')).not.toBe(scopeParamKey('role:ADMIN'));
  });
});
