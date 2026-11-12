import { describe, expect, it } from 'vitest';
import { themes } from '@clickhouse/click-ui';
import { contrast, over, parseColor, resolveVar } from '@/test/contrast';
import { customProperties } from '@/test/styles';

/** The Badge states the panel renders: Active and Granted are `success`, Paused and Revoked `danger`. */
const STATES = ['default', 'success', 'danger', 'warning', 'neutral'] as const;
/** What a badge sits on: a table row, and the same row hovered or keyboard-focused. */
const SURFACES = ['--cui-color-background-panel', '--cui-color-background-hover'] as const;
/** WCAG 1.4.3 for normal text; badges set theirs at 10px. */
const AA = 4.5;

/** The app's click-ui overrides for both themes, then for dark only (more specific, so it wins). */
const SHARED = ':root[data-cui-theme]';
const DARK = ":root[data-cui-theme='dark']";

const THEMES = [
  ['light', ':root', [SHARED], themes.light],
  ['dark', '.dark', [SHARED, DARK], themes.dark],
] as const;

describe('Badge text contrast', () => {
  it.each(THEMES)('meets AA for every state on every surface in %s', (_, selector, blocks, cui) => {
    const app = customProperties(selector);
    const overrides = new Map(blocks.flatMap((block) => [...customProperties(block)]));
    const { text, background } = cui.click.badge.opaque.color;

    const failing = STATES.flatMap((state) => {
      const token = overrides.get(`--click-badge-opaque-color-text-${state}`) ?? text[state];
      const fg = parseColor(resolveVar(token, app));
      return SURFACES.flatMap((surface) => {
        const bg = over(
          parseColor(background[state]),
          parseColor(resolveVar(`var(${surface})`, app)),
        );
        const ratio = contrast(fg, bg);
        return ratio >= AA ? [] : [`${state} on ${surface}: ${ratio.toFixed(2)}:1`];
      });
    });

    expect(failing).toEqual([]);
  });
});
