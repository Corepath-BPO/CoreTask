import { CustomFieldType, TaskPriority, TaskStatus } from '@coretask/contracts';
import type { CustomField, ProjectFieldMetadata, Task } from '@coretask/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CustomFieldCell } from './cells/custom-field-cell';
import { DueDateCell, TitleCell } from './cells/system-cells';
import { groupBySection } from '../lib/group-by-section';

const task = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task-1',
    workspaceId: 'ws-1',
    projectId: 'p-1',
    sectionId: 's-1',
    parentTaskId: null,
    title: 'Ship the grid',
    description: null,
    status: TaskStatus.TODO,
    priority: TaskPriority.MEDIUM,
    position: 1,
    startDate: null,
    dueDate: null,
    completedAt: null,
    archivedAt: null,
    estimatedMinutes: null,
    assigneeId: null,
    assignee: null,
    createdById: 'u-1',
    subtaskCount: 0,
    completedSubtaskCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as Task;

const metadata = (sections: { id: string; name: string }[]): ProjectFieldMetadata => ({
  customFields: [],
  statuses: [],
  priorities: [],
  sections,
  members: [],
});

describe('groupBySection', () => {
  it('keeps a section that has no tasks', () => {
    const groups = groupBySection(
      [task({ sectionId: 's-1' })],
      metadata([
        { id: 's-1', name: 'Backlog' },
        { id: 's-2', name: 'In Review' },
      ]),
    );

    expect(groups.map((group) => group.name)).toEqual(['Backlog', 'In Review']);
    expect(groups[1].tasks).toHaveLength(0);
  });

  it('renders every section when the project has no tasks at all', () => {
    const groups = groupBySection(
      [],
      metadata([
        { id: 's-1', name: 'Backlog' },
        { id: 's-2', name: 'Done' },
      ]),
    );

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.tasks.length === 0)).toBe(true);
  });

  it('keeps sections in the order the project defines, not task order', () => {
    const groups = groupBySection(
      [task({ id: 't-2', sectionId: 's-3' }), task({ id: 't-1', sectionId: 's-1' })],
      metadata([
        { id: 's-1', name: 'Backlog' },
        { id: 's-2', name: 'In Progress' },
        { id: 's-3', name: 'Done' },
      ]),
    );

    expect(groups.map((group) => group.name)).toEqual(['Backlog', 'In Progress', 'Done']);
  });

  it('collects tasks whose section is missing into their own group', () => {
    const groups = groupBySection(
      [task({ sectionId: null })],
      metadata([{ id: 's-1', name: 'Backlog' }]),
    );

    expect(groups.at(-1)?.name).toBe('No section');
  });
});

const cellProps = {
  metadata: undefined,
  canEdit: true,
  onOpenTask: vi.fn(),
};

describe('editable cells', () => {
  it('saves an edited title on Enter', () => {
    const onSave = vi.fn();
    render(<TitleCell {...cellProps} task={task()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename "Ship the grid"' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Ship the data grid' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).toHaveBeenCalledWith({ title: 'Ship the data grid' });
  });

  it('discards an edit on Escape', () => {
    const onSave = vi.fn();
    render(<TitleCell {...cellProps} task={task()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename "Ship the grid"' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Abandoned' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open "Ship the grid"' })).toBeInTheDocument();
  });

  it('saves when focus leaves the cell', () => {
    const onSave = vi.fn();
    render(<TitleCell {...cellProps} task={task()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename "Ship the grid"' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Saved by blur' } });
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledWith({ title: 'Saved by blur' });
  });

  it('does not save a title edited to nothing', () => {
    const onSave = vi.fn();
    render(<TitleCell {...cellProps} task={task()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename "Ship the grid"' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not save when the value was opened and closed unchanged', () => {
    const onSave = vi.fn();
    render(<TitleCell {...cellProps} task={task()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename "Ship the grid"' }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers no expander on a task with no subtasks', () => {
    render(<TitleCell {...cellProps} task={task()} onSave={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /subtasks of/ })).not.toBeInTheDocument();
  });

  it('shows how much of a task’s subtask work is done', () => {
    render(
      <TitleCell
        {...cellProps}
        task={task({ subtaskCount: 3, completedSubtaskCount: 2 })}
        onSave={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );

    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('expands subtasks without opening the task', () => {
    const onToggleExpand = vi.fn();
    const onOpenTask = vi.fn();
    render(
      <TitleCell
        {...cellProps}
        task={task({ subtaskCount: 2 })}
        onSave={vi.fn()}
        onOpenTask={onOpenTask}
        onToggleExpand={onToggleExpand}
      />,
    );

    const expander = screen.getByRole('button', {
      name: 'Show subtasks of "Ship the grid"',
    });
    expect(expander).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(expander);

    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    // Expanding is not opening: the two live in the same cell and must not be
    // confusable.
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it('says "Hide" once expanded, so the control describes what it will do', () => {
    render(
      <TitleCell
        {...cellProps}
        task={task({ subtaskCount: 2 })}
        onSave={vi.fn()}
        expanded
        onToggleExpand={vi.fn()}
      />,
    );

    const expander = screen.getByRole('button', {
      name: 'Hide subtasks of "Ship the grid"',
    });
    expect(expander).toHaveAttribute('aria-expanded', 'true');
  });

  it('offers no editor at all when the caller cannot edit', () => {
    render(<DueDateCell {...cellProps} canEdit={false} task={task()} onSave={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Due date/ })).not.toBeInTheDocument();
  });

  it('sends a due date to the API as ISO, not as the input’s yyyy-mm-dd', () => {
    const onSave = vi.fn();
    render(<DueDateCell {...cellProps} task={task()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Due date for "Ship the grid"' }));
    const input = screen.getByLabelText('Due date for "Ship the grid"');
    fireEvent.change(input, { target: { value: '2026-04-09' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).toHaveBeenCalledWith({ dueDate: '2026-04-09T00:00:00.000Z' });
  });
});

const field = (overrides: Partial<CustomField>): CustomField =>
  ({
    id: 'f-1',
    projectId: 'p-1',
    name: 'Estimate',
    description: null,
    type: CustomFieldType.TEXT,
    isRequired: false,
    isArchived: false,
    position: 1,
    options: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as CustomField;

describe('CustomFieldCell', () => {
  it('picks the editor from the field definition, not the stored value', () => {
    const onSave = vi.fn();
    render(
      <CustomFieldCell
        field={field({ type: CustomFieldType.NUMBER, name: 'Points' })}
        // A text value left behind by an older definition.
        value={{
          customFieldId: 'f-1',
          text: 'seven',
          number: null,
          date: null,
          checkbox: null,
          optionIds: [],
          userIds: [],
        }}
        metadata={undefined}
        canEdit
        taskTitle="Ship the grid"
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Points for "Ship the grid"' }));
    expect(screen.getByLabelText('Points for "Ship the grid"')).toHaveAttribute('type', 'number');
  });

  it('toggles a checkbox in one click, with no commit step', () => {
    const onSave = vi.fn();
    render(
      <CustomFieldCell
        field={field({ type: CustomFieldType.CHECKBOX, name: 'Blocked' })}
        value={undefined}
        metadata={undefined}
        canEdit
        taskTitle="Ship the grid"
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Blocked for "Ship the grid"' }));
    expect(onSave).toHaveBeenCalledWith({ checkbox: true });
  });

  it('clears a number field to null rather than sending an empty string', () => {
    const onSave = vi.fn();
    render(
      <CustomFieldCell
        field={field({ type: CustomFieldType.NUMBER, name: 'Points' })}
        value={{
          customFieldId: 'f-1',
          text: null,
          number: 8,
          date: null,
          checkbox: null,
          optionIds: [],
          userIds: [],
        }}
        metadata={undefined}
        canEdit
        taskTitle="Ship the grid"
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Points for "Ship the grid"' }));
    const input = screen.getByLabelText('Points for "Ship the grid"');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).toHaveBeenCalledWith({ number: null });
  });

  it('shows a label for an archived option instead of a bare id', () => {
    render(
      <CustomFieldCell
        field={field({
          type: CustomFieldType.SINGLE_SELECT,
          name: 'Stage',
          options: [
            {
              id: 'opt-1',
              label: 'Retired stage',
              colorToken: 'neutral',
              customColor: null,
              position: 1,
              isArchived: true,
            },
          ],
        })}
        value={{
          customFieldId: 'f-1',
          text: null,
          number: null,
          date: null,
          checkbox: null,
          optionIds: ['opt-1'],
          userIds: [],
        }}
        metadata={undefined}
        canEdit
        taskTitle="Ship the grid"
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText('Retired stage')).toBeInTheDocument();
  });

  it('renders a field type it does not know without crashing the row', () => {
    render(
      <CustomFieldCell
        field={field({ type: 'FUTURE_TYPE' as CustomFieldType, name: 'Mystery' })}
        value={undefined}
        metadata={undefined}
        canEdit
        taskTitle="Ship the grid"
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText('Unsupported field')).toBeInTheDocument();
  });
});
