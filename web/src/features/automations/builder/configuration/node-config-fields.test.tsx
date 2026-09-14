import type { AutomationMetadata } from '@coretask/types';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CanvasNode } from '../lib/graph-edits';

import { NodeConfigFields } from './node-config-fields';

const metadata = {
  triggers: [],
  actions: [],
  conditions: [],
  conditionFields: [],
  sections: [],
  projects: [],
  statuses: [],
  priorities: [],
  members: [
    { id: 'u-1', name: 'Maya Okafor', email: 'maya@example.com', avatarUrl: null },
    { id: 'u-2', name: 'Jonas Feld', email: 'jonas@example.com', avatarUrl: null },
  ],
  customFields: [],
} as AutomationMetadata;

/** The panel for a "Create subtasks" step holding these rows, and what it writes. */
function renderSubtasks(subtasks: unknown[]) {
  const onChange = vi.fn();
  const node = {
    id: 'n-1',
    type: 'ACTION',
    subtype: 'CREATE_SUBTASK',
    configuration: { subtasks },
    position: { x: 0, y: 0 },
    parentId: null,
    branchKey: null,
    order: 0,
  } as CanvasNode;

  render(<NodeConfigFields node={node} metadata={metadata} onChange={onChange} />);

  return onChange;
}

/** The list the last edit wrote. The form is controlled, so this is the test's only window. */
const written = (onChange: ReturnType<typeof vi.fn>) =>
  (onChange.mock.calls.at(-1)?.[0] as { subtasks: unknown[] }).subtasks;

describe('the subtask list', () => {
  it('shows each subtask as a line, with who it goes to and when it is due', () => {
    renderSubtasks([
      'Review the request',
      { title: 'Assign owner', assigneeId: 'u-1', dueInDays: 3 },
      { title: 'Set due date', dueDate: '2030-01-15' },
    ]);

    const list = screen.getByRole('list', { name: 'Subtasks' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Review the request' })).toBeInTheDocument();

    // A face for the person — their initials, with no picture to show.
    expect(screen.getByRole('button', { name: 'Subtask 2 assignee' })).toHaveTextContent('MO');
    expect(screen.getByRole('button', { name: 'Subtask 2 due date' })).toHaveTextContent(
      '3 days after',
    );
    expect(screen.getByRole('button', { name: 'Subtask 3 due date' })).toHaveTextContent('Jan 15');
  });

  it('edits a title in place, from its pencil', () => {
    const onChange = renderSubtasks(['Review', 'Sign off']);

    fireEvent.click(screen.getByRole('button', { name: 'Edit subtask 2' }));
    const box = screen.getByRole('textbox', { name: 'Subtask 2 title' });
    expect(box).toHaveFocus();

    fireEvent.change(box, { target: { value: 'Sign off the request' } });

    expect(written(onChange)).toEqual([{ title: 'Review' }, { title: 'Sign off the request' }]);
  });

  it('assigns a row to somebody without touching the rows around it', async () => {
    const onChange = renderSubtasks(['Review', 'Sign off']);

    await userEvent.click(screen.getByRole('button', { name: 'Subtask 2 assignee' }));
    await userEvent.click(await screen.findByRole('option', { name: /Jonas Feld/ }));

    expect(written(onChange)).toEqual([
      { title: 'Review' },
      { title: 'Sign off', assigneeId: 'u-2' },
    ]);
  });

  it('takes the assignee off a row again, leaving the rest of it', async () => {
    const onChange = renderSubtasks([{ title: 'Review', assigneeId: 'u-1', dueInDays: 2 }]);

    await userEvent.click(screen.getByRole('button', { name: 'Subtask 1 assignee' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Unassigned' }));

    // Gone rather than present-and-undefined, so the row reads as unassigned
    // wherever it is read next.
    expect(Object.keys(written(onChange)[0] as object)).toEqual(['title', 'dueInDays']);
  });

  it('dates a row a number of days after the rule runs', async () => {
    const onChange = renderSubtasks(['Review']);

    await userEvent.click(screen.getByRole('button', { name: 'Subtask 1 due date' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Days after the rule runs' }));

    expect(written(onChange)).toEqual([{ title: 'Review', dueInDays: 1 }]);
  });

  it('counts those days as whole days, none below zero', async () => {
    const onChange = renderSubtasks([{ title: 'Review', dueInDays: 1 }]);

    await userEvent.click(screen.getByRole('button', { name: 'Subtask 1 due date' }));
    const days = await screen.findByRole('spinbutton', {
      name: 'Subtask 1 days after the rule runs',
    });

    fireEvent.change(days, { target: { value: '5' } });
    expect(written(onChange)).toEqual([{ title: 'Review', dueInDays: 5 }]);

    fireEvent.change(days, { target: { value: '-2' } });
    expect(written(onChange)).toEqual([{ title: 'Review', dueInDays: 0 }]);
  });

  it('keeps a row on "a specific date" while the day is still being chosen', async () => {
    const onChange = renderSubtasks(['Review']);

    await userEvent.click(screen.getByRole('button', { name: 'Subtask 1 due date' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'A specific date' }));

    // An empty date rather than none: which key the row holds is what keeps
    // the calendar showing until a day is picked — see `dueModeOf`.
    expect(written(onChange)).toEqual([{ title: 'Review', dueDate: '' }]);
  });

  it('stores the day picked from the calendar', async () => {
    const onChange = renderSubtasks([{ title: 'Review', dueDate: '2030-01-10' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Subtask 1 due date' }));
    await userEvent.click(await screen.findByRole('button', { name: /January 15, 2030/ }));

    expect(written(onChange)).toEqual([{ title: 'Review', dueDate: '2030-01-15' }]);
  });

  it('removes a row with everything it carried', () => {
    const onChange = renderSubtasks(['Review', { title: 'Sign off', assigneeId: 'u-1' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit subtask 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove subtask 1' }));

    expect(written(onChange)).toEqual([{ title: 'Sign off', assigneeId: 'u-1' }]);
  });

  it('adds a row to type into', () => {
    const onChange = renderSubtasks(['Review']);

    fireEvent.click(screen.getByRole('button', { name: 'Add subtask' }));

    expect(written(onChange)).toEqual([{ title: 'Review' }, { title: '' }]);
  });

  it('offers variables only to say they are not here yet', async () => {
    renderSubtasks(['Review']);

    await userEvent.click(screen.getByRole('button', { name: 'Add a variable to subtask 1' }));
    const items = await screen.findAllByRole('menuitem');

    expect(items.map((item) => item.textContent)).toEqual([
      'Use AI',
      'Task',
      'People',
      'Dates',
      'Custom fields',
      'Project',
      'Section',
    ]);
    expect(items.every((item) => item.getAttribute('aria-disabled') === 'true')).toBe(true);
  });

  it('shows the options it cannot offer, and why', () => {
    renderSubtasks(['Review']);

    const collaborators = screen.getByRole('checkbox', { name: /assignees as collaborators/ });
    expect(collaborators).toBeChecked();
    expect(collaborators).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Let AI decide/ })).toBeDisabled();
  });
});

/** The panel for one action step, and what it writes. */
function renderAction(subtype: string, configuration: Record<string, unknown>) {
  const onChange = vi.fn();
  const node = {
    id: 'n-2',
    type: 'ACTION',
    subtype,
    configuration,
    position: { x: 0, y: 0 },
    parentId: null,
    branchKey: null,
    order: 0,
  } as CanvasNode;

  render(<NodeConfigFields node={node} metadata={metadata} onChange={onChange} />);

  return onChange;
}

/*
 * The due-date step had no form at all — the switch fell to "nothing to
 * configure" — so the only day count a rule could ever hold was the one a
 * starter template wrote. These forms store numbers, because the runner reads
 * `Number(config.daysFromNow)` and the validator checks the kind.
 */
describe('the day-count and minute forms', () => {
  it('shows the stored day count and writes a number back', () => {
    const onChange = renderAction('SET_DUE_DATE', { daysFromNow: 7 });

    const days = screen.getByLabelText('Days from now');
    expect(days).toHaveValue(7);

    fireEvent.change(days, { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ daysFromNow: 3 });
  });

  it('offers the start date the same form as the due date', () => {
    const onChange = renderAction('SET_START_DATE', {});

    fireEvent.change(screen.getByLabelText('Days from now'), { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith({ daysFromNow: 0 });
  });

  it('asks the estimate step for minutes, and clears the key when emptied', () => {
    const onChange = renderAction('SET_ESTIMATE', { minutes: 90 });

    const minutes = screen.getByLabelText('Minutes');
    expect(minutes).toHaveValue(90);

    fireEvent.change(minutes, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ minutes: undefined });
  });
});

describe('moving a task to another project', () => {
  const withProjects = {
    ...metadata,
    projects: [
      {
        id: 'p-2',
        name: 'Renewals',
        color: '#a855f7',
        sections: [
          { id: 's-21', name: 'Offer Sent' },
          { id: 's-22', name: 'Notify Tenant' },
        ],
      },
      { id: 'p-3', name: 'Maintenance', color: '#22c55e', sections: [] },
    ],
  } as AutomationMetadata;

  /** The panel for a "Move to another project" step, and what it writes. */
  function renderMove(configuration: Record<string, unknown>) {
    const onChange = vi.fn();
    const node = {
      id: 'n-1',
      type: 'ACTION',
      subtype: 'MOVE_TO_PROJECT',
      configuration,
      position: { x: 0, y: 0 },
      parentId: null,
      branchKey: null,
      order: 0,
    } as CanvasNode;

    render(<NodeConfigFields node={node} metadata={withProjects} onChange={onChange} />);

    return onChange;
  }

  it('asks the three questions in order, with only the move on offer', () => {
    renderMove({});

    expect(screen.getByLabelText('Choose an option')).toHaveTextContent(
      'Move task to another project',
    );
    expect(screen.getByRole('combobox', { name: 'Choose a project' })).toHaveTextContent(
      'Choose a project',
    );
    // Nothing to pick a section from until a project is chosen.
    expect(screen.getByLabelText('Choose a column/section')).toBeDisabled();
  });

  it('writes the project and clears any section chosen under the last one', async () => {
    const onChange = renderMove({ projectId: 'p-3', targetSectionId: 's-99' });

    await userEvent.click(screen.getByRole('combobox', { name: 'Choose a project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Renewals/ }));

    expect(onChange).toHaveBeenLastCalledWith({ projectId: 'p-2', targetSectionId: undefined });
  });

  it('offers the sections of the chosen project, not of this one', () => {
    renderMove({ projectId: 'p-2', targetSectionId: 's-22' });

    expect(screen.getByRole('combobox', { name: 'Choose a project' })).toHaveTextContent(
      'Renewals',
    );
    expect(screen.getByLabelText('Choose a column/section')).toHaveTextContent('Notify Tenant');
  });

  it('clears the project from the field itself', async () => {
    const onChange = renderMove({ projectId: 'p-2', targetSectionId: 's-22' });

    await userEvent.click(screen.getByRole('button', { name: 'Clear project' }));

    expect(onChange).toHaveBeenLastCalledWith({ projectId: undefined, targetSectionId: undefined });
  });
});
