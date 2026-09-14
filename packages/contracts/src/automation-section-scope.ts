import { AutomationNodeType } from './automation.js';
import { TRIGGER_CONFIG_FORM, toFilterOperator } from './automation-rule.js';
import { FilterOperator } from './query.js';

/**
 * Which sections a rule belongs to, the way Asana's section lightning does it.
 *
 * A rule lives on a project; the lightning on a section header is a *view* of
 * the project's rules, showing the ones that are about that section. Asana
 * pins a rule to a section when the section is what the rule watches, and
 * that is what this reads — from two places, because CoreTask writes it in two:
 *
 * - the trigger, for "when a task moves into this section" (`sectionId`, or
 *   `sectionIds` for the any-of form);
 * - a "Section is…" condition, which is what a rule started from a section's
 *   lightning menu carries and keeps when its trigger is changed to something
 *   else — "when a task is completed, if its section is Review, …" is still a
 *   rule about Review.
 *
 * The second is the one that was missing. The list endpoint read only the
 * trigger, so the moment somebody changed a section rule's trigger the rule
 * vanished from the section it was made for while staying in the project list —
 * gone from where it was created, present where nobody looked.
 *
 * Negations do not count. "Section is not Done" is a rule about everywhere
 * except Done, and listing it under Done would be the opposite of what it says.
 * Actions do not count either: "move to Done" is what a rule *does*, and Asana
 * lists rules where they fire, not where they send things.
 */

/** The least a rule has to carry for its sections to be worked out. */
export interface SectionScopedRule {
  triggerConfig: unknown;
  nodes: readonly { nodeType: string; configuration: unknown }[];
}

/** The field key a condition uses to test a task's section. */
export const SECTION_CONDITION_FIELD = 'sectionId';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
  }

  const one = readId(value);
  return one ? [one] : [];
}

/** The sections a trigger names as where it fires. */
function sectionsFromTrigger(triggerConfig: unknown): string[] {
  const config = asRecord(triggerConfig);

  // The negated form names a section to exclude, not one to watch.
  if (config['form'] === TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO_NOT) return [];

  return [...readIds(config['sectionId']), ...readIds(config['sectionIds'])];
}

/**
 * The sections a condition requires the task to be in.
 *
 * Both spellings of equality, through the same translation the runner uses:
 * a rule built from a section's menu stores `EQUALS`, one written in the panel
 * stores `IS`, and both mean the section has to match.
 */
function sectionsFromCondition(configuration: unknown): string[] {
  const config = asRecord(configuration);
  if (config['field'] !== SECTION_CONDITION_FIELD) return [];

  const operator = toFilterOperator(readId(config['operator']));
  if (operator === FilterOperator.EQUALS || operator === FilterOperator.IN) {
    return readIds(config['value']);
  }

  return [];
}

/** Every section this rule is about, without repeats, in the order found. */
export function sectionsWatchedByRule(rule: SectionScopedRule): string[] {
  const found = new Set<string>(sectionsFromTrigger(rule.triggerConfig));

  for (const node of rule.nodes) {
    if (node.nodeType !== AutomationNodeType.CONDITION) continue;
    for (const id of sectionsFromCondition(node.configuration)) found.add(id);
  }

  return [...found];
}

/** Whether this rule belongs under the given section's lightning. */
export function ruleWatchesSection(rule: SectionScopedRule, sectionId: string): boolean {
  return sectionsWatchedByRule(rule).includes(sectionId);
}

/** The rules that belong under one section, keeping the order they came in. */
export function rulesForSection<T extends SectionScopedRule>(
  rules: readonly T[],
  sectionId: string,
): T[] {
  return rules.filter((rule) => ruleWatchesSection(rule, sectionId));
}
