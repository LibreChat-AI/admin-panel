import { describe, expect, it } from 'vitest';
import { themes } from '@clickhouse/click-ui';
import { contrast, over, parseColor, resolveVar } from '@/test/contrast';
import { customProperties } from '@/test/styles';

/** A danger button (Delete, Clear dates) at rest, hovered, and focused or pressed (`active`). */
const STATES = ['default', 'hover', 'active'] as const;
/** WCAG 1.4.3 for normal text. */
const AA = 4.5;

/** The app's click-ui overrides for both themes, then for one theme only (more specific, so it wins). */
const SHARED = ':root[data-cui-theme]';

const THEMES = [
  ['light', ':root', [SHARED, ":root[data-cui-theme='light']"], themes.light],
  ['dark', '.dark', [SHARED, ":root[data-cui-theme='dark']"], themes.dark],
] as const;

describe('Danger button text contrast', () => {
  it.each(THEMES)(
    'meets AA in every state on the page and in a dialog in %s',
    (_, selector, blocks, cui) => {
      const app = customProperties(selector);
      const overrides = new Map(blocks.flatMap((block) => [...customProperties(block)]));
      const { text, background } = cui.click.button.basic.color.danger;
      const surfaces = {
        page: parseColor(resolveVar('var(--cui-color-background-default)', app)),
        dialog: parseColor(cui.click.dialog.color.background.default),
      };

      const failing = STATES.flatMap((state) => {
        const fg = parseColor(
          overrides.get(`--click-button-basic-color-danger-text-${state}`) ?? text[state],
        );
        const tint = parseColor(
          overrides.get(`--click-button-basic-color-danger-background-${state}`) ??
            background[state],
        );
        return Object.entries(surfaces).flatMap(([surface, color]) => {
          const ratio = contrast(fg, over(tint, color));
          return ratio >= AA ? [] : [`${state} on ${surface}: ${ratio.toFixed(2)}:1`];
        });
      });

      expect(failing).toEqual([]);
    },
  );
});
