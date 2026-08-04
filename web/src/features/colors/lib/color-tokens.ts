import { DEFAULT_COLOR_TOKEN, isColorToken, type ColorToken } from '@coretask/contracts';

/**
 * The one place a stored colour token becomes an actual colour.
 *
 * Tailwind cannot see a class name that only exists in a database row, so
 * `bg-${token}-500` would silently produce no styles. These are explicit CSS
 * values instead, applied inline — which also means light and dark can differ
 * without every caller knowing they do.
 *
 * Each token carries three values because a colour is used three ways: a solid
 * dot, a tinted background, and text that has to stay readable on that tint.
 */
export interface ColorSwatch {
  /** Solid fill — dots, bars, node accents. */
  solid: string;
  /** Low-opacity background for badges. */
  surface: string;
  /** Text and border on top of `surface`. Contrast-checked against it. */
  onSurface: string;
}

/**
 * Built on oklch for the same reason the theme is: lightness is perceptually
 * even across hues, so one lightness figure gives every token comparable weight
 * rather than yellow shouting and indigo disappearing.
 */
const LIGHT: Record<ColorToken, ColorSwatch> = {
  slate: { solid: 'oklch(0.55 0.03 257)', surface: 'oklch(0.55 0.03 257 / 0.12)', onSurface: 'oklch(0.38 0.04 257)' },
  gray: { solid: 'oklch(0.55 0.02 286)', surface: 'oklch(0.55 0.02 286 / 0.12)', onSurface: 'oklch(0.38 0.02 286)' },
  red: { solid: 'oklch(0.58 0.22 27)', surface: 'oklch(0.58 0.22 27 / 0.12)', onSurface: 'oklch(0.44 0.19 27)' },
  orange: { solid: 'oklch(0.65 0.19 46)', surface: 'oklch(0.65 0.19 46 / 0.14)', onSurface: 'oklch(0.47 0.15 46)' },
  amber: { solid: 'oklch(0.72 0.17 71)', surface: 'oklch(0.72 0.17 71 / 0.16)', onSurface: 'oklch(0.48 0.12 71)' },
  yellow: { solid: 'oklch(0.79 0.16 89)', surface: 'oklch(0.79 0.16 89 / 0.18)', onSurface: 'oklch(0.48 0.11 89)' },
  lime: { solid: 'oklch(0.75 0.19 128)', surface: 'oklch(0.75 0.19 128 / 0.16)', onSurface: 'oklch(0.46 0.13 128)' },
  green: { solid: 'oklch(0.63 0.18 149)', surface: 'oklch(0.63 0.18 149 / 0.14)', onSurface: 'oklch(0.45 0.14 149)' },
  emerald: { solid: 'oklch(0.64 0.16 163)', surface: 'oklch(0.64 0.16 163 / 0.14)', onSurface: 'oklch(0.45 0.13 163)' },
  teal: { solid: 'oklch(0.64 0.13 182)', surface: 'oklch(0.64 0.13 182 / 0.14)', onSurface: 'oklch(0.44 0.10 182)' },
  cyan: { solid: 'oklch(0.68 0.13 213)', surface: 'oklch(0.68 0.13 213 / 0.14)', onSurface: 'oklch(0.45 0.11 213)' },
  sky: { solid: 'oklch(0.66 0.15 240)', surface: 'oklch(0.66 0.15 240 / 0.14)', onSurface: 'oklch(0.45 0.13 240)' },
  blue: { solid: 'oklch(0.58 0.21 260)', surface: 'oklch(0.58 0.21 260 / 0.13)', onSurface: 'oklch(0.45 0.19 260)' },
  indigo: { solid: 'oklch(0.53 0.23 277)', surface: 'oklch(0.53 0.23 277 / 0.13)', onSurface: 'oklch(0.42 0.20 277)' },
  violet: { solid: 'oklch(0.57 0.25 293)', surface: 'oklch(0.57 0.25 293 / 0.13)', onSurface: 'oklch(0.45 0.22 293)' },
  purple: { solid: 'oklch(0.59 0.24 306)', surface: 'oklch(0.59 0.24 306 / 0.13)', onSurface: 'oklch(0.45 0.21 306)' },
  fuchsia: { solid: 'oklch(0.62 0.26 322)', surface: 'oklch(0.62 0.26 322 / 0.13)', onSurface: 'oklch(0.46 0.22 322)' },
  pink: { solid: 'oklch(0.62 0.23 354)', surface: 'oklch(0.62 0.23 354 / 0.13)', onSurface: 'oklch(0.46 0.20 354)' },
  rose: { solid: 'oklch(0.61 0.22 16)', surface: 'oklch(0.61 0.22 16 / 0.13)', onSurface: 'oklch(0.46 0.19 16)' },
};

/**
 * Dark mode is not the light values dimmed.
 *
 * On a dark surface a tint has to be stronger to register at all, and the text
 * on it has to go *lighter* rather than darker — so `onSurface` inverts its
 * relationship to `solid` here. Reusing the light table with opacity tweaks
 * produces muddy, low-contrast badges, which is the usual way this goes wrong.
 */
const DARK: Record<ColorToken, ColorSwatch> = {
  slate: { solid: 'oklch(0.70 0.03 257)', surface: 'oklch(0.70 0.03 257 / 0.18)', onSurface: 'oklch(0.84 0.03 257)' },
  gray: { solid: 'oklch(0.71 0.02 286)', surface: 'oklch(0.71 0.02 286 / 0.18)', onSurface: 'oklch(0.85 0.02 286)' },
  red: { solid: 'oklch(0.70 0.19 25)', surface: 'oklch(0.70 0.19 25 / 0.20)', onSurface: 'oklch(0.83 0.13 25)' },
  orange: { solid: 'oklch(0.75 0.16 55)', surface: 'oklch(0.75 0.16 55 / 0.20)', onSurface: 'oklch(0.86 0.11 55)' },
  amber: { solid: 'oklch(0.80 0.15 79)', surface: 'oklch(0.80 0.15 79 / 0.20)', onSurface: 'oklch(0.89 0.10 79)' },
  yellow: { solid: 'oklch(0.85 0.15 92)', surface: 'oklch(0.85 0.15 92 / 0.20)', onSurface: 'oklch(0.92 0.10 92)' },
  lime: { solid: 'oklch(0.82 0.18 130)', surface: 'oklch(0.82 0.18 130 / 0.20)', onSurface: 'oklch(0.90 0.12 130)' },
  green: { solid: 'oklch(0.74 0.17 150)', surface: 'oklch(0.74 0.17 150 / 0.20)', onSurface: 'oklch(0.86 0.12 150)' },
  emerald: { solid: 'oklch(0.74 0.15 163)', surface: 'oklch(0.74 0.15 163 / 0.20)', onSurface: 'oklch(0.86 0.11 163)' },
  teal: { solid: 'oklch(0.74 0.12 183)', surface: 'oklch(0.74 0.12 183 / 0.20)', onSurface: 'oklch(0.86 0.09 183)' },
  cyan: { solid: 'oklch(0.78 0.12 214)', surface: 'oklch(0.78 0.12 214 / 0.20)', onSurface: 'oklch(0.88 0.09 214)' },
  sky: { solid: 'oklch(0.75 0.13 236)', surface: 'oklch(0.75 0.13 236 / 0.20)', onSurface: 'oklch(0.86 0.09 236)' },
  blue: { solid: 'oklch(0.70 0.17 258)', surface: 'oklch(0.70 0.17 258 / 0.20)', onSurface: 'oklch(0.84 0.11 258)' },
  indigo: { solid: 'oklch(0.67 0.19 277)', surface: 'oklch(0.67 0.19 277 / 0.20)', onSurface: 'oklch(0.82 0.12 277)' },
  violet: { solid: 'oklch(0.71 0.19 294)', surface: 'oklch(0.71 0.19 294 / 0.20)', onSurface: 'oklch(0.85 0.12 294)' },
  purple: { solid: 'oklch(0.72 0.19 306)', surface: 'oklch(0.72 0.19 306 / 0.20)', onSurface: 'oklch(0.85 0.12 306)' },
  fuchsia: { solid: 'oklch(0.74 0.21 323)', surface: 'oklch(0.74 0.21 323 / 0.20)', onSurface: 'oklch(0.86 0.13 323)' },
  pink: { solid: 'oklch(0.73 0.19 355)', surface: 'oklch(0.73 0.19 355 / 0.20)', onSurface: 'oklch(0.86 0.12 355)' },
  rose: { solid: 'oklch(0.72 0.18 17)', surface: 'oklch(0.72 0.18 17 / 0.20)', onSurface: 'oklch(0.85 0.12 17)' },
};

/**
 * Resolves a stored token, falling back rather than throwing.
 *
 * A token can arrive from a row written by an older or newer version of the
 * app. Rendering it grey is a far better outcome than a blank screen, so
 * anything unrecognised degrades to the default.
 */
export function resolveColorToken(
  token: string | null | undefined,
  mode: 'light' | 'dark',
): ColorSwatch {
  const table = mode === 'dark' ? DARK : LIGHT;
  return table[isColorToken(token) ? token : DEFAULT_COLOR_TOKEN];
}

/**
 * A workspace-chosen hex colour, when one is set.
 *
 * `customColor` always wins over `colorToken` — it is the more specific
 * choice — but only the solid value is known, so the tint is derived from it
 * with a colour-mix rather than guessed.
 */
export function resolveColor(
  input: { colorToken?: string | null; customColor?: string | null },
  mode: 'light' | 'dark',
): ColorSwatch {
  if (input.customColor) {
    return {
      solid: input.customColor,
      surface: `color-mix(in oklab, ${input.customColor} ${mode === 'dark' ? 20 : 13}%, transparent)`,
      onSurface: `color-mix(in oklab, ${input.customColor} ${mode === 'dark' ? 82 : 68}%, ${
        mode === 'dark' ? 'white' : 'black'
      })`,
    };
  }

  return resolveColorToken(input.colorToken, mode);
}
