import { CustomFieldType, FilterOperator } from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { choicesFor } from '../../lib/filter-choices';
import type { QueryableField } from '../../lib/view-fields';

import { FilterValueControl } from './filter-value-control';

const metadata: ProjectFieldMetadata = {
  customFields: [],
  statuses: [{ id: 'st-1', name: 'To do', category: 'TODO', colorToken: 'gray' }],
  priorities: [],
  sections: [],
  members: [
    { id: 'u-other', name: 'Ada', email: 'ada@x.dev', avatarUrl: null },
    { id: 'u-me', name: 'Me', email: 'me@x.dev', avatarUrl: null },
  ],
};

const dueDate: QueryableField = {
  ref: 'dueDate',
  label: 'Due date',
  kind: 'DATE',
  dataType: CustomFieldType.DATE,
  isSortable: true,
  isFilterable: true,
  isGroupable: false,
  origin: 'system',
};

const assignee: QueryableField = {
  ...dueDate,
  ref: 'assigneeId',
  label: 'Assignee',
  kind: 'PEOPLE',
  dataType: CustomFieldType.PEOPLE,
};

describe('FilterValueControl', () => {
  it('renders nothing for an operator that takes no value', () => {
    const { container } = renderWithProviders(
      <FilterValueControl
        field={dueDate}
        operator={FilterOperator.IS_EMPTY}
        value={undefined}
        metadata={metadata}
        meId="u-me"
        onChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('offers the relative dates as tokens, with a calendar date as the way out', () => {
    renderWithProviders(
      <FilterValueControl
        field={dueDate}
        operator={FilterOperator.LESS_THAN_OR_EQUAL}
        value="@endOfWeek"
        metadata={metadata}
        meId="u-me"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Due date value' })).toHaveTextContent(
      'the end of this week',
    );
  });

  it('commits a typed date at UTC midnight', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <FilterValueControl
        field={dueDate}
        operator={FilterOperator.BEFORE}
        value="2026-09-20T00:00:00.000Z"
        metadata={metadata}
        meId="u-me"
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText('Due date date');
    expect(input).toHaveValue('2026-09-20');
    fireEvent.change(input, { target: { value: '2026-09-21' } });
    expect(onChange).toHaveBeenCalledWith('2026-09-21T00:00:00.000Z');
  });
});

describe('choicesFor', () => {
  it('puts me first among people, and reads statuses from the project', () => {
    expect(choicesFor(assignee, metadata, 'u-me').map((choice) => choice.value)).toEqual([
      'u-me',
      'u-other',
    ]);
    expect(choicesFor(assignee, metadata, 'u-me')[0]?.label).toBe('Me (me)');

    const status: QueryableField = {
      ...dueDate,
      ref: 'status',
      label: 'Status',
      kind: 'ENUM',
      dataType: CustomFieldType.SINGLE_SELECT,
    };
    expect(choicesFor(status, metadata, 'u-me')).toEqual([
      { value: 'st-1', label: 'To do', colorToken: 'gray' },
    ]);
  });
});
