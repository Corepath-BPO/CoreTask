/**
 * Bundles — Asana's Customize › Bundles.
 *
 * A bundle packages one project's workflow — its sections, fields, rules and
 * task templates — so other projects can take it in one step and stay in step
 * when it changes. Sections and fields are only ever added: a project keeps
 * its own, and nothing a bundle leaves behind takes work with it. Rules and
 * task templates are the bundle's own, written into each project tagged, and
 * replaced wholesale when the bundle is refreshed or reapplied.
 */

export const BUNDLE_NAME_MAX = 120;
export const BUNDLE_DESCRIPTION_MAX = 2_000;
export const MAX_BUNDLES_PER_WORKSPACE = 50;

/** What a bundle can carry; a bundle made without one of them leaves it out. */
export const BundlePart = {
  SECTIONS: 'SECTIONS',
  FIELDS: 'FIELDS',
  RULES: 'RULES',
  TASK_TEMPLATES: 'TASK_TEMPLATES',
} as const;
export type BundlePart = (typeof BundlePart)[keyof typeof BundlePart];
export const BUNDLE_PARTS = Object.values(BundlePart);

export const BUNDLE_PART_LABEL: Record<BundlePart, string> = {
  SECTIONS: 'Sections',
  FIELDS: 'Fields',
  RULES: 'Rules',
  TASK_TEMPLATES: 'Task templates',
};
