import { WorkItemType } from '@coretask/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { QuickCreateWorkItemRow } from './quick-create-work-item-row';

const permissions = {
  canCreate: true,
  canCreateSection: true,
  creatableTypes: [WorkItemType.TASK, WorkItemType.TICKET],
  comingSoonTypes: [WorkItemType.MILESTONE, WorkItemType.APPROVAL],
};

vi.mock('../hooks/use-work-item-permissions', () => ({
  useWorkItemPermissions: () => permissions,
}));

const onCreate = vi.fn().mockResolvedValue(undefined);

const render = (props: Partial<Parameters<typeof QuickCreateWorkItemRow>[0]> = {}) =>
  renderWithProviders(
    <QuickCreateWorkItemRow
      defaultType="TICKET"
      sectionName="Incoming Request"
      onCreate={onCreate}
      {...props}
    />,
  );

/** Opens the row and returns its input. */
const openRow = async () => {
  await userEvent.click(screen.getByRole('button', { name: /add ticket/i }));
  return screen.getByRole('textbox');
};

beforeEach(() => {
  permissions.canCreate = true;
});

describe('the closed row', () => {
  it('is labelled with the type it will create', () => {
    render({ defaultType: 'TASK' });

    expect(screen.getByRole('button', { name: /add task/i })).toBeInTheDocument();
  });

  it('names the section for a screen reader, without repeating it visually', () => {
    // "Add ticket" four times down a page tells somebody listening nothing
    // about which one they are on.
    render();

    expect(
      screen.getByRole('button', { name: /add ticket to incoming request/i }),
    ).toBeInTheDocument();
  });

  it('renders nothing for somebody who cannot create', () => {
    permissions.canCreate = false;

    const { container } = render();

    expect(container).toBeEmptyDOMElement();
  });
});

describe('creating', () => {
  it('submits the typed title on Enter', async () => {
    render();
    const input = await openRow();

    fireEvent.change(input, { target: { value: 'Login returns a 500' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({ type: 'TICKET', title: 'Login returns a 500' }),
    );
  });

  it('stays open and empties, because one is rarely the last', async () => {
    render();
    const input = await openRow();

    fireEvent.change(input, { target: { value: 'First' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('closes on Enter with nothing typed rather than creating a blank', async () => {
    render();
    const input = await openRow();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('trims a title made only of spaces rather than creating it', async () => {
    render();
    const input = await openRow();

    fireEvent.change(input, { target: { value: '    ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('abandons what was typed on Escape', async () => {
    render();
    const input = await openRow();

    fireEvent.change(input, { target: { value: 'Never mind' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('keeps a half-written title when focus wanders', async () => {
    // Losing it to a stray click is worse than a row that stays open.
    render();
    const input = await openRow();

    fireEvent.change(input, { target: { value: 'Half a thought' } });
    fireEvent.blur(input);

    expect(screen.getByRole('textbox')).toHaveValue('Half a thought');
  });

  it('closes on blur when nothing was typed', async () => {
    render();
    const input = await openRow();

    fireEvent.blur(input);

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  });
});

describe('choosing a different type', () => {
  it('creates the chosen type instead of the project default', async () => {
    /*
     * A mostly-task project still files the occasional ticket. Making that a
     * trip to the toolbar is how people stop bothering and file it as a task.
     */
    render({ defaultType: 'TICKET' });
    const input = await openRow();

    await userEvent.click(screen.getByRole('button', { name: /type: ticket/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /task/i }));

    fireEvent.change(input, { target: { value: 'Actually a task' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({ type: 'TASK', title: 'Actually a task' }),
    );
  });
});
