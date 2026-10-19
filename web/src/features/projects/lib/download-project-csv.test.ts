import { describe, expect, it } from 'vitest';

import { filenameFrom } from './download-project-csv';

describe('filenameFrom', () => {
  it('reads the name the server gave, or falls back', () => {
    expect(filenameFrom('attachment; filename="leasing-q4.csv"', 'project.csv')).toBe(
      'leasing-q4.csv',
    );
    expect(filenameFrom(undefined, 'project.csv')).toBe('project.csv');
    expect(filenameFrom('attachment', 'project.csv')).toBe('project.csv');
  });
});
