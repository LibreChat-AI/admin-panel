import type * as t from '@/types';

/** Leaf field paths of a schema tree (fields with children contribute their leaves). */
export function collectFieldPaths(fields: t.SchemaField[], prefix = ''): string[] {
  const paths: string[] = [];
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    if (field.children && field.children.length > 0) {
      paths.push(...collectFieldPaths(field.children, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

/** Count configured vs total leaf fields in a field tree. */
export function countConfigured(
  fields: t.SchemaField[],
  parentPath: string,
  configuredPaths?: Set<string>,
): { total: number; configured: number } {
  let total = 0;
  let configured = 0;
  for (const f of fields) {
    const p = `${parentPath}.${f.key}`;
    if (f.children?.length && !f.isArray && f.type !== 'record') {
      const sub = countConfigured(f.children, p, configuredPaths);
      total += sub.total;
      configured += sub.configured;
    } else {
      total++;
      if (configuredPaths?.has(p) || hasDescendant(p, configuredPaths)) configured++;
    }
  }
  return { total, configured };
}

/** Returns true if `paths` contains any key that is a descendant of `path`. */
export function hasDescendant(path: string, paths?: Set<string>): boolean {
  if (!paths) return false;
  const prefix = `${path}.`;
  for (const p of paths) {
    if (p.startsWith(prefix)) return true;
  }
  return false;
}

/** Include the dedicated Langfuse connection in generic configured-state UI. */
export function withLangfuseConfiguredPath(
  configuredPaths: Set<string>,
  configured: boolean,
): Set<string> {
  const paths = new Set(configuredPaths);
  if (configured) paths.add('langfuse.enabled');
  return paths;
}

/** Whether `paths` holds `path`, a descendant of it, or an ancestor of it. */
export function hasPathOverlap(path: string, paths: ReadonlySet<string>): boolean {
  if (paths.has(path)) return true;
  const prefix = `${path}.`;
  for (const p of paths) {
    if (p.startsWith(prefix) || path.startsWith(`${p}.`)) return true;
  }
  return false;
}
