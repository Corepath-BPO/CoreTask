import { COLOR_TOKENS, DEFAULT_COLOR_TOKEN } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import { resolveColor, resolveColorToken } from './color-tokens';

describe('colour tokens', () => {
  it.each(COLOR_TOKENS)('%s resolves in both modes', (token) => {
    for (const mode of ['light', 'dark'] as const) {
      const swatch = resolveColorToken(token, mode);

      expect(swatch.solid).toMatch(/^oklch\(/);
      expect(swatch.surface).toMatch(/^oklch\(/);
      expect(swatch.onSurface).toMatch(/^oklch\(/);
    }
  });

  /*
   * The failure this guards against is a token being added to the shared
   * contract and not to the tables here, which Tailwind cannot warn about
   * because these are inline values rather than classes. A missing entry would
   * silently resolve to the default, so the tell is two tokens sharing a
   * colour rather than an exception.
   *
   * Comparing against the fallback directly would not work: `gray` *is* the
   * default, and would fail a check it should pass.
   */
  it.each(['light', 'dark'] as const)('gives every token a distinct colour in %s', (mode) => {
    const solids = COLOR_TOKENS.map((token) => resolveColorToken(token, mode).solid);

    expect(new Set(solids).size).toBe(COLOR_TOKENS.length);
  });

  it('light and dark are genuinely different, not the same table twice', () => {
    const differences = COLOR_TOKENS.filter(
      (token) =>
        resolveColorToken(token, 'light').onSurface !==
        resolveColorToken(token, 'dark').onSurface,
    );

    expect(differences).toHaveLength(COLOR_TOKENS.length);
  });

  /*
   * On a dark surface, readable text goes lighter than the accent; on a light
   * one it goes darker. Getting this backwards is the usual way a "dark mode"
   * palette ends up unreadable, and it is invisible in a snapshot test.
   */
  it('text moves the right way for each mode', () => {
    const lightness = (value: string) => Number(/oklch\(([\d.]+)/.exec(value)?.[1] ?? 0);

    for (const token of COLOR_TOKENS) {
      const light = resolveColorToken(token, 'light');
      const dark = resolveColorToken(token, 'dark');

      expect(lightness(light.onSurface)).toBeLessThan(lightness(light.solid));
      expect(lightness(dark.onSurface)).toBeGreaterThan(lightness(dark.solid));
    }
  });

  describe('degrading rather than throwing', () => {
    it.each([null, undefined, '', 'chartreuse', 'bg-red-500', '#ff0000'])(
      '%s falls back to the default',
      (input) => {
        expect(resolveColorToken(input, 'light')).toEqual(
          resolveColorToken(DEFAULT_COLOR_TOKEN, 'light'),
        );
      },
    );
  });

  describe('custom colours', () => {
    it('a custom hex wins over a token', () => {
      const result = resolveColor({ colorToken: 'red', customColor: '#00ff00' }, 'light');

      expect(result.solid).toBe('#00ff00');
      expect(result.surface).toContain('#00ff00');
    });

    it('falls back to the token when no custom colour is set', () => {
      expect(resolveColor({ colorToken: 'red', customColor: null }, 'light')).toEqual(
        resolveColorToken('red', 'light'),
      );
    });
  });
});
