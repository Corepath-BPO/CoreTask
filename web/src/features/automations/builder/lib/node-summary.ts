import {
  ACTION_LABEL,
  TRIGGER_LABEL,
  type AutomationAction,
  type AutomationTrigger,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';

import type { CanvasNode } from './graph-edits';

/**
 * What a node says on the canvas.
 *
 * Resolved against the project's own metadata rather than printed from the
 * configuration: a node reading "Assign 019fc8d5-…" is a node nobody can read,
 * and one reading "Move to 019fce6b-…" is worse, because it looks like data
 * rather than a mistake.
 *
 * A reference that no longer resolves says so in words. Falling back to the raw
 * id would make a broken rule look merely technical, when what it needs is for
 * somebody to notice the section was deleted.
 */
export interface SummarySegment {
  text: string;
  /** Rendered as a token on the card: the value, not the sentence around it. */
  chip?: boolean;
}

/**
 * The same sentence, in pieces.
 *
 * The card sets the value apart from the words describing it, which is what
 * makes a rule scannable at a glance rather than something to read. Splitting it
 * here rather than in the component keeps one place that knows what a step says
 * — the string below is these parts joined, so the label a screen reader hears
 * and the label somebody sees cannot drift apart.
 */
export function summariseParts(
  node: CanvasNode,
  metadata: AutomationMetadata | undefined,
): SummarySegment[] {
  const config = node.configuration;

  const name = (
    list: { id: string; name: string }[] | undefined,
    id: unknown,
    missing: string,
  ): string => {
    if (typeof id !== 'string' || id === '') return missing;
    return list?.find((entry) => entry.id === id)?.name ?? 'something that no longer exists';
  };

  switch (node.type) {
    case 'TRIGGER': {
      // A new rule opens with the trigger already on the canvas and nothing
      // chosen in it. An empty card would read as a rendering fault; this reads
      // as the first thing to do.
      if (node.subtype === '') return [{ text: 'Choose what starts this rule' }];

      const label = TRIGGER_LABEL[node.subtype as AutomationTrigger] ?? node.subtype;
      const sectionId = config['sectionId'];

      if (typeof sectionId === 'string' && sectionId !== '') {
        return [
          { text: label },
          { text: '—' },
          { text: name(metadata?.sections, sectionId, 'any section'), chip: true },
        ];
      }

      return [{ text: label }];
    }

    case 'CONDITION':
      return conditionSummary(config, metadata);

    case 'ACTION':
      return actionSummary(node.subtype, config, metadata);

    case 'BRANCH': {
      // A split says what it splits on, or asks — "Split the path" tells
      // somebody nothing they cannot already see.
      const parts = conditionSummary(config, metadata);

      return parts.length === 1 && parts[0]!.text === 'Choose what to check'
        ? [{ text: 'Split on — choose what to check' }]
        : parts;
    }

    case 'DELAY':
      return [{ text: 'Wait' }];

    default:
      return [{ text: 'Choose a step' }];
  }
}

/** The whole sentence, for an aria-label and anywhere plain text is wanted. */
export function summarise(node: CanvasNode, metadata: AutomationMetadata | undefined): string {
  return summariseParts(node, metadata)
    .map((part) => part.text)
    .join(' ');
}

function conditionSummary(
  config: Record<string, unknown>,
  metadata: AutomationMetadata | undefined,
): SummarySegment[] {
  const field = config['field'];
  const operator = config['operator'];

  if (typeof field !== 'string' || field === '') return [{ text: 'Choose what to check' }];

  const definition = metadata?.conditionFields.find((entry) => entry.field === field);
  const label = definition?.label ?? field;

  if (typeof operator !== 'string' || operator === '') return [{ text: `${label} …` }];

  // An emptiness check reads as a sentence on its own; anything else needs the
  // value it is being compared against.
  if (operator === 'IS_EMPTY') return [{ text: `${label} is empty` }];
  if (operator === 'IS_NOT_EMPTY') return [{ text: `${label} is set` }];

  const raw = config['value'];
  const option = definition?.options?.find((entry) => entry.value === raw);

  /*
   * A value that matches no option is not necessarily wrong.
   *
   * The metadata offers definition ids, but a condition may legitimately hold a
   * legacy enum — that is what the runner compares against for any task the
   * definition backfill has not reached. So an unmatched ALL_CAPS token is
   * humanised rather than printed, because "Priority is HIGH" is the card
   * shouting an implementation detail at somebody.
   */
  const value = option?.label ?? (typeof raw === 'string' && raw !== '' ? humaniseEnum(raw) : '…');

  const verb: Record<string, string> = {
    EQUALS: 'is',
    NOT_EQUALS: 'is not',
    CONTAINS: 'contains',
    GREATER_THAN: 'is more than',
    LESS_THAN: 'is less than',
    BEFORE: 'is before',
    AFTER: 'is after',
  };

  return [
    { text: `${label} ${verb[operator] ?? operator.toLowerCase()}` },
    { text: value, chip: true },
  ];
}

/** `IN_PROGRESS` -> `In progress`. Left alone when it is not an enum token. */
function humaniseEnum(value: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) return value;

  const words = value.toLowerCase().replace(/_/g, ' ');

  return words.charAt(0).toUpperCase() + words.slice(1);
}

function actionSummary(
  subtype: string,
  config: Record<string, unknown>,
  metadata: AutomationMetadata | undefined,
): SummarySegment[] {
  const label = ACTION_LABEL[subtype as AutomationAction] ?? subtype;

  const person = (id: unknown) => {
    if (typeof id !== 'string' || id === '') return null;
    return metadata?.members.find((member) => member.id === id)?.name ?? 'somebody who has left';
  };

  const section = (id: unknown) => {
    if (typeof id !== 'string' || id === '') return null;
    return (
      metadata?.sections.find((entry) => entry.id === id)?.name ?? 'a section that was removed'
    );
  };

  switch (subtype) {
    case 'ASSIGN_USER': {
      const who = person(config['userId']);
      return who
        ? [{ text: 'Assign to' }, { text: who, chip: true }]
        : [{ text: 'Assign — choose somebody' }];
    }

    case 'MOVE_TO_SECTION': {
      const where = section(config['sectionId']);
      return where
        ? [{ text: 'Move to' }, { text: where, chip: true }]
        : [{ text: 'Move — choose a section' }];
    }

    case 'UPDATE_STATUS': {
      // Canonical first, then the name this used to be written under, so a
      // rule saved before the two sides agreed still reads as itself.
      const status = config['status'] ?? config['statusDefinitionId'];
      const found = metadata?.statuses.find((entry) => entry.id === status)?.name;
      return found
        ? [{ text: 'Set status to' }, { text: found, chip: true }]
        : [{ text: 'Set status — choose one' }];
    }

    case 'UPDATE_PRIORITY': {
      const priority = config['priority'] ?? config['priorityDefinitionId'];
      const found = metadata?.priorities.find((entry) => entry.id === priority)?.name;
      return found
        ? [{ text: 'Set priority to' }, { text: found, chip: true }]
        : [{ text: 'Set priority — choose one' }];
    }

    case 'ADD_COMMENT': {
      const body = config['body'];
      return typeof body === 'string' && body.trim() !== ''
        ? [
            { text: 'Comment:' },
            { text: `“${body.slice(0, 40)}${body.length > 40 ? '…' : ''}”`, chip: true },
          ]
        : [{ text: 'Comment — write what it says' }];
    }

    default:
      return [{ text: label }];
  }
}

/** Whether a node is missing something it needs, for the badge on the card. */
export function isNodeIncomplete(node: CanvasNode): boolean {
  const config = node.configuration;
  const has = (key: string) => typeof config[key] === 'string' && config[key] !== '';

  /*
   * Category first, subtype second.
   *
   * Switching on subtype alone judged a condition by an action's rule whenever
   * the two happened to share a name — the check has to know what kind of step
   * it is looking at before it can know what that step needs.
   */
  // The trigger a new rule starts with, before anybody has said what it is.
  if (node.type === 'TRIGGER') return node.subtype === '';

  if (node.type === 'CONDITION') {
    if (!has('field') || !has('operator')) return true;

    const operator = config['operator'];
    const needsValue = operator !== 'IS_EMPTY' && operator !== 'IS_NOT_EMPTY';

    return needsValue && config['value'] === undefined;
  }

  if (node.type !== 'ACTION') return false;

  switch (node.subtype) {
    case 'ASSIGN_USER':
      return !has('userId');
    case 'MOVE_TO_SECTION':
      return !has('sectionId');
    case 'UPDATE_STATUS':
      return !has('statusDefinitionId') && !has('status');
    case 'UPDATE_PRIORITY':
      return !has('priorityDefinitionId') && !has('priority');
    case 'ADD_COMMENT':
      return !has('body');
    default:
      return false;
  }
}
