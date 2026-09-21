import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS } from '@coretask/contracts';
import { validateGraphStructure } from '@coretask/validation';
import { describe, expect, it } from 'vitest';

import {
  STARTER_KEY_PATTERN,
  STARTER_TEMPLATES,
  findStarter,
  makeStarterNodes,
} from './starter-templates';

const structural = (nodes: ReturnType<typeof makeStarterNodes>) =>
  validateGraphStructure(
    nodes.map((node) => ({
      id: node.id,
      type: node.type,
      subtype: node.subtype,
      configuration: node.configuration,
      parentId: node.parentId,
      branchKey: node.branchKey,
      order: node.order,
    })),
    'A starter',
  );

describe('starter templates', () => {
  it('only name triggers and actions the engine runs, under keys that fit the url', () => {
    for (const starter of STARTER_TEMPLATES) {
      expect(starter.key).toMatch(STARTER_KEY_PATTERN);
      expect(AUTOMATION_TRIGGERS).toContain(starter.trigger);
      for (const step of starter.steps) {
        if (step.type === 'ACTION') expect(AUTOMATION_ACTIONS).toContain(step.subtype);
      }
    }

    expect(new Set(STARTER_TEMPLATES.map((starter) => starter.key)).size).toBe(
      STARTER_TEMPLATES.length,
    );
  });

  it('opens as a connected rule whose only faults are the blanks to fill', () => {
    for (const starter of STARTER_TEMPLATES) {
      const nodes = makeStarterNodes(starter);
      const errors = structural(nodes).filter((issue) => issue.level === 'ERROR');

      // The trigger leads, and every step follows the one before it.
      expect(nodes[0]?.type).toBe('TRIGGER');
      expect(nodes[0]?.parentId).toBeNull();
      nodes.slice(1).forEach((node, index) => expect(node.parentId).toBe(nodes[index]?.id));

      // Nothing structural: whatever is wrong is an answer somebody has to give.
      for (const issue of errors) expect(issue.message).toMatch(/^(Choose|Write|Give)/);
    }
  });

  it('watches the section it was started from, when the trigger is a move', () => {
    const move = findStarter('assign-on-arrival');
    const create = findStarter('due-date-on-create');
    if (!move || !create) throw new Error('starters missing');

    expect(makeStarterNodes(move, 'sec-1')[0]?.configuration).toEqual({ sectionId: 'sec-1' });
    // A creation trigger has no section to watch; the click means nothing to it.
    expect(makeStarterNodes(create, 'sec-1')[0]?.configuration).toEqual({});
    expect(makeStarterNodes(move)[0]?.configuration).toEqual({});
  });

  it('carries a step’s preset settings', () => {
    const starter = findStarter('due-date-on-create');
    if (!starter) throw new Error('starter missing');

    expect(makeStarterNodes(starter)[1]?.configuration).toEqual({ daysFromNow: 7 });
  });

  it('answers nothing for a key it does not know', () => {
    expect(findStarter('not-a-starter')).toBeUndefined();
    expect(findStarter(undefined)).toBeUndefined();
  });
});
