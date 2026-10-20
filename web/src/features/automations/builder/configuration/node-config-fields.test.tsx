import type { AutomationMetadata } from '@coretask/types';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

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
  webhookEndpoints: [
    { id: 'wh-1', name: 'n8n', host: 'n8n.example.com', enabled: true },
    { id: 'wh-2', name: 'Paused hook', host: 'old.example.com', enabled: false },
  ],
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
    const user = setupUser();
    const onChange = renderSubtasks(['Review', 'Sign off']);

    await user.click(screen.getByRole('button', { name: 'Subtask 2 assignee' }));
    await user.click(await screen.findByRole('option', { name: /Jonas Feld/ }));

    expect(written(onChange)).toEqual([
      { title: 'Review' },
      { title: 'Sign off', assigneeId: 'u-2' },
    ]);
  });

  it('takes the assignee off a row again, leaving the rest of it', async () => {
    const user = setupUser();
    const onChange = renderSubtasks([{ title: 'Review', assigneeId: 'u-1', dueInDays: 2 }]);

    await user.click(screen.getByRole('button', { name: 'Subtask 1 assignee' }));
    await user.click(await screen.findByRole('option', { name: 'Unassigned' }));

    // Gone rather than present-and-undefined, so the row reads as unassigned
    // wherever it is read next.
    expect(Object.keys(written(onChange)[0] as object)).toEqual(['title', 'dueInDays']);
  });

  it('dates a row a number of days after the rule runs', async () => {
    const user = setupUser();
    const onChange = renderSubtasks(['Review']);

    await user.click(screen.getByRole('button', { name: 'Subtask 1 due date' }));
    await user.click(await screen.findByRole('radio', { name: 'Days after the rule runs' }));

    expect(written(onChange)).toEqual([{ title: 'Review', dueInDays: 1 }]);
  });

  it('counts those days as whole days, none below zero', async () => {
    const user = setupUser();
    const onChange = renderSubtasks([{ title: 'Review', dueInDays: 1 }]);

    await user.click(screen.getByRole('button', { name: 'Subtask 1 due date' }));
    const days = await screen.findByRole('spinbutton', {
      name: 'Subtask 1 days after the rule runs',
    });

    fireEvent.change(days, { target: { value: '5' } });
    expect(written(onChange)).toEqual([{ title: 'Review', dueInDays: 5 }]);

    fireEvent.change(days, { target: { value: '-2' } });
    expect(written(onChange)).toEqual([{ title: 'Review', dueInDays: 0 }]);
  });

  it('keeps a row on "a specific date" while the day is still being chosen', async () => {
    const user = setupUser();
    const onChange = renderSubtasks(['Review']);

    await user.click(screen.getByRole('button', { name: 'Subtask 1 due date' }));
    await user.click(await screen.findByRole('radio', { name: 'A specific date' }));

    // An empty date rather than none: which key the row holds is what keeps
    // the calendar showing until a day is picked — see `dueModeOf`.
    expect(written(onChange)).toEqual([{ title: 'Review', dueDate: '' }]);
  });

  it('stores the day picked from the calendar', async () => {
    const user = setupUser();
    const onChange = renderSubtasks([{ title: 'Review', dueDate: '2030-01-10' }]);

    await user.click(screen.getByRole('button', { name: 'Subtask 1 due date' }));
    await user.click(await screen.findByRole('button', { name: /January 15, 2030/ }));

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

  it('adds a variable to the end of a title', async () => {
    const user = setupUser();
    const onChange = renderSubtasks(['Inspect']);

    await user.click(screen.getByRole('button', { name: 'Add a variable to subtask 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Task name' }));

    expect(written(onChange)[0]).toMatchObject({ title: 'Inspect {{task.name}}' });
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

  it('asks the three questions in order, starting on a move', () => {
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
    const user = setupUser();
    const onChange = renderMove({ projectId: 'p-3', targetSectionId: 's-99' });

    await user.click(screen.getByRole('combobox', { name: 'Choose a project' }));
    await user.click(await screen.findByRole('option', { name: /Renewals/ }));

    expect(onChange).toHaveBeenLastCalledWith({ projectId: 'p-2', targetSectionId: undefined });
  });

  it('offers the sections of the chosen project, not of this one', () => {
    renderMove({ projectId: 'p-2', targetSectionId: 's-22' });

    expect(screen.getByRole('combobox', { name: 'Choose a project' })).toHaveTextContent(
      'Renewals',
    );
    expect(screen.getByLabelText('Choose a column/section')).toHaveTextContent('Notify Tenant');
  });

  it('switches between moving the task and adding it there too', async () => {
    const user = setupUser();
    const onChange = renderMove({ projectId: 'p-2' });

    await user.click(screen.getByLabelText('Choose an option'));
    await user.click(await screen.findByRole('option', { name: /Add task to another project/ }));
    expect(onChange).toHaveBeenLastCalledWith({ projectId: 'p-2', mode: 'ADD' });
  });

  it('drops the add back to a move', async () => {
    const user = setupUser();
    const onChange = renderMove({ projectId: 'p-2', mode: 'ADD' });

    expect(screen.getByLabelText('Choose an option')).toHaveTextContent(
      'Add task to another project',
    );
    await user.click(screen.getByLabelText('Choose an option'));
    await user.click(await screen.findByRole('option', { name: /Move task to another project/ }));
    expect(onChange).toHaveBeenLastCalledWith({ projectId: 'p-2' });
  });

  it('clears the project from the field itself', async () => {
    const user = setupUser();
    const onChange = renderMove({ projectId: 'p-2', targetSectionId: 's-22' });

    await user.click(screen.getByRole('button', { name: 'Clear project' }));

    expect(onChange).toHaveBeenLastCalledWith({ projectId: undefined, targetSectionId: undefined });
  });
});

describe('sending a webhook', () => {
  it('offers the workspace endpoints and an ad-hoc URL, greying a disabled endpoint', async () => {
    const user = setupUser();
    renderAction('SEND_WEBHOOK', {});

    await user.click(screen.getByRole('combobox', { name: 'Send to' }));
    expect(await screen.findByRole('option', { name: /n8n/ })).toBeEnabled();
    expect(screen.getByRole('option', { name: /Paused hook/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: /A URL I enter/ })).toBeInTheDocument();
  });

  it('writes the endpoint and clears any URL, so a step never names both', async () => {
    const user = setupUser();
    const onChange = renderAction('SEND_WEBHOOK', { url: 'https://old.example.com/hook' });

    await user.click(screen.getByRole('combobox', { name: 'Send to' }));
    await user.click(await screen.findByRole('option', { name: /n8n/ }));

    expect(onChange).toHaveBeenLastCalledWith({ endpointId: 'wh-1', url: '' });
  });

  it('shows the URL field for an ad-hoc address and flags a bad one without losing it', async () => {
    const user = setupUser();
    const onChange = renderAction('SEND_WEBHOOK', { url: 'not a url' });

    const input = screen.getByRole('textbox', { name: 'URL' });
    expect(input).toHaveValue('not a url');
    expect(screen.getByText(/enter a full url/i)).toBeInTheDocument();

    // The harness never feeds the change back, so the controlled input keeps
    // its value and a keystroke lands on the end of it.
    await user.type(input, 'h');
    expect(onChange).toHaveBeenLastCalledWith({ endpointId: '', url: 'not a urlh' });
  });

  it('edits extra fields as rows and stores them as such', async () => {
    const user = setupUser();
    const onChange = renderAction('SEND_WEBHOOK', {
      endpointId: 'wh-1',
      extraFields: [{ key: 'flow', value: 'renewals' }],
    });

    expect(screen.getByRole('textbox', { name: 'Field 1 name' })).toHaveValue('flow');

    await user.click(screen.getByRole('button', { name: 'Add field' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        extraFields: [
          { key: 'flow', value: 'renewals' },
          { key: '', value: '' },
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Remove field 1' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ extraFields: [] }));
  });
});

describe('sending an email', () => {
  function renderEmail(configuration: Record<string, unknown>) {
    const onChange = vi.fn();
    const node = {
      id: 'n-1',
      type: 'ACTION',
      subtype: 'SEND_EMAIL',
      configuration,
      position: { x: 0, y: 0 },
      parentId: null,
      branchKey: null,
      order: 0,
    } as CanvasNode;
    render(<NodeConfigFields node={node} metadata={metadata} onChange={onChange} />);
    return onChange;
  }

  it('chooses who hears from the people on the task', async () => {
    const user = setupUser();
    const onChange = renderEmail({ recipients: ['ASSIGNEE'], subject: 'Hi' });

    expect(screen.getByRole('checkbox', { name: 'The assignee' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Collaborators' }));
    expect(onChange).toHaveBeenLastCalledWith({
      recipients: ['ASSIGNEE', 'COLLABORATORS'],
      subject: 'Hi',
    });
    // No box for an address: a rule does not send mail to whoever it likes.
    expect(screen.queryByRole('textbox', { name: /address/i })).toBeNull();
  });
});

describe('ticket rules', () => {
  function renderNode(type: string, subtype: string, configuration: Record<string, unknown>) {
    const onChange = vi.fn();
    const node = {
      id: 'n-1',
      type,
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

  it('sets a ticket status from the ticket’s own list', async () => {
    const onChange = renderNode('ACTION', 'SET_TICKET_STATUS', {});

    await userEvent.click(screen.getByLabelText('Ticket status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Triaged' }));
    expect(onChange).toHaveBeenLastCalledWith({ status: 'TRIAGED' });
  });

  it('narrows "ticket status changes" to one status, or back to any', async () => {
    const onChange = renderNode('TRIGGER', 'TICKET_STATUS_CHANGED', {});

    expect(screen.getByLabelText('When the status changes to')).toHaveTextContent('Any status');
    await userEvent.click(screen.getByLabelText('When the status changes to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Resolved' }));
    expect(onChange).toHaveBeenLastCalledWith({ status: 'RESOLVED' });
  });
});

describe('the Wait step', () => {
  function renderWait(configuration: Record<string, unknown>) {
    const onChange = vi.fn();
    const node = {
      id: 'n-1',
      type: 'DELAY',
      subtype: 'DELAY',
      configuration,
      position: { x: 0, y: 0 },
      parentId: null,
      branchKey: null,
      order: 0,
    } as CanvasNode;
    render(<NodeConfigFields node={node} metadata={metadata} onChange={onChange} />);
    return onChange;
  }

  it('shows how long it waits and writes a new length back', () => {
    const onChange = renderWait({ amount: 2, unit: 'DAYS' });

    const amount = screen.getByLabelText('Wait for');
    expect(amount).toHaveValue(2);
    expect(screen.getByLabelText('Unit')).toHaveTextContent('Days');

    fireEvent.change(amount, { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith({ amount: 5, unit: 'DAYS' });
  });

  it('changes the unit and keeps the number', async () => {
    const onChange = renderWait({ amount: 3, unit: 'DAYS' });

    await userEvent.click(screen.getByLabelText('Unit'));
    await userEvent.click(await screen.findByRole('option', { name: 'Hours' }));
    expect(onChange).toHaveBeenLastCalledWith({ amount: 3, unit: 'HOURS' });
  });

  it('says what is wrong with a length it cannot wait', () => {
    renderWait({ amount: 91, unit: 'DAYS' });
    expect(screen.getByText('A rule waits 90 days at most.')).toBeInTheDocument();
  });

  it('clears the number when emptied, and asks for one', () => {
    const onChange = renderWait({ amount: 2, unit: 'HOURS' });

    fireEvent.change(screen.getByLabelText('Wait for'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ amount: undefined, unit: 'HOURS' });
  });
});

describe('the AI steps', () => {
  function renderStep(
    type: string,
    subtype: string,
    configuration: Record<string, unknown>,
    customFields: unknown[] = [],
  ) {
    const onChange = vi.fn();
    const node = {
      id: 'n-1',
      type,
      subtype,
      configuration,
      position: { x: 0, y: 0 },
      parentId: null,
      branchKey: null,
      order: 0,
    } as CanvasNode;
    render(
      <NodeConfigFields
        node={node}
        metadata={{ ...metadata, customFields } as AutomationMetadata}
        onChange={onChange}
      />,
    );
    return onChange;
  }

  it('writes the instructions for "Use AI…"', () => {
    const onChange = renderStep('ACTION', 'AI_ACTION', { allow: ['COMMENT'] });

    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Triage it' } });
    expect(onChange).toHaveBeenLastCalledWith({ allow: ['COMMENT'], instructions: 'Triage it' });
  });

  it('ticks what AI may change, offering only the fields it can fill in', async () => {
    const onChange = renderStep('ACTION', 'AI_ACTION', { instructions: 'Triage', allow: [] }, [
      { id: 'f-1', name: 'Request type', type: 'SINGLE_SELECT', options: [] },
      { id: 'f-2', name: 'Lease ends', type: 'DATE', options: [] },
    ]);

    expect(screen.getByText('Choose at least one thing AI may change.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Fill in Lease ends' })).toBeNull();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Change its priority' }));
    expect(onChange).toHaveBeenLastCalledWith({ instructions: 'Triage', allow: ['PRIORITY'] });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Fill in Request type' }));
    expect(onChange).toHaveBeenLastCalledWith({ instructions: 'Triage', allow: ['field:f-1'] });
  });

  it('asks the AI check for its question rather than a comparison', () => {
    const onChange = renderStep('CONDITION', 'FIELD_COMPARISON', { field: 'ai.check' });

    expect(screen.queryByLabelText('Choose an option')).toBeNull();
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Is it broken?' } });
    expect(onChange).toHaveBeenLastCalledWith({ field: 'ai.check', question: 'Is it broken?' });
  });
});
