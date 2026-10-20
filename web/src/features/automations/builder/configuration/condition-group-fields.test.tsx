import { MAX_CONDITION_GROUP_DEPTH } from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConditionStepFields } from './condition-group-fields';

const metadata = {
  triggers: [],
  actions: [],
  conditions: [
    { subtype: 'status', label: 'Status', available: true, valueType: 'SINGLE_SELECT' },
    { subtype: 'priority', label: 'Priority', available: true, valueType: 'SINGLE_SELECT' },
    { subtype: 'ai.check', label: 'Check with AI', available: true },
    { subtype: 'TICKET_STATUS', label: 'Ticket status', available: true, subjects: ['TICKET'] },
  ],
  conditionFields: [
    {
      field: 'status',
      label: 'Status',
      valueKind: 'ENUM',
      options: [{ value: 'DONE', label: 'Done' }],
    },
    {
      field: 'priority',
      label: 'Priority',
      valueKind: 'ENUM',
      options: [{ value: 'HIGH', label: 'High' }],
    },
  ],
  sections: [],
  projects: [],
  statuses: [],
  priorities: [],
  members: [],
  customFields: [],
  webhookEndpoints: [],
} as unknown as AutomationMetadata;

const status = { field: 'status', operator: 'IS', value: 'DONE' };
const priority = { field: 'priority', operator: 'IS', value: 'HIGH' };

function renderStep(configuration: Record<string, unknown>) {
  const onChange = vi.fn();
  render(
    <ConditionStepFields
      configuration={configuration}
      metadata={metadata}
      subject="TASK"
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('a condition step', () => {
  it('turns one comparison into a group when a second is asked for', async () => {
    const onChange = renderStep(status);

    await userEvent.click(screen.getByRole('button', { name: 'Add another condition' }));

    expect(onChange).toHaveBeenCalledWith({ match: 'ALL', conditions: [status, {}] });
  });

  it('lists a group’s comparisons with the word its mode means between them', () => {
    renderStep({ match: 'ANY', conditions: [status, priority] });

    const group = screen.getByRole('group', { name: 'Conditions' });
    expect(within(group).getByText('or')).toBeInTheDocument();
    expect(screen.getByLabelText('Condition 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Condition 2')).toBeInTheDocument();
  });

  it('becomes one comparison again when the group is down to one', async () => {
    const onChange = renderStep({ match: 'ALL', conditions: [status, priority] });

    await userEvent.click(screen.getByRole('button', { name: 'Remove condition 2' }));

    expect(onChange).toHaveBeenCalledWith(status);
  });

  it('adds a group inside the group, asking the other way round', async () => {
    const onChange = renderStep({ match: 'ALL', conditions: [status, priority] });

    await userEvent.click(screen.getByRole('button', { name: 'Add group' }));

    expect(onChange).toHaveBeenCalledWith({
      match: 'ALL',
      conditions: [status, priority, { match: 'ANY', conditions: [{}] }],
    });
  });

  it('stops offering groups at the deepest level allowed', () => {
    let group: Record<string, unknown> = { match: 'ALL', conditions: [status] };
    for (let level = 1; level < MAX_CONDITION_GROUP_DEPTH; level += 1) {
      group = { match: 'ALL', conditions: [status, group] };
    }
    renderStep(group);

    expect(screen.getAllByRole('button', { name: 'Add group' })).toHaveLength(
      MAX_CONDITION_GROUP_DEPTH - 1,
    );
  });

  it('takes a nested group out as a whole', async () => {
    const onChange = renderStep({
      match: 'ALL',
      conditions: [status, priority, { match: 'ANY', conditions: [status] }],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remove this group' }));

    expect(onChange).toHaveBeenCalledWith({ match: 'ALL', conditions: [status, priority] });
  });

  it('asks which field a new comparison is about before how to compare it', () => {
    renderStep({ match: 'ALL', conditions: [status, {}] });

    expect(screen.getByLabelText('Condition 2')).toHaveTextContent('Choose what to check');
    // One comparison form, for the entry that has a field.
    expect(screen.getAllByText('Choose an option')).toHaveLength(1);
  });
});
