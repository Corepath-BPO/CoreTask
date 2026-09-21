import type { AutomationMetadata } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { collectRuleReferences, describeReferences } from './template-references';

const metadata = {
  sections: [
    { id: 'sec-in', name: 'Incoming Request' },
    { id: 'sec-todo', name: 'To do' },
  ],
  statuses: [{ id: 'st-1', name: 'In review' }],
  customFields: [{ id: 'cf-1', name: 'Risk' }],
} as unknown as Pick<AutomationMetadata, 'sections' | 'statuses' | 'customFields'>;

describe('collectRuleReferences', () => {
  it('finds what the rule names, once each, with the project’s words for it', () => {
    const references = collectRuleReferences(
      [
        { type: 'TRIGGER', configuration: { sectionId: 'sec-in' } },
        {
          type: 'CONDITION',
          configuration: { field: 'sectionId', operator: 'IS', value: 'sec-in' },
        },
        { type: 'ACTION', configuration: { sectionId: 'sec-todo' } },
        { type: 'ACTION', configuration: { statusDefinitionId: 'st-1' } },
        { type: 'ACTION', configuration: { fieldId: 'cf-1', value: 'opt-1' } },
        { type: 'CONDITION', configuration: { field: 'customField:cf-1', operator: 'IS' } },
        // Workspace-wide, so not a reference: it travels as it is.
        { type: 'ACTION', configuration: { userId: 'user-1' } },
        // An enum name is not a project row.
        { type: 'ACTION', configuration: { status: 'IN_PROGRESS' } },
      ],
      { sectionId: 'sec-in' },
      metadata,
    );

    expect(references.map((reference) => [reference.kind, reference.name])).toEqual([
      ['SECTION', 'Incoming Request'],
      ['SECTION', 'To do'],
      ['STATUS', 'In review'],
      ['CUSTOM_FIELD', 'Risk'],
    ]);
  });

  it('falls back to a plain noun when the name cannot be resolved', () => {
    const references = collectRuleReferences(
      [{ type: 'ACTION', configuration: { sectionId: 'gone' } }],
      undefined,
      metadata,
    );

    expect(references).toEqual([{ kind: 'SECTION', id: 'gone', name: 'a section' }]);
  });

  it('reads a list of sections from an “is one of”', () => {
    const references = collectRuleReferences(
      [
        {
          type: 'CONDITION',
          configuration: {
            field: 'sectionId',
            operator: 'IS_ONE_OF',
            value: ['sec-in', 'sec-todo'],
          },
        },
      ],
      undefined,
      metadata,
    );

    expect(references.map((reference) => reference.name)).toEqual(['Incoming Request', 'To do']);
  });
});

describe('describeReferences', () => {
  it('reads the names out as a sentence', () => {
    const names = (list: string[]) =>
      describeReferences(list.map((name) => ({ kind: 'SECTION', id: name, name })));

    expect(names([])).toBe('');
    expect(names(['To do'])).toBe('To do');
    expect(names(['Incoming Request', 'To do'])).toBe('Incoming Request and To do');
    expect(names(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
