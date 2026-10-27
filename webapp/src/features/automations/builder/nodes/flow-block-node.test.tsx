import { render, screen, within } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { AddPathNode, FlowBlockNode, type FlowBlockData, type FlowLine } from './flow-block-node';

const line = (over: Partial<FlowLine>): FlowLine => ({
  nodeId: 'n',
  category: 'ACTION',
  summary: [{ text: 'Move to' }, { text: 'To Do', chip: true }],
  label: 'Move to To Do',
  invalid: false,
  selected: false,
  ...over,
});

function renderCard(data: Partial<FlowBlockData>) {
  const block: FlowBlockData = {
    kind: 'TASK',
    title: 'Task',
    lines: [],
    collapsed: false,
    onOpenLine: vi.fn(),
    ...data,
  };
  render(
    <ReactFlowProvider>
      <FlowBlockNode {...({ data: block } as unknown as NodeProps)} />
    </ReactFlowProvider>,
  );
  return block;
}

describe('FlowBlockNode', () => {
  it('numbers a Task card’s steps and opens the one clicked', async () => {
    const user = setupUser();
    const block = renderCard({
      lines: [
        line({ nodeId: 'a1', number: 2 }),
        line({
          nodeId: 'a2',
          number: 3,
          summary: [{ text: 'Set Started' }],
          label: 'Set Started',
        }),
      ],
    });

    expect(screen.getByText('Task')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2. Move to To Do' })).toHaveTextContent(
      '2.Move to To Do',
    );

    await user.click(screen.getByRole('button', { name: '3. Set Started' }));
    expect(block.onOpenLine).toHaveBeenCalledWith('a2');
  });

  it('heads the trigger with its project and a Trigger badge', () => {
    renderCard({
      kind: 'TRIGGER',
      title: 'Trigger',
      projectName: 'IT Development',
      lines: [
        line({
          nodeId: 't',
          category: 'TRIGGER',
          number: 1,
          label: 'Status is changed',
          summary: [{ text: 'Status is changed' }],
        }),
      ],
    });

    expect(screen.getByText('Tasks in')).toBeInTheDocument();
    expect(screen.getByText('IT Development')).toBeInTheDocument();
    expect(screen.getByText('Trigger')).toBeInTheDocument();
  });

  it('offers a step’s own menu, and a path’s', async () => {
    const user = setupUser();
    const onDelete = vi.fn();
    const onMoveLeft = vi.fn();
    renderCard({
      kind: 'PATH',
      title: 'Else if',
      lines: [
        line({ nodeId: 'r', category: 'CONDITION' }),
        line({ nodeId: 'c', category: 'CONDITION', onDelete }),
      ],
      pathMenu: { onMoveLeft, onDelete: vi.fn() },
    });

    await user.click(screen.getByRole('button', { name: 'More for: Else if' }));
    const pathMenu = await screen.findByRole('menu');
    expect(
      within(pathMenu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Move left', 'Delete path']);
    await user.click(within(pathMenu).getByRole('menuitem', { name: 'Move left' }));
    expect(onMoveLeft).toHaveBeenCalled();

    // The path's own question has no menu of its own; the check after it does.
    expect(screen.getAllByRole('button', { name: /^More for: Move to/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /^More for: Move to/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('adds an action or a path from the + under a column', async () => {
    const user = setupUser();
    const add = {
      onAddAction: vi.fn(),
      pathLabel: 'Else if',
      onAddPath: vi.fn(),
      onAddOtherwise: vi.fn(),
    };
    renderCard({ lines: [line({ nodeId: 'a1', number: 2 })], add });

    await user.click(screen.getByRole('button', { name: 'Add step' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Actions')).toBeInTheDocument();
    expect(within(menu).getByText('Flow controls')).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: /Else if/ }));
    expect(add.onAddPath).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.click(await screen.findByRole('menuitem', { name: /^Action/ }));
    expect(add.onAddAction).toHaveBeenCalled();
  });

  it('shows one line per card in the collapsed view', () => {
    renderCard({
      collapsed: true,
      lines: [line({ nodeId: 'a1', number: 2 }), line({ nodeId: 'a2', number: 3 })],
    });

    expect(screen.getByText(/2\. Move to To Do/)).toBeInTheDocument();
    expect(screen.getByText(/1 more/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '3. Move to To Do' })).toBeNull();
  });
});

describe('AddPathNode', () => {
  it('adds an Else if, and an Otherwise while there is none', async () => {
    const user = setupUser();
    const data = { onAddPath: vi.fn(), onAddOtherwise: vi.fn() };
    render(
      <ReactFlowProvider>
        <AddPathNode {...({ data } as unknown as NodeProps)} />
      </ReactFlowProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Add path' }));
    await user.click(await screen.findByRole('menuitem', { name: /Otherwise/ }));
    expect(data.onAddOtherwise).toHaveBeenCalled();
  });
});
