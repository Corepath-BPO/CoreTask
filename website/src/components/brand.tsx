/*
 * The CoreTask mark, from the logo pack: a cut C — the shell — round a green
 * crescent and a green core with a check in it. The shell paints in
 * `currentColor`, so on this dark site it is the logo's dark version (white and
 * green); the crescent and core keep Core Green, the logo's own colour.
 */

/** Core Green, used in the mark only — too bright for text or surfaces. */
export const LOGO_GREEN = '#00F006';

/** The mark's paths, in the logo pack's own coordinates. */
export const MARK = {
  viewBox: '9.54 9.5 89.96 148',
  shellLower: 'M99 134.02L99 154.37A70 70 0 0 1 10.04 89.5L32.06 89.5A50 50 0 0 0 99 134.02Z',
  shellUpper: 'M26.78 84.5L10.04 84.5A70 70 0 0 1 41.85 28.31A60 60 0 0 0 26.78 84.5Z',
  crescent: 'M99 11.66L99 39.98A50 50 0 0 0 32.06 84.5L26.78 84.5A60 60 0 0 1 99 11.66Z',
  core: 'M94 87A26 26 0 1 1 42 87A26 26 0 1 1 94 87ZM54.23 89.77L64.11 99.65L80.87 80.65L77.13 77.35L63.89 92.35L57.77 86.23Z',
} as const;

/** Sized by height: the mark is taller than it is wide. */
export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox={MARK.viewBox}
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path fill="currentColor" d={MARK.shellLower} />
      <path fill="currentColor" d={MARK.shellUpper} />
      <path fill={LOGO_GREEN} d={MARK.crescent} />
      <path fill={LOGO_GREEN} d={MARK.core} />
    </svg>
  );
}

/** The horizontal logo, dark version (white and green), for this dark site. */
export function Lockup({ className }: { className?: string }) {
  return (
    // A plain <img>: the export serves files as they are, and the SVG is 4 KB.
    <img
      src="/brand/coretask-logo-dark.svg"
      alt="CoreTask"
      width={384}
      height={148}
      className={className}
    />
  );
}
