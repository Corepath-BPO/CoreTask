import { AutomationAction, AutomationTrigger, type AutomationNodeType } from '@coretask/contracts';

import { makeNodeUnder, makeTrigger, type CanvasNode } from '../builder/lib/graph-edits';

/**
 * Rules most projects end up writing, offered before anybody has to.
 *
 * Asana's rule gallery opens on a page of these — "assign when moved",
 * "move when completed" — and they are the rules that come up in project after
 * project here too. Defined in the client rather than seeded per workspace: a
 * starter names no section, person or field, so there is nothing about it that
 * belongs to a workspace, and shipping it as data would mean migrating every
 * workspace each time the list changed.
 *
 * Every starter opens in the builder with its blanks unanswered. That is the
 * point rather than a shortcoming: "assign a person" cannot know who, and the
 * validator refuses to publish until somebody says — so a starter is a rule
 * half-written in the shape that works, never one that runs before it is read.
 */
export interface StarterTemplate {
  /** Stable, url-safe. Travels in `?starter=` to the builder. */
  key: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  steps: readonly {
    type: Extract<AutomationNodeType, 'ACTION' | 'CONDITION'>;
    subtype: string;
    configuration?: Record<string, unknown>;
  }[];
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    key: 'assign-on-arrival',
    name: 'Assign whoever owns a section',
    description: 'When a task lands in a section, hand it to the person who works that column.',
    trigger: AutomationTrigger.TASK_MOVED_TO_SECTION,
    steps: [{ type: 'ACTION', subtype: AutomationAction.ASSIGN_USER }],
  },
  {
    key: 'status-on-move',
    name: 'Keep status in step with the board',
    description: 'When a task is moved to a section, set its status to match the column.',
    trigger: AutomationTrigger.TASK_MOVED_TO_SECTION,
    steps: [{ type: 'ACTION', subtype: AutomationAction.UPDATE_STATUS }],
  },
  {
    key: 'move-when-done',
    name: 'Move completed tasks out of the way',
    description: 'When a task is completed, move it to a section such as Done.',
    trigger: AutomationTrigger.TASK_COMPLETED,
    steps: [{ type: 'ACTION', subtype: AutomationAction.MOVE_TO_SECTION }],
  },
  {
    key: 'due-date-on-create',
    name: 'Give new tasks a due date',
    description: 'When a task is created, set its due date a week out so nothing sits undated.',
    trigger: AutomationTrigger.TASK_CREATED,
    steps: [
      { type: 'ACTION', subtype: AutomationAction.SET_DUE_DATE, configuration: { daysFromNow: 7 } },
    ],
  },
  {
    key: 'checklist-on-create',
    name: 'Add a checklist to new tasks',
    description: 'When a task is created, create the same subtasks under it every time.',
    trigger: AutomationTrigger.TASK_CREATED,
    steps: [{ type: 'ACTION', subtype: AutomationAction.CREATE_SUBTASK }],
  },
  {
    key: 'comment-when-completed',
    name: 'Leave a note when work is done',
    description: 'When a task is completed, add a comment for whoever is following it.',
    trigger: AutomationTrigger.TASK_COMPLETED,
    steps: [{ type: 'ACTION', subtype: AutomationAction.ADD_COMMENT }],
  },
];

/** Only keys this list knows; anything else in the url opens a blank canvas. */
export const STARTER_KEY_PATTERN = /^[a-z0-9-]{1,40}$/;

export function findStarter(key: string | undefined): StarterTemplate | undefined {
  return key ? STARTER_TEMPLATES.find((starter) => starter.key === key) : undefined;
}

/**
 * The canvas a starter opens with.
 *
 * Actions hang straight off the trigger, with no "Check if" row: a starter is
 * "every time this happens, do that", and a row nobody asked for would sit
 * unanswered and block publishing. Started from a section, the trigger watches
 * it — which for a section trigger is the whole answer, and for any other
 * trigger is nothing the click can mean, so the section is left alone.
 */
export function makeStarterNodes(starter: StarterTemplate, sectionId?: string): CanvasNode[] {
  const scoped = sectionId && starter.trigger === AutomationTrigger.TASK_MOVED_TO_SECTION;
  const trigger = makeTrigger(starter.trigger, scoped ? { sectionId } : {});

  const nodes: CanvasNode[] = [trigger];
  let parent = trigger;

  for (const step of starter.steps) {
    const node: CanvasNode = {
      ...makeNodeUnder(step.type, step.subtype, parent.id, null, nodes),
      configuration: { ...(step.configuration ?? {}) },
    };
    nodes.push(node);
    parent = node;
  }

  return nodes;
}
