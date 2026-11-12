import { describe, expect, it } from 'vitest';
import type { Lockfile } from './dependencies';
import { resolveManifest, toSnapshot } from './dependencies';

/**
 * A root that depends on `app-lib` and `@scope/ui` and develops with `test-kit`.
 * `shared` is reached from both sides; `test-kit` nests its own `shared`; the
 * eslint plugin is a local file dependency.
 */
const LOCK: Lockfile = {
  workspaces: {
    '': {
      name: 'root',
      dependencies: { 'app-lib': '^1.0.0', '@scope/ui': '2.0.0' },
      devDependencies: { 'test-kit': '^3.0.0', 'eslint-plugin-local': 'file:tools/plugin' },
    },
  },
  packages: {
    'app-lib': ['app-lib@1.2.0', '', { dependencies: { shared: '^1.0.0' } }, 'sha512-a'],
    '@scope/ui': [
      '@scope/ui@2.0.0',
      '',
      { optionalDependencies: { 'native-bin': '1.0.0' }, peerDependencies: { 'app-lib': '*' } },
      'sha512-b',
    ],
    'native-bin': ['native-bin@1.0.0', '', {}, 'sha512-c'],
    shared: ['shared@1.4.0', '', {}, 'sha512-d'],
    'test-kit': [
      'test-kit@3.1.0',
      '',
      { dependencies: { shared: '^2.0.0', 'kit-only': '1.0.0' } },
      'sha512-e',
    ],
    'test-kit/shared': ['shared@2.0.1', '', {}, 'sha512-f'],
    'kit-only': ['kit-only@1.0.0-beta+build.5', '', {}, 'sha512-g'],
    'eslint-plugin-local': [
      'eslint-plugin-local@file:tools/plugin',
      { peerDependencies: { 'lint-core': '>=1.0.0' } },
    ],
    'lint-core': ['lint-core@1.5.0', '', {}, 'sha512-h'],
  },
};

describe('resolveManifest', () => {
  const resolved = resolveManifest(LOCK);

  it('lists each registry package once per version, skipping local file dependencies', () => {
    expect(Object.keys(resolved).sort()).toEqual([
      'pkg:npm/%40scope/ui@2.0.0',
      'pkg:npm/app-lib@1.2.0',
      'pkg:npm/kit-only@1.0.0-beta%2Bbuild.5',
      'pkg:npm/lint-core@1.5.0',
      'pkg:npm/native-bin@1.0.0',
      'pkg:npm/shared@1.4.0',
      'pkg:npm/shared@2.0.1',
      'pkg:npm/test-kit@3.1.0',
    ]);
  });

  it('marks what the root lists as direct, with its scope', () => {
    expect(resolved['pkg:npm/app-lib@1.2.0']).toMatchObject({
      relationship: 'direct',
      scope: 'runtime',
    });
    expect(resolved['pkg:npm/%40scope/ui@2.0.0']).toMatchObject({
      relationship: 'direct',
      scope: 'runtime',
    });
    expect(resolved['pkg:npm/test-kit@3.1.0']).toMatchObject({
      relationship: 'direct',
      scope: 'development',
    });
  });

  it('scopes a transitive package runtime when a runtime dependency reaches it, through optional edges too', () => {
    expect(resolved['pkg:npm/shared@1.4.0']).toMatchObject({
      relationship: 'indirect',
      scope: 'runtime',
    });
    expect(resolved['pkg:npm/native-bin@1.0.0']).toMatchObject({ scope: 'runtime' });
  });

  it('resolves a nested copy before the top-level one, as Node does', () => {
    expect(resolved['pkg:npm/test-kit@3.1.0'].dependencies.sort()).toEqual([
      'pkg:npm/kit-only@1.0.0-beta%2Bbuild.5',
      'pkg:npm/shared@2.0.1',
    ]);
    expect(resolved['pkg:npm/shared@2.0.1']).toMatchObject({
      relationship: 'indirect',
      scope: 'development',
    });
  });

  it('follows a local file dependency’s edges, so what only it reaches is scoped by it', () => {
    expect(resolved['pkg:npm/lint-core@1.5.0']).toMatchObject({
      relationship: 'indirect',
      scope: 'development',
    });
  });

  it('records peer and optional edges among a package’s dependencies', () => {
    expect(resolved['pkg:npm/%40scope/ui@2.0.0'].dependencies.sort()).toEqual([
      'pkg:npm/app-lib@1.2.0',
      'pkg:npm/native-bin@1.0.0',
    ]);
  });

  it('keeps the strongest relationship and scope when one version sits at two paths', () => {
    const lock: Lockfile = {
      workspaces: { '': { dependencies: { a: '1.0.0' }, devDependencies: { b: '1.0.0' } } },
      packages: {
        a: ['a@1.0.0', '', { dependencies: { c: '1.0.0' } }, 'sha512-a'],
        b: ['b@1.0.0', '', { dependencies: { c: '1.0.0' } }, 'sha512-b'],
        'b/c': ['c@1.0.0', '', {}, 'sha512-c'],
        c: ['c@1.0.0', '', {}, 'sha512-c'],
      },
    };
    expect(resolveManifest(lock)['pkg:npm/c@1.0.0']).toMatchObject({
      relationship: 'indirect',
      scope: 'runtime',
    });
  });
});

describe('toSnapshot', () => {
  it('wraps the manifest in the dependency submission body', () => {
    const snapshot = toSnapshot(LOCK, {
      sha: 'a'.repeat(40),
      ref: 'refs/heads/main',
      correlator: 'Dependency Graph_submit',
      runId: '42',
      scanned: '2026-11-04T00:00:00.000Z',
    });
    expect(snapshot).toMatchObject({
      version: 0,
      sha: 'a'.repeat(40),
      ref: 'refs/heads/main',
      job: { correlator: 'Dependency Graph_submit', id: '42' },
      scanned: '2026-11-04T00:00:00.000Z',
      manifests: { 'bun.lock': { name: 'bun.lock', file: { source_location: 'bun.lock' } } },
    });
    expect(Object.keys(snapshot.manifests['bun.lock'].resolved)).toHaveLength(8);
  });
});
