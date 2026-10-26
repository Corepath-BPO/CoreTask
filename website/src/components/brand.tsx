/*
 * The CoreTask mark, from the Core logo pack (v2): a green C flowing into a T,
 * with a green check circle inside. The T's top bar blends from Core Green
 * into the ink colour — navy on light backgrounds, white on dark — so here the
 * blend ends in `currentColor`, which on this dark site makes it the logo's
 * dark version.
 */

/** Core Green: the C and the start of the T. For the mark, not for text. */
export const LOGO_GREEN = '#71CD2C';
/** Check Green: the circle behind the check. */
export const CHECK_GREEN = '#31A736';

/** The mark's paths, in the logo pack's own coordinates. */
export const MARK = {
  viewBox: '77 110.5 273.5 192',
  /** Width ÷ height. */
  aspect: 273.5 / 192,
  /** Where the T's blend runs, as a userSpaceOnUse gradient. */
  blend: { x1: 180, x2: 266 },
  c: 'M172 111L190 111L190 148L172 148A57.5 57.5 0 0 0 172 263L227.11 263A9 9 0 0 1 236 271.89L236 291.11A9 9 0 0 1 227.11 300L172 300A94.5 94.5 0 0 1 172 111Z',
  t: 'M265 148L172 148L172 111L343.09 111A7 7 0 0 1 350 117.91L350 141.09A7 7 0 0 1 343.09 148L300 148L300 295.09A7 7 0 0 1 293.09 302L271.91 302A7 7 0 0 1 265 295.09L265 148Z',
  circle:
    'M241.5 206A45 45 0 1 1 151.5 206A45 45 0 1 1 241.5 206ZM186.68 225.46A5.5 5.5 0 0 0 194.46 225.32L221.59 196.17A5.5 5.5 0 0 0 213.54 188.68L190.36 213.58L180.32 203.54A5.5 5.5 0 0 0 172.54 211.32L186.68 225.46Z',
  check:
    'M172.54 211.32A5.5 5.5 0 0 1 180.32 203.54L190.36 213.58L213.54 188.68A5.5 5.5 0 0 1 221.59 196.17L194.46 225.32A5.5 5.5 0 0 1 186.68 225.46L172.54 211.32Z',
  /** The check circle's centre, for animating it about itself. */
  circleCentre: [196.5, 206] as const,
} as const;

/**
 * Sized by height; the mark is about 1.4 times as wide as it is tall. `id`
 * names the T's gradient and must be unique on the page.
 */
export function Mark({ id, className, title }: { id: string; className?: string; title?: string }) {
  const gradient = `mark-blend-${id}`;
  return (
    <svg
      viewBox={MARK.viewBox}
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient
          id={gradient}
          gradientUnits="userSpaceOnUse"
          x1={MARK.blend.x1}
          x2={MARK.blend.x2}
          y1="0"
          y2="0"
        >
          <stop offset="0" stopColor={LOGO_GREEN} />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <path fill={LOGO_GREEN} d={MARK.c} />
      <path fill={`url(#${gradient})`} d={MARK.t} />
      <path fill={CHECK_GREEN} d={MARK.circle} />
      <path fill="#FFFFFF" d={MARK.check} />
    </svg>
  );
}

/** The horizontal logo, dark version (white and green), for this dark site. */
export function Lockup({ className }: { className?: string }) {
  return (
    // A plain <img>: the export serves files as they are, and the SVG is small.
    <img
      src="/brand/coretask-logo-dark.svg"
      alt="CoreTask"
      width={601}
      height={192}
      className={className}
    />
  );
}
