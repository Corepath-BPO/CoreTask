import type { ColorToken } from '@coretask/contracts';

/**
 * The tokens a person can be dealt. A subset of the palette for the same
 * reason the field picker's starting colours exclude some (see
 * `field-type-registry.ts`): red and green read as state — overdue, done —
 * and grey reads as disabled, none of which a person's initials should say.
 */
const PERSON_COLORS: readonly ColorToken[] = [
  'orange',
  'amber',
  'yellow',
  'lime',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
];

/**
 * A stable colour for a name, so one person looks the same in every row,
 * card and dialog. Hashed from the characters rather than assigned from a
 * registry, because there is no registry: the same name has to resolve to
 * the same colour on every surface, including ones that only know the name.
 */
export function colorForName(name: string): ColorToken {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }

  return PERSON_COLORS[hash % PERSON_COLORS.length] ?? 'blue';
}
