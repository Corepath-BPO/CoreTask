import {
  ACTION_LABEL,
  NODE_CATEGORY_LABEL,
  TRIGGER_LABEL,
  AUTOMATION_VALUE_TOKEN_LABEL,
  isFallbackBranch,
  isTokenValue,
  operatorNeedsValue,
  toFilterOperator,
  type AutomationAction,
  type AutomationNodeType,
  type AutomationTrigger,
  type ConditionOperator,
  type FilterOperator,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';

import { readTriggerSections } from '../configuration/trigger-forms';

import { isUnansweredRow, type CanvasNode } from './graph-edits';

/**
 * How each trigger shape reads on a card.
 *
 * An em dash for the plain "moved into this one", because there is no verb to
 * say and "— Backlog" reads as a caption. The others need their verb or the
 * card claims the opposite of the rule.
 */
const TRIGGER_FORM_VERB: Readonly<Record<string, string>> = {
  SECTION_CHANGED_TO: '—',
  SECTION_CHANGED_TO_NOT: '— not',
  SECTION_CHANGED_TO_ANY_OF: '— one of',
};

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
/**
 * Where a step sits, for the words that depend on it.
 *
 * A branch row reads differently depending on which row it is: the first is the
 * rule's own question — "Check if the section is Incoming" — and every one after
 * it is an alternative to that question. Nothing on the node itself says which,
 * because being first is a fact about the rule rather than about the step, so
 * whoever draws the canvas has to say.
 *
 * Stated as "alternative" rather than "primary" so that leaving it out is the
 * safe answer: a caller with no view of the whole rule gets the wording every
 * condition had before rows existed, rather than every card claiming to be an
 * afterthought.
 */
export interface NodePlace {
  /** True for a branch row after the first — one somebody added as "otherwise if". */
  alternative?: boolean;
}

/**
 * What kind of step this is — which, for a branch, is a matter of where it sits.
 *
 * Only the first branch is the rule's question; every one after it is an
 * alternative to that question, and the last may be the case where none of them
 * held. So "Check if" belongs to one row per rule, and a second one appearing
 * would say two branches lead with the same question rather than that the second
 * is what to do when the first did not hold.
 *
 * Positional rather than stored, because it *is* positional: duplicate the first
 * branch and the copy is an "otherwise if" by virtue of no longer being first,
 * with nothing about the node itself having changed.
 */
export function nodeCategory(node: CanvasNode, place: NodePlace = {}): string {
  if (node.type === 'CONDITION') {
    // Whatever position it holds. A fallback is the case where nothing matched,
    // which is not a thing that can be asked first or last differently.
    if (isFallbackBranch(node.configuration)) return 'Otherwise';
    if (place.alternative) return 'Otherwise if';
  }

  return NODE_CATEGORY_LABEL[node.type as AutomationNodeType] ?? 'Add a step';
}

/**
 * The category line as the card prints it.
 *
 * The same words, except on a branch nobody has answered: there the sentence is
 * "+ Otherwise if…", and a line above it saying "Otherwise if" is the same words
 * twice on a card whose whole job is to be one line and an offer.
 */
export function nodeHeading(node: CanvasNode, place: NodePlace = {}): string {
  if (place.alternative && isUnansweredRow(node)) return '';

  return nodeCategory(node, place);
}

export function summariseParts(
  node: CanvasNode,
  metadata: AutomationMetadata | undefined,
  place: NodePlace = {},
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

      /*
       * The card says what was chosen, not just what kind of trigger it is.
       *
       * The trigger grew four shapes — changed, is, is not, is one of — and this
       * read a single `sectionId`, so three of them showed nothing at all. Two
       * rules that fire on completely different moves looked identical on the
       * canvas, which is the one place somebody checks a rule without opening
       * it.
       */
      const sections = readTriggerSections(config);
      const form = typeof config['form'] === 'string' ? (config['form'] as string) : '';

      if (sections.length === 0) return [{ text: label }];

      const named = sections.map((id) => name(metadata?.sections, id, 'any section'));

      // The form's own words, so "is not" does not read as "is" with a list.
      const verb = TRIGGER_FORM_VERB[form] ?? '—';

      return [{ text: label }, { text: verb }, { text: named.join(', '), chip: true }];
    }

    case 'CONDITION': {
      /*
       * The fallback says what it is for, because it has nothing to check.
       *
       * "Choose what to check" on this card would be asking for a comparison
       * that must never exist — the whole of what it means is "none of the
       * above", and the sentence is the only place that can say so.
       */
      if (isFallbackBranch(config)) return [{ text: 'If all other conditions are not met' }];

      const parts = conditionSummary(config, metadata);

      /*
       * A row nobody has answered yet reads as the offer it is.
       *
       * "Check if — choose what to check" is right for the rule's first
       * question and wrong for the rest: those were added by pressing
       * "Otherwise if…", and a card that forgets the word somebody clicked
       * makes the second branch look like a duplicate of the first.
       */
      return place.alternative && parts.length === 1 && parts[0]!.text === 'Choose what to check'
        ? [{ text: '+ Otherwise if…' }]
        : parts;
    }

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
export function summarise(
  node: CanvasNode,
  metadata: AutomationMetadata | undefined,
  place: NodePlace = {},
): string {
  return summariseParts(node, metadata, place)
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

  /*
   * A name, never the stored key.
   *
   * The metadata arrives after the first paint, so for one frame `definition`
   * is undefined and the card read "sectionId is 019fc8d5-5370-…" — the rule
   * showing its plumbing to somebody who has just opened it. The fallbacks
   * cover the fields a rule can actually hold; anything else is humanised
   * rather than printed raw.
   */
  const label = definition?.label ?? SYSTEM_FIELD_LABEL[field] ?? humaniseEnum(field);

  if (typeof operator !== 'string' || operator === '') return [{ text: `${label} …` }];

  // An emptiness check reads as a sentence on its own; anything else needs the
  // value it is being compared against.
  if (operator === 'IS_EMPTY') return [{ text: `${label} is empty` }];
  if (operator === 'IS_NOT_EMPTY') return [{ text: `${label} is set` }];

  const raw = config['value'];

  /*
   * "Is one of" holds a list, and the card has to name what is in it.
   *
   * Matched against the same options the panel chose from, so the card says
   * "Incoming Request" where the configuration holds an id. An unmatched entry
   * keeps its humanised token rather than being dropped: a chip missing from
   * the card is somebody believing their rule checks two sections when it
   * checks three.
   */
  if (Array.isArray(raw)) {
    const chips = raw
      .filter((entry): entry is string => typeof entry === 'string' && entry !== '')
      .map((entry) => ({
        text:
          definition?.options?.find((option) => option.value === entry)?.label ??
          readableValue(entry),
        chip: true,
      }));

    return [
      { text: `${label} ${conditionVerb(operator)}` },
      ...(chips.length > 0 ? chips : [{ text: '…', chip: true }]),
    ];
  }

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
  const value = option?.label ?? readableValue(raw);

  return [{ text: `${label} ${conditionVerb(operator)}` }, { text: value, chip: true }];
}

/**
 * How an operator reads on a card, in either vocabulary.
 *
 * The builder writes `IS_ONE_OF` and older rules hold `IN`; both are one verb.
 * Keyed on the comparison rather than the spelling so a card never falls back
 * to printing the key — "Section is_one_of" is the card showing its wiring.
 */
function conditionVerb(operator: string): string {
  const verb: Partial<Record<FilterOperator, string>> = {
    EQUALS: 'is',
    NOT_EQUALS: 'is not',
    CONTAINS: 'contains',
    NOT_CONTAINS: 'does not contain',
    IN: 'is one of',
    NOT_IN: 'is not one of',
    GREATER_THAN: 'is more than',
    LESS_THAN: 'is less than',
    BEFORE: 'is before',
    AFTER: 'is after',
  };

  const comparison = toFilterOperator(operator);

  return (comparison && verb[comparison]) ?? operator.toLowerCase().replace(/_/g, ' ');
}

/**
 * What the fields a rule can hold are called, before the metadata says.
 *
 * Only the ones a condition is written against. Anything outside this list is
 * humanised instead, which is still a word rather than a key.
 */
const SYSTEM_FIELD_LABEL: Record<string, string> = {
  sectionId: 'Section',
  status: 'Status',
  priority: 'Priority',
  assigneeId: 'Assignee',
  dueDate: 'Due date',
  startDate: 'Start date',
  title: 'Title',
};

/**
 * A value somebody can read, or an ellipsis promising one.
 *
 * An id is never shown. Until the metadata arrives there is nothing to match it
 * against, and "Section is 019fc8d5-5370-7593" is a card that has told somebody
 * nothing and looks broken doing it — the ellipsis at least reads as loading.
 */
function readableValue(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '…';

  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw) ? '…' : humaniseEnum(raw);
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

    case 'SET_CUSTOM_FIELD': {
      /*
       * Which field, and what to — not "set a custom field".
       *
       * Every one of these actions shares a subtype, so the generic label made
       * three of them on one rule indistinguishable. The field's own name is
       * the only thing that tells them apart, and the value is what somebody
       * came to the card to check.
       */
      const fieldId = config['fieldId'] ?? config['customFieldId'];
      const field = metadata?.customFields.find((entry) => entry.id === fieldId);

      if (!field) return [{ text: 'Set a field — choose one' }];

      const raw = config['value'];

      /*
       * A computed value reads as the sentence it is.
       *
       * `String({ token: 'TRIGGER_DATE' })` is "[object Object]", so without
       * this the card announced the shape of the configuration instead of what
       * the rule does.
       */
      if (isTokenValue(raw)) {
        return [
          { text: `Set ${field.name} to` },
          { text: AUTOMATION_VALUE_TOKEN_LABEL[raw.token], chip: true },
        ];
      }

      const chosen = Array.isArray(raw) ? raw.map(String) : raw === undefined ? [] : [String(raw)];

      // Options resolve to their labels; everything else is already readable.
      const shown = chosen.map(
        (value) => field.options?.find((option) => option.id === value)?.label ?? value,
      );

      if (shown.length === 0) return [{ text: `Set ${field.name} — choose a value` }];

      return [{ text: `Set ${field.name} to` }, { text: shown.join(', '), chip: true }];
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
    /*
     * The fallback has nothing to answer, so it can never be unanswered.
     *
     * Flagged, it would put a red border and a warning on the one row that is
     * complete by definition — and the count beside Publish would insist on a
     * comparison that must never be set.
     */
    if (isFallbackBranch(config)) return false;

    if (!has('field') || !has('operator')) return true;

    const value = config['value'];

    if (!operatorNeedsValue(config['operator'] as ConditionOperator)) return false;

    /*
     * An empty list counts as unanswered.
     *
     * "Is one of" writes `[]` when somebody opens the picker and chooses
     * nothing, which is not `undefined` — so the card read as complete and the
     * rule published a comparison against no sections, matching nothing for
     * ever without a word.
     */
    if (Array.isArray(value)) return value.length === 0;

    return value === undefined || value === null || value === '';
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
