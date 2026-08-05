import { describe, expect, it } from 'vitest';

import { createProjectSchema, deriveProjectKey, projectFormSchema } from './project';

describe('deriveProjectKey', () => {
  it('uses initials for a multi-word name', () => {
    expect(deriveProjectKey('Customer Onboarding Flow')).toBe('COF');
    expect(deriveProjectKey('Platform Foundation')).toBe('PF');
  });

  it('uses a prefix for a single-word name', () => {
    expect(deriveProjectKey('Platform')).toBe('PLAT');
    expect(deriveProjectKey('Billing')).toBe('BILL');
  });

  it('ignores punctuation between words', () => {
    expect(deriveProjectKey('Mobile — App (v2)')).toBe('MAV');
  });

  it('never exceeds the key length limit', () => {
    expect(deriveProjectKey('A B C D E F G H I J K L').length).toBeLessThanOrEqual(8);
  });

  it('falls back for a name with no usable letters', () => {
    expect(deriveProjectKey('!!! ???')).toBe('PROJ');
    expect(deriveProjectKey('')).toBe('PROJ');
  });

  it('produces a key that starts with a letter', () => {
    expect(deriveProjectKey('2026 Roadmap')).toMatch(/^[A-Z]/);
  });
});

describe('createProjectSchema', () => {
  it('accepts a minimal project', () => {
    const result = createProjectSchema.safeParse({ name: 'Platform' });
    expect(result.success).toBe(true);
  });

  it('trims the name and rejects a blank one', () => {
    expect(createProjectSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createProjectSchema.parse({ name: '  Platform  ' }).name).toBe('Platform');
  });

  it('upper-cases a supplied key', () => {
    expect(createProjectSchema.parse({ name: 'Platform', key: 'core' }).key).toBe('CORE');
  });

  it('rejects a key that does not start with a letter', () => {
    expect(createProjectSchema.safeParse({ name: 'Platform', key: '1AB' }).success).toBe(false);
  });

  it('rejects a non-hex colour', () => {
    expect(createProjectSchema.safeParse({ name: 'Platform', color: 'blue' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: 'Platform', color: '#6366F1' }).success).toBe(
      true,
    );
  });

  it('rejects an unparseable date', () => {
    expect(createProjectSchema.safeParse({ name: 'Platform', dueDate: 'soon' }).success).toBe(
      false,
    );
  });

  it('treats an empty date string as cleared', () => {
    expect(createProjectSchema.parse({ name: 'Platform', dueDate: '' }).dueDate).toBeNull();
  });
});

describe('projectFormSchema', () => {
  const valid = {
    name: 'Platform',
    key: '',
    description: '',
    status: 'ACTIVE',
    color: '#6366F1',
    // `''` is "no team", which is what the form sends. Omitting it made every
    // case below fail on a missing key before reaching what it meant to test.
    teamId: '',
    startDate: '',
    dueDate: '',
  };

  it('accepts an empty key, meaning "derive it"', () => {
    expect(projectFormSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a due date before the start date', () => {
    const result = projectFormSchema.safeParse({
      ...valid,
      startDate: '2026-08-10',
      dueDate: '2026-08-01',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['dueDate']);
  });

  it('accepts equal start and due dates', () => {
    expect(
      projectFormSchema.safeParse({ ...valid, startDate: '2026-08-10', dueDate: '2026-08-10' })
        .success,
    ).toBe(true);
  });

  it('accepts a due date with no start date', () => {
    expect(projectFormSchema.safeParse({ ...valid, dueDate: '2026-08-01' }).success).toBe(true);
  });
});
