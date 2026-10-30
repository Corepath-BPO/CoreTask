import type { SnapshotNode } from './rule-snapshot';
import { ruleAssignees } from './rule-snapshot';

const node = (
  nodeType: string,
  subtype: string,
  configuration: Record<string, unknown>,
): SnapshotNode => ({
  id: `${subtype}-${Math.random()}`,
  nodeType: nodeType as SnapshotNode['nodeType'],
  subtype,
  configuration: configuration as SnapshotNode['configuration'],
  parentNodeId: null,
  branchKey: null,
  position: 0,
});

describe('ruleAssignees', () => {
  it('names whoever the steps give work to, once each', () => {
    expect(
      ruleAssignees([
        node('ACTION', 'ASSIGN_USER', { userId: 'u-1' }),
        node('ACTION', 'CREATE_TASK', { title: 'Follow up', assigneeId: 'u-2' }),
        node('ACTION', 'CREATE_SUBTASK', {
          subtasks: [
            { title: 'Sign', assigneeId: 'u-3' },
            { title: 'File' },
            { title: 'Check', assigneeId: 'u-1' },
          ],
        }),
      ]),
    ).toEqual(['u-1', 'u-2', 'u-3']);
  });

  it('reads "Assign to" written under its older key', () => {
    expect(ruleAssignees([node('ACTION', 'ASSIGN_USER', { assigneeId: 'u-1' })])).toEqual(['u-1']);
  });

  it('gives nobody work for a condition that only names them', () => {
    expect(
      ruleAssignees([
        node('CONDITION', 'FIELD_COMPARISON', { field: 'assigneeId', value: 'u-1' }),
        node('ACTION', 'ADD_FOLLOWERS', { userIds: ['u-2'] }),
      ]),
    ).toEqual([]);
  });
});
