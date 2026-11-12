import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const STYLES = join(__dirname, '..', 'styles.css');
const COMMENT = /\/\*[\s\S]*?\*\//g;
const RULE = /([^{}]+)\{([^{}]*)\}/g;
const SELECTOR_SEPARATOR = /,(?![^()]*\))/;
const DECLARATION = /(--[\w-]+)\s*:\s*([^;]+);/g;

/**
 * The bodies of the styles.css rules whose selector list holds `selector`,
 * wherever they sit (inside `@layer` or `@media` or not), in source order.
 * Read as written: jsdom can neither parse the Tailwind file nor keep
 * `!important` on `outline-offset`.
 */
function ruleBodies(selector: string): string[] {
  const source = readFileSync(STYLES, 'utf8').replace(COMMENT, '');
  return [...source.matchAll(RULE)].flatMap(([, selectors, body]) =>
    selectors.split(SELECTOR_SEPARATOR).some((listed) => listed.trim() === selector)
      ? [body.trim()]
      : [],
  );
}

/** The declarations of the first styles.css rule that lists `selector`. */
export function ruleBody(selector: string): string | undefined {
  return ruleBodies(selector)[0];
}

/**
 * The custom properties styles.css declares for `selector` (`:root`, `.dark`,
 * `:root[data-cui-theme]`), later rules winning.
 */
export function customProperties(selector: string): Map<string, string> {
  return new Map(
    ruleBodies(selector).flatMap((body) =>
      [...body.matchAll(DECLARATION)].map(([, name, value]) => [name, value.trim()] as const),
    ),
  );
}
