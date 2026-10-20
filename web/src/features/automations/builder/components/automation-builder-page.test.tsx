import { AutomationRuleStatus } from '@coretask/contracts';
import type { AutomationGraphNode, AutomationMetadata, AutomationRuleGraph } from '@coretask/types';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, userEvent } from '@/test/test-utils';

import { AutomationBuilderPage } from './automation-builder-page';

/*
 * The canvas, stubbed down to the part this file is about.
 *
 * React Flow places its nodes by measuring the container, and jsdom measures
 * everything as zero — so the real canvas renders the graph and then marks every
 * node hidden, which a test can assert nothing about. The drawing is covered in
 * a real browser by `e2e/automation-builder.spec.ts`; what is left here is the
 * page's own bookkeeping, which is where a step is created and therefore where
 * it can be created twice.
 *
 * Each node is rendered as its shape rather than its wording — the type, the
 * subtype, and what it hangs off — because that is what an insertion is about,
 * and a summary would make these assertions a test of `node-summary` instead.
 */
vi.mock('./automation-canvas', () => ({
  AutomationCanvas: ({
    graph,
    onInsertStep,
    onInsertBranch,
  }: {
    graph: { nodes: { id: string; type: string; subtype: string; parentId: string | null }[] };
    onInsertStep: (parentId: string) => void;
    onInsertBranch: (parentId: string) => void;
  }) => (
    <ul>
      {graph.nodes.map((node) => (
        <li key={node.id} data-testid="step" data-id={node.id} data-parent={node.parentId ?? ''}>
          {`${node.type} ${node.subtype}`.trim()}
          {/* Labelled rather than captioned, so the text of the row above stays
              the node's shape and nothing else. */}
          <button
            type="button"
            aria-label={`Add a step after: ${node.id}`}
            onClick={() => onInsertStep(node.id)}
          />
          <button
            type="button"
            aria-label={`Add a branch after: ${node.id}`}
            onClick={() => onInsertBranch(node.id)}
          />
        </li>
      ))}
    </ul>
  ),
}));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Acme' }, isLoading: false }),
}));

vi.mock('@/features/projects/hooks/use-projects', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useProject: () => ({ data: { id: 'p-1', name: 'Support' } }) };
});

vi.mock('../hooks/use-automation-graph', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAutomationGraph: () => ({ data: RULE, isLoading: false }),
    useAutomationMetadata: () => ({ data: METADATA }),
    useSaveGraph: () => IDLE_MUTATION,
  };
});

vi.mock('../../hooks/use-automations', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useCreateRule: () => IDLE_MUTATION,
    usePublishRule: () => IDLE_MUTATION,
  };
});

/** Nothing here saves; the writes have their own tests. */
const IDLE_MUTATION = {
  isPending: false,
  isError: false,
  isSuccess: false,
  mutateAsync: () => Promise.resolve(null),
};

const node = (over: Partial<AutomationGraphNode>): AutomationGraphNode =>
  ({
    id: 'n',
    type: 'ACTION',
    subtype: 'ADD_COMMENT',
    configuration: {},
    position: { x: 0, y: 0 },
    parentId: null,
    branchKey: null,
    order: 0,
    ...over,
  }) as AutomationGraphNode;

/**
 * A finished rule: when a task lands here, if it is urgent, say something.
 *
 * Three real steps rather than the two a new rule opens with, because the bug
 * being covered only exists where a step is put *in front of* another one.
 */
const RULE: AutomationRuleGraph = {
  id: 'r-1',
  projectId: 'p-1',
  name: 'Greet urgent arrivals',
  description: null,
  status: AutomationRuleStatus.DRAFT,
  version: 1,
  allowChaining: true,
  createdBy: null,
  publishedAt: null,
  graph: {
    nodes: [
      node({
        id: 't',
        type: 'TRIGGER',
        subtype: 'TASK_MOVED_TO_SECTION',
        configuration: { sectionId: 's-1' },
        order: 0,
      }),
      node({
        id: 'c',
        type: 'CONDITION',
        subtype: 'FIELD_COMPARISON',
        configuration: { field: 'priority', operator: 'EQUALS', value: 'HIGH' },
        parentId: 't',
        order: 1,
      }),
      node({
        id: 'a',
        subtype: 'ADD_COMMENT',
        configuration: { body: 'Someone will be with you shortly.' },
        parentId: 'c',
        order: 2,
      }),
    ],
    edges: [],
  },
  createdAt: '',
  updatedAt: '',
};

const METADATA: AutomationMetadata = {
  triggers: [
    {
      subtype: 'TASK_CREATED',
      label: 'When a task is created',
      description: 'Runs as soon as the task exists.',
      category: 'Tasks',
      available: true,
    },
  ],
  actions: [
    {
      subtype: 'ASSIGN_USER',
      label: 'Assign to somebody',
      description: 'Give the task an owner.',
      category: 'People',
      available: true,
    },
    {
      subtype: 'ADD_COMMENT',
      label: 'Add a comment',
      description: 'Write something on the task.',
      category: 'Tasks',
      available: true,
    },
  ],
  conditionFields: [],
  sections: [{ id: 's-1', name: 'Incoming' }],
  statuses: [],
  priorities: [],
  members: [{ id: 'u-1', name: 'Ada', email: 'ada@coretask.dev', avatarUrl: null }],
  customFields: [],
};

const render = () =>
  renderWithRouter(() => (
    <AutomationBuilderPage projectId="p-1" ruleId="r-1" onClose={() => {}} />
  ));

/** Every node the canvas was handed, in the order it would draw them. */
const drawn = () =>
  screen.getAllByTestId('step').map((element) => ({
    id: element.dataset.id ?? '',
    parentId: element.dataset.parent ?? '',
    shape: element.firstChild?.textContent ?? '',
  }));

describe('inserting a step into a rule', () => {
  it('adds exactly one, and it is the one that was chosen', async () => {
    const user = userEvent.setup();
    await render();

    expect(drawn()).toHaveLength(3);

    await user.click(await screen.findByRole('button', { name: 'Add a step after: c' }));
    await user.click(await screen.findByRole('option', { name: /assign to somebody/i }));

    /*
     * Four, not five.
     *
     * The list is what creates the step — pressing the plus only says where it
     * goes. Adding an empty node there as well left a second, blank step behind
     * that nothing ever filled in: it forked the rule at that point and carried
     * a subtype the save endpoint refuses.
     */
    expect(drawn().map((step) => step.shape)).toEqual([
      'TRIGGER TASK_MOVED_TO_SECTION',
      'CONDITION FIELD_COMPARISON',
      'ACTION ADD_COMMENT',
      'ACTION ASSIGN_USER',
    ]);
  });

  it('puts the new step in front of whatever already followed', async () => {
    const user = userEvent.setup();
    await render();

    await user.click(await screen.findByRole('button', { name: 'Add a step after: c' }));
    await user.click(await screen.findByRole('option', { name: /assign to somebody/i }));

    const steps = drawn();
    const inserted = steps.find((step) => step.shape === 'ACTION ASSIGN_USER');
    const comment = steps.find((step) => step.shape === 'ACTION ADD_COMMENT');

    // A stage, not a second tail: two steps sharing a parent would be a split.
    expect(inserted?.parentId).toBe('c');
    expect(comment?.parentId).toBe(inserted?.id);
  });

  it('still appends when there is nothing after the step it was asked from', async () => {
    // The adoption above must find nothing here, or the last step would be
    // re-parented onto the one being added after it.
    const user = userEvent.setup();
    await render();

    await user.click(await screen.findByRole('button', { name: 'Add a step after: a' }));
    await user.click(await screen.findByRole('option', { name: /assign to somebody/i }));

    const steps = drawn();

    expect(steps).toHaveLength(4);
    expect(steps.find((step) => step.shape === 'ACTION ASSIGN_USER')?.parentId).toBe('a');
    expect(steps.find((step) => step.id === 'a')?.parentId).toBe('c');
  });

  it('leaves the rule as it was when the list is closed without an answer', async () => {
    /*
     * Changing your mind has to cost nothing. While the plus created a step of
     * its own, backing out of the list left that step on the canvas — an
     * unfinished one somebody then had to find and delete.
     */
    const user = userEvent.setup();
    await render();

    await user.click(await screen.findByRole('button', { name: 'Add a step after: c' }));
    await user.click(await screen.findByRole('button', { name: 'Close settings' }));

    expect(drawn().map((step) => step.shape)).toEqual([
      'TRIGGER TASK_MOVED_TO_SECTION',
      'CONDITION FIELD_COMPARISON',
      'ACTION ADD_COMMENT',
    ]);
  });

  it('draws a split straight away, because it has no list to answer', async () => {
    // A branch carries its own comparison, so it is built where it is asked for
    // and answered on the canvas afterwards — the plus and the step are one act.
    const user = userEvent.setup();
    await render();

    await user.click(await screen.findByRole('button', { name: 'Add a branch after: a' }));

    expect(drawn().map((step) => step.shape)).toEqual([
      'TRIGGER TASK_MOVED_TO_SECTION',
      'CONDITION FIELD_COMPARISON',
      'ACTION ADD_COMMENT',
      'BRANCH FIELD_COMPARISON',
      // Both arms, offered empty: a split showing one path looks like it only
      // goes one way.
      'PLACEHOLDER ACTION',
      'PLACEHOLDER ACTION',
    ]);
  });
});
