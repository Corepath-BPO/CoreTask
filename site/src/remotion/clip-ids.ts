/*
 * Clip names and poster paths, kept apart from ./clips so that the page can
 * point at a poster without pulling Remotion and every clip into its first
 * bundle. Only the lazily loaded player imports ./clips.
 */

export type ClipId = 'request-to-ticket' | 'rule-run' | 'progress-rollup';

/** Where `pnpm assets` writes each clip's poster, relative to public/. */
export const posterPath = (id: ClipId) => `/media/${id}.webp`;
