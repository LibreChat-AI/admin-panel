#!/usr/bin/env bun
/**
 * Prints bun.lock's resolved packages as a GitHub dependency snapshot
 * (https://docs.github.com/en/rest/dependency-graph/dependency-submission).
 * GitHub's dependency graph reads package-lock.json, yarn.lock and
 * pnpm-lock.yaml but not bun.lock, so on its own it sees only package.json's
 * ranges: no exact versions and no transitive packages, and Dependabot raises
 * no alert for them. The Dependency Graph workflow submits this snapshot.
 *
 * Run: bun scripts/dependencies.ts > snapshot.json
 */

import { join } from 'node:path';

type DependencyMap = Record<string, string>;

interface PackageInfo {
  dependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
}

/**
 * A registry package is `[name@version, registry, info, integrity]`; a local
 * one (`name@file:…`, `name@link:…`) is `[spec, info]`.
 */
type PackageEntry = [string, string, PackageInfo, string] | [string, PackageInfo];

interface Workspace extends PackageInfo {
  name?: string;
  devDependencies?: DependencyMap;
}

export interface Lockfile {
  workspaces: Record<string, Workspace>;
  packages: Record<string, PackageEntry>;
}

type Scope = 'runtime' | 'development';

interface ResolvedDependency {
  package_url: string;
  relationship: 'direct' | 'indirect';
  scope: Scope;
  dependencies: string[];
}

export interface SnapshotContext {
  sha: string;
  ref: string;
  correlator: string;
  runId: string;
  scanned: string;
}

const MANIFEST = 'bun.lock';
const EDGE_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

/** Splits a bun.lock package key (its node_modules path) into package names: `@a/b/c` → `@a/b`, `c`. */
function keySegments(key: string): string[] {
  const parts = key.split('/');
  const segments: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    segments.push(parts[i].startsWith('@') ? `${parts[i]}/${parts[++i]}` : parts[i]);
  }
  return segments;
}

/** Resolves `name` from the package at `key` the way Node does: nearest node_modules first. */
function resolveKey(packages: Lockfile['packages'], key: string, name: string): string | undefined {
  const segments = keySegments(key);
  for (let depth = segments.length; depth >= 0; depth--) {
    const candidate = [...segments.slice(0, depth), name].join('/');
    if (packages[candidate]) return candidate;
  }
  return undefined;
}

/** `pkg:npm/%40scope/name@1.2.3` for a registry package; undefined for file, link, git and workspace specs. */
function packageUrl(spec: string): string | undefined {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return undefined;
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (!/^\d/.test(version)) return undefined;
  return `pkg:npm/${name.replace(/^@/, '%40')}@${encodeURIComponent(version)}`;
}

function packageInfo(entry: PackageEntry): PackageInfo {
  return typeof entry[1] === 'object' ? entry[1] : entry[2];
}

function edgeNames(info: PackageInfo | undefined): string[] {
  return EDGE_FIELDS.flatMap((field) => Object.keys(info?.[field] ?? {}));
}

/**
 * The bun.lock root workspace's packages as a dependency snapshot manifest:
 * every registry package once per version, `direct` when the root lists it,
 * and `runtime` when a runtime dependency reaches it (otherwise `development`).
 */
export function resolveManifest(lock: Lockfile): Record<string, ResolvedDependency> {
  const { packages } = lock;
  const root = lock.workspaces[''] ?? {};
  const runtimeRoots = edgeNames(root);
  const devRoots = Object.keys(root.devDependencies ?? {});
  const direct = new Set([...runtimeRoots, ...devRoots]);
  const scopes = new Map<string, Scope>();

  const walk = (roots: string[], scope: Scope) => {
    const queue = roots.filter((name) => packages[name] && !scopes.has(name));
    for (const name of queue) scopes.set(name, scope);
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i];
      for (const name of edgeNames(packageInfo(packages[key]))) {
        const child = resolveKey(packages, key, name);
        if (!child || scopes.has(child)) continue;
        scopes.set(child, scope);
        queue.push(child);
      }
    }
  };
  walk(runtimeRoots, 'runtime');
  walk(devRoots, 'development');

  const resolved: Record<string, ResolvedDependency> = {};
  for (const [key, entry] of Object.entries(packages)) {
    const url = packageUrl(entry[0]);
    if (!url) continue;
    const dependencies = edgeNames(packageInfo(entry))
      .map((name) => resolveKey(packages, key, name))
      .flatMap((child) => (child ? (packageUrl(packages[child][0]) ?? []) : []));
    const relationship = direct.has(key) ? 'direct' : 'indirect';
    const scope = scopes.get(key) ?? 'development';
    const seen = resolved[url];
    resolved[url] = seen
      ? {
          ...seen,
          relationship: seen.relationship === 'direct' ? 'direct' : relationship,
          scope: seen.scope === 'runtime' ? 'runtime' : scope,
          dependencies: [...new Set([...seen.dependencies, ...dependencies])],
        }
      : { package_url: url, relationship, scope, dependencies };
  }
  return resolved;
}

/** The dependency submission API's snapshot body for `lock`. */
export function toSnapshot(lock: Lockfile, context: SnapshotContext) {
  return {
    version: 0,
    sha: context.sha,
    ref: context.ref,
    job: { correlator: context.correlator, id: context.runId },
    detector: {
      name: 'librechat-admin-panel bun.lock',
      version: '1.0.0',
      url: 'https://github.com/LibreChat-AI/admin-panel/blob/main/scripts/dependencies.ts',
    },
    scanned: context.scanned,
    manifests: {
      [MANIFEST]: {
        name: MANIFEST,
        file: { source_location: MANIFEST },
        resolved: resolveManifest(lock),
      },
    },
  };
}

async function gitOutput(args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { stdout: 'pipe' });
  return (await new Response(proc.stdout).text()).trim();
}

async function main() {
  const root = join(import.meta.dir, '..');
  const lock = Bun.JSONC.parse(await Bun.file(join(root, MANIFEST)).text()) as Lockfile;
  const env = process.env;
  const snapshot = toSnapshot(lock, {
    sha: env.GITHUB_SHA ?? (await gitOutput(['rev-parse', 'HEAD'])),
    ref: env.GITHUB_REF ?? `refs/heads/${await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'])}`,
    correlator: `${env.GITHUB_WORKFLOW ?? 'local'}_${env.GITHUB_JOB ?? 'snapshot'}`,
    runId: env.GITHUB_RUN_ID ?? 'local',
    scanned: new Date().toISOString(),
  });
  const count = Object.keys(snapshot.manifests[MANIFEST].resolved).length;
  if (count === 0) throw new Error(`${MANIFEST} resolved to no registry packages`);
  console.error(`${MANIFEST}: ${count} packages`);
  console.log(JSON.stringify(snapshot));
}

if (import.meta.main) await main();
