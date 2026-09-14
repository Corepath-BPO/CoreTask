import { CustomFieldType } from '@coretask/contracts';
import type { CustomField, ProjectFieldMetadata } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { fieldLabel, groupableFields, queryableFields, sortableFields } from './view-fields';

const custom = (overrides: Partial<CustomField>): CustomField => ({
  id: 'f-1',
  projectId: 'p-1',
  name: 'Effort',
  description: null,
  type: CustomFieldType.NUMBER,
  isRequired: false,
  notifyOnChange: false,
  isArchived: false,
  position: 1,
  settings: {},
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const metadata = (customFields: CustomField[]): ProjectFieldMetadata => ({
  customFields,
  statuses: [],
  priorities: [],
  sections: [],
  members: [],
});

describe('queryableFields', () => {
  it('offers the system fields the API compiles, then the project’s own', () => {
    const fields = queryableFields(metadata([custom({})]));

    expect(fields.find((field) => field.ref === 'assigneeId')).toMatchObject({
      kind: 'PEOPLE',
      origin: 'system',
    });
    expect(fields.find((field) => field.ref === 'custom:f-1')).toMatchObject({
      kind: 'NUMBER',
      origin: 'custom',
      label: 'Effort',
    });
  });

  it('leaves out a formula and an archived field, which no query can reach', () => {
    const fields = queryableFields(
      metadata([
        custom({ id: 'f-formula', type: CustomFieldType.FORMULA, name: 'Total' }),
        custom({ id: 'f-old', isArchived: true, name: 'Old' }),
      ]),
    );

    expect(fields.some((field) => field.ref === 'custom:f-formula')).toBe(false);
    expect(fields.some((field) => field.ref === 'custom:f-old')).toBe(false);
  });

  it('marks a rating sortable and a select groupable', () => {
    const fields = metadata([
      custom({ id: 'f-stars', type: CustomFieldType.RATING, name: 'Stars' }),
      custom({ id: 'f-sev', type: CustomFieldType.SINGLE_SELECT, name: 'Severity' }),
    ]);

    expect(sortableFields(fields).some((field) => field.ref === 'custom:f-stars')).toBe(true);
    expect(groupableFields(fields).map((field) => field.ref)).toContain('custom:f-sev');
    expect(groupableFields(fields).map((field) => field.ref)).not.toContain('custom:f-stars');
  });

  it('labels a removed custom field honestly, and a system field by its catalog name', () => {
    expect(fieldLabel('custom:gone', metadata([]))).toBe('Removed field');
    expect(fieldLabel('custom:gone', undefined)).toBe('');
    expect(fieldLabel('dueDate', undefined)).toBe('Due date');
  });
});
