import { SystemField } from '@coretask/contracts';
import type { CustomField, ProjectFieldMetadata } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { columnLabel } from './column-labels';

const metadata = (customFields: CustomField[]): ProjectFieldMetadata => ({
  customFields,
  statuses: [],
  priorities: [],
  sections: [],
  members: [],
});

const field = (id: string, name: string) => ({ id, name }) as CustomField;

describe('columnLabel', () => {
  it('names a system column', () => {
    expect(columnLabel(SystemField.DUE_DATE, metadata([]))).toBe('Due date');
  });

  it('uses a custom field’s own name', () => {
    expect(columnLabel('custom:f-1', metadata([field('f-1', 'Risk level')]))).toBe('Risk level');
  });

  it('never puts a raw field reference in the header', () => {
    // A saved view outlives the fields it names: deleting a custom field leaves
    // its column in the stored settings, and the header used to print
    // `custom:019fd248-…` at the reader.
    const label = columnLabel('custom:019fd248-415a-7fc0-944f-09b9786ad6b9', metadata([]));

    expect(label).toBe('Deleted field');
    expect(label).not.toContain('custom:');
  });

  it('stays blank while metadata is still loading', () => {
    // Not loaded yet is not the same as deleted, and flashing "Deleted field"
    // on every page load would be worse than a moment of nothing.
    expect(columnLabel('custom:f-1', undefined)).toBe('');
  });
});
