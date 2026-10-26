import { describe, expect, it } from 'vitest';

import { colorForName } from './color-for-name';

describe('colorForName', () => {
  it('always deals the same colour to the same name', () => {
    expect(colorForName('Maya Alvarez')).toBe(colorForName('Maya Alvarez'));
    expect(colorForName('Demo Owner')).toBe(colorForName('Demo Owner'));
  });

  it('never deals a colour that reads as state', () => {
    const names = ['Maya', 'Jonas Weber', 'Priya Nair', 'Demo Owner', 'Jesse Farias', 'A', '', '☃'];
    for (const name of names) {
      expect(['red', 'rose', 'green', 'emerald', 'slate', 'gray']).not.toContain(
        colorForName(name),
      );
    }
  });

  it('spreads names across more than one colour', () => {
    const names = [
      'Maya Alvarez',
      'Jonas Weber',
      'Priya Nair',
      'Demo Owner',
      'Jesse Farias',
      'Ana Ortiz',
    ];
    expect(new Set(names.map(colorForName)).size).toBeGreaterThan(1);
  });
});
