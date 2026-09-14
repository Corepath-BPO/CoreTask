import { describe, expect, it } from 'vitest';

import {
  rulesForSection,
  ruleWatchesSection,
  sectionsWatchedByRule,
} from './automation-section-scope';

const REVIEW = '01a059bf-0f47-7e51-bbd6-5a5925fafe6c';
const DONE = '01a059bf-66b6-73b0-b4b5-092d20c74517';
const TODO = '01a059be-2126-7381-8e84-3b88af217cc7';

const trigger = (configuration: Record<string, unknown>) => ({
  nodeType: 'TRIGGER',
  configuration,
});
const condition = (configuration: Record<string, unknown>) => ({
  nodeType: 'CONDITION',
  configuration,
});
const action = (configuration: Record<string, unknown>) => ({
  nodeType: 'ACTION',
  configuration,
});

/**
 * Which section a rule belongs under — the question the section lightning asks.
 *
 * The shapes here are the ones actually in the database: a trigger scoped by
 * `sectionId`, the same with a `form` beside it, and the rule a section's menu
 * starts with — a `sectionId EQUALS` condition that outlives a change of
 * trigger. The last is the case that used to disappear.
 */
describe('sectionsWatchedByRule', () => {
  it('reads the section a move trigger watches', () => {
    expect(
      sectionsWatchedByRule({
        triggerConfig: { sectionId: REVIEW },
        nodes: [trigger({ sectionId: REVIEW })],
      }),
    ).toEqual([REVIEW]);
  });

  it('reads it just the same with the form written beside it', () => {
    expect(
      sectionsWatchedByRule({
        triggerConfig: { form: 'SECTION_CHANGED_TO', sectionId: REVIEW },
        nodes: [],
      }),
    ).toEqual([REVIEW]);
  });

  it('reads every section of an any-of trigger', () => {
    expect(
      sectionsWatchedByRule({
        triggerConfig: { form: 'SECTION_CHANGED_TO_ANY_OF', sectionIds: [REVIEW, DONE] },
        nodes: [],
      }),
    ).toEqual([REVIEW, DONE]);
  });

  it('keeps a rule with its section after its trigger is changed', () => {
    // Started from Review's lightning menu, then switched to "task completed":
    // the trigger no longer names a section but the check the menu wrote does.
    expect(
      sectionsWatchedByRule({
        triggerConfig: {},
        nodes: [
          trigger({}),
          condition({ field: 'sectionId', operator: 'EQUALS', value: REVIEW }),
          action({ sectionId: DONE }),
        ],
      }),
    ).toEqual([REVIEW]);
  });

  it('accepts the reading spelling of the same comparison', () => {
    expect(
      sectionsWatchedByRule({
        triggerConfig: {},
        nodes: [condition({ field: 'sectionId', operator: 'IS', value: REVIEW })],
      }),
    ).toEqual([REVIEW]);

    expect(
      sectionsWatchedByRule({
        triggerConfig: {},
        nodes: [condition({ field: 'sectionId', operator: 'IS_ONE_OF', value: [REVIEW, TODO] })],
      }),
    ).toEqual([REVIEW, TODO]);
  });

  it('does not list a rule under the section it excludes', () => {
    expect(
      sectionsWatchedByRule({
        triggerConfig: { form: 'SECTION_CHANGED_TO_NOT', sectionId: DONE },
        nodes: [condition({ field: 'sectionId', operator: 'IS_NOT', value: TODO })],
      }),
    ).toEqual([]);
  });

  it('does not list a rule under the section it moves tasks to', () => {
    expect(
      sectionsWatchedByRule({
        triggerConfig: {},
        nodes: [trigger({}), action({ sectionId: DONE })],
      }),
    ).toEqual([]);
  });

  it('ignores conditions on other fields and names each section once', () => {
    expect(
      sectionsWatchedByRule({
        triggerConfig: { sectionId: REVIEW },
        nodes: [
          condition({ field: 'customField:abc', operator: 'IS', value: REVIEW }),
          condition({ field: 'sectionId', operator: 'EQUALS', value: REVIEW }),
          condition({ field: 'sectionId', operator: 'IS', value: '' }),
        ],
      }),
    ).toEqual([REVIEW]);
  });

  it('tolerates configuration that is not an object', () => {
    expect(
      sectionsWatchedByRule({
        triggerConfig: null,
        nodes: [
          condition('nonsense' as unknown as Record<string, unknown>),
          condition([] as never),
        ],
      }),
    ).toEqual([]);
  });
});

describe('rulesForSection', () => {
  it('keeps the rules about the section, in the order given', () => {
    const rules = [
      { id: 'a', triggerConfig: { sectionId: REVIEW }, nodes: [] },
      { id: 'b', triggerConfig: {}, nodes: [action({ sectionId: REVIEW })] },
      {
        id: 'c',
        triggerConfig: {},
        nodes: [condition({ field: 'sectionId', operator: 'EQUALS', value: REVIEW })],
      },
    ];

    expect(rulesForSection(rules, REVIEW).map((rule) => rule.id)).toEqual(['a', 'c']);
    expect(ruleWatchesSection(rules[1]!, REVIEW)).toBe(false);
  });
});
