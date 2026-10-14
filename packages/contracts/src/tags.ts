import { COLOR_TOKENS, type ColorToken } from './colors.js';

/**
 * Tags — Asana's: workspace-wide labels any task can carry, in any project.
 *
 * A tag is a name and a colour token. Names are unique in a workspace whatever
 * their case, so "Urgent" and "urgent" are one tag; typing a new name where a
 * tag is picked creates it.
 */

export const TAG_NAME_MAX = 60;
export const MAX_TAGS_PER_TASK = 20;
export const MAX_TAGS_PER_WORKSPACE = 500;

/** The colours a new tag is given in turn, so neighbours tend to differ. */
export const TAG_COLOR_CYCLE: readonly ColorToken[] = [
  'blue',
  'green',
  'orange',
  'purple',
  'teal',
  'pink',
  'amber',
  'indigo',
  'red',
  'cyan',
];

/** The key a name is unique on: trimmed, single-spaced, lowercase. */
export function tagNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isTagColor(value: unknown): value is ColorToken {
  return typeof value === 'string' && (COLOR_TOKENS as readonly string[]).includes(value);
}
