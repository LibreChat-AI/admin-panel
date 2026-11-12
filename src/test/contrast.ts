/** sRGB channels (0–255) and alpha (0–1). */
export type Rgba = readonly [number, number, number, number];

const VAR = /^var\((--[\w-]+)\)$/;

/** Follows `var(--x)` through `scope` until it reaches a color. */
export function resolveVar(value: string, scope: ReadonlyMap<string, string>): string {
  const reference = VAR.exec(value);
  if (!reference) return value;
  const next = scope.get(reference[1]);
  if (next === undefined) throw new Error(`${reference[1]} is not declared`);
  return resolveVar(next, scope);
}

function channel(value: string): number {
  return value.endsWith('%') ? (parseFloat(value) * 255) / 100 : parseFloat(value);
}

/** `#rgb`, `#rrggbb` or `rgb()` in either syntax, with or without alpha. */
export function parseColor(value: string): Rgba {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
    const at = (i: number) => parseInt(digits.slice(i, i + 2), 16);
    return [at(0), at(2), at(4), 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!rgb) throw new Error(`not a color: ${value}`);
  const [r, g, b, a = '1'] = rgb[1].split(/[\s,/]+/).filter(Boolean);
  return [channel(r), channel(g), channel(b), a.endsWith('%') ? parseFloat(a) / 100 : +a];
}

/** `top` painted over the opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (i: number) => top[i] * top[3] + bottom[i] * (1 - top[3]);
  return [mix(0), mix(1), mix(2), 1];
}

function luminance([r, g, b]: Rgba): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The WCAG 2 contrast ratio of two opaque colors. */
export function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
