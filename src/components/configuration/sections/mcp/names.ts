/** Characters LibreChat keeps in tool names as they are (others are replaced with `_`). */
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

const RESERVED: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** LibreChat joins tool and server names with `_mcp_`, so a server name must not contain it. */
const TOOL_DELIMITER = '_mcp_';

/**
 * Locale key of what is wrong with a new server name, or null: required,
 * no dots or leading `$` (a field path can't address a dotted name, and the
 * admin API drops or refuses `$` keys), not a reserved
 * word, letters, numbers, `-` and `_` only, not LibreChat's tool delimiter,
 * and not a name already in the list (in any letter case).
 */
export function serverNameProblem(name: string, existing: Iterable<string>): string | null {
  if (name === '') return 'com_config_server_name_required';
  if (name.includes('.') || name.startsWith('$')) return 'com_config_server_name_no_dots';
  if (RESERVED.has(name)) return 'com_config_server_name_invalid';
  if (!NAME_PATTERN.test(name)) return 'com_config_mcp_name_chars';
  if (name.includes(TOOL_DELIMITER)) return 'com_config_mcp_name_delimiter';
  const lower = name.toLowerCase();
  for (const key of existing) {
    if (key === name) return 'com_config_server_name_exists';
    if (key.toLowerCase() === lower) return 'com_config_mcp_name_case';
  }
  return null;
}

/**
 * `github-copy`, then `github-copy-2`, … : the first name not in the list in
 * any letter case (as `serverNameProblem` compares names).
 */
export function copyName(name: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((key) => key.toLowerCase()));
  const base = `${name.replace(/[^A-Za-z0-9_-]+/g, '-')}-copy`;
  const isTaken = (candidate: string) => taken.has(candidate.toLowerCase());
  if (!isTaken(base)) return base;
  let n = 2;
  while (isTaken(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
