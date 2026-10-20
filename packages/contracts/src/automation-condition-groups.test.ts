import { describe, expect, it } from 'vitest';

import {
  MAX_CONDITION_GROUP_DEPTH,
  MAX_GROUP_CONDITIONS,
  conditionGroupDepth,
  conditionGroupProblems,
  conditionLeaves,
  evaluateCondition,
  isConditionGroup,
  mapConditionLeaves,
} from './automation-condition-groups.js';
import { sectionsWatchedByRule } from './automation-section-scope.js';

const status = (value: string) => ({ field: 'status', operator: 'IS', value });
const priority = (value: string) => ({ field: 'priority', operator: 'IS', value });

/** Judges a comparison against a fixed task: status DONE, priority LOW. */
const task = (comparison: Record<string, unknown>) =>
  (comparison['field'] === 'status' && comparison['value'] === 'DONE') ||
  (comparison['field'] === 'priority' && comparison['value'] === 'LOW');

describe('condition groups', () => {
  it('tells a group from one comparison', () => {
    expect(isConditionGroup({ match: 'ANY', conditions: [] })).toBe(true);
    expect(isConditionGroup(status('DONE'))).toBe(false);
    expect(isConditionGroup(null)).toBe(false);
  });

  it('judges ALL as every entry and ANY as at least one', () => {
    const both = [status('DONE'), priority('HIGH')];

    expect(evaluateCondition({ match: 'ALL', conditions: both }, task)).toBe(false);
    expect(evaluateCondition({ match: 'ANY', conditions: both }, task)).toBe(true);
    // A group without a mode is ALL — what every rule meant before groups.
    expect(evaluateCondition({ conditions: both }, task)).toBe(false);
  });

  it('judges a nested group as one entry of the group around it', () => {
    // status is DONE and (priority is HIGH or priority is LOW)
    const nested = {
      match: 'ALL',
      conditions: [
        status('DONE'),
        { match: 'ANY', conditions: [priority('HIGH'), priority('LOW')] },
      ],
    };
    expect(evaluateCondition(nested, task)).toBe(true);

    const unmet = { ...nested, conditions: [status('TODO'), nested.conditions[1]] };
    expect(evaluateCondition(unmet, task)).toBe(false);
  });

  it('holds nothing for an empty group, and everything for the fallback row', () => {
    expect(evaluateCondition({ match: 'ALL', conditions: [] }, () => true)).toBe(false);
    expect(evaluateCondition({ match: 'ANY', conditions: [] }, () => true)).toBe(false);
    expect(evaluateCondition({ fallback: true }, () => false)).toBe(true);
  });

  it('lists every comparison with the path a validator names it by', () => {
    const group = {
      match: 'ANY',
      conditions: [status('DONE'), { match: 'ALL', conditions: [priority('HIGH')] }],
    };

    expect(conditionLeaves(group)).toEqual([
      { configuration: status('DONE'), path: 'conditions.0' },
      { configuration: priority('HIGH'), path: 'conditions.1.conditions.0' },
    ]);
    expect(conditionLeaves(status('DONE'))).toEqual([{ configuration: status('DONE'), path: '' }]);
    expect(conditionLeaves({ fallback: true })).toEqual([]);
  });

  it('replaces each comparison and keeps the group around them', () => {
    const group = { match: 'ANY', conditions: [status('DONE'), { conditions: [priority('LOW')] }] };
    const upper = mapConditionLeaves(group, (leaf) => ({ ...leaf, value: 'X' }));

    expect(upper).toEqual({
      match: 'ANY',
      conditions: [
        { ...status('DONE'), value: 'X' },
        { conditions: [{ ...priority('LOW'), value: 'X' }] },
      ],
    });
  });

  it('measures how deep groups go', () => {
    expect(conditionGroupDepth(status('DONE'))).toBe(0);
    expect(conditionGroupDepth({ conditions: [{ conditions: [status('DONE')] }] })).toBe(2);
  });

  describe('problems with a group’s shape', () => {
    it('refuses an empty group', () => {
      expect(
        conditionGroupProblems({ match: 'ALL', conditions: [status('DONE'), { conditions: [] }] }),
      ).toEqual([{ path: 'conditions.1', message: expect.stringContaining('Add a condition') }]);
    });

    it('refuses groups nested past the limit', () => {
      let group: Record<string, unknown> = { conditions: [status('DONE')] };
      for (let level = 0; level < MAX_CONDITION_GROUP_DEPTH; level += 1) {
        group = { conditions: [group] };
      }

      expect(conditionGroupProblems(group)).toContainEqual(
        expect.objectContaining({ message: expect.stringContaining('deep at most') }),
      );
    });

    it('refuses more comparisons than one step makes', () => {
      const many = Array.from({ length: MAX_GROUP_CONDITIONS + 1 }, () => status('DONE'));

      expect(conditionGroupProblems({ conditions: many })).toContainEqual(
        expect.objectContaining({ message: expect.stringContaining('at most') }),
      );
    });

    it('refuses an AI check inside a group', () => {
      expect(
        conditionGroupProblems({
          conditions: [status('DONE'), { field: 'ai.check', question: '?' }],
        }),
      ).toEqual([{ path: 'conditions.1', message: expect.stringContaining('AI') }]);
    });

    it('has nothing to say about a well-formed group or a single comparison', () => {
      expect(conditionGroupProblems({ match: 'ANY', conditions: [status('DONE')] })).toEqual([]);
      expect(conditionGroupProblems(status('DONE'))).toEqual([]);
    });
  });

  it('counts a section checked inside a group as a section the rule is about', () => {
    expect(
      sectionsWatchedByRule({
        triggerConfig: {},
        nodes: [
          {
            nodeType: 'CONDITION',
            configuration: {
              match: 'ANY',
              conditions: [
                { field: 'sectionId', operator: 'IS', value: 'review' },
                priority('HIGH'),
              ],
            },
          },
        ],
      }),
    ).toEqual(['review']);
  });
});
