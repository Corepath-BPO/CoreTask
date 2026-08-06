import {
  AutomationBranchType,
  AutomationNodeType,
  BranchKey,
  CONDITION_OPERATOR,
  ConditionGroupOperator,
  FilterOperator,
  type ConditionOperator,
} from '@coretask/contracts';
import type {
  AutomationActionDefinition,
  AutomationBranchDefinition,
  AutomationConditionDefinition,
  AutomationConditionGroupDefinition,
  AutomationTriggerDefinition,
} from '@coretask/types';

/**
 * The node tree read as an ordered list of branches — Phase 2 of the rebuild.
 *
 * Every rule in production is still a tree of `automation_nodes`, and the
 * structured tables start empty. Something has to say what an existing rule
 * means in the new vocabulary, and it has to say it the same way every time:
 * this runs on the first read of a rule's draft, so a rule that has never been
 * opened in the new builder still opens showing what it does rather than a
 * blank canvas.
 *
 * Deliberately pure. It reads no database and mints no ids of its own — the id
 * factory is a parameter — so the conversion of every legacy shape can be
 * asserted directly rather than inferred from what came back from an endpoint.
 * The shapes it has to get right are exactly the ones nobody can create any
 * more, which makes an integration test the worst possible place to pin them.
 */

/** A stored node, in the only fields the conversion reads. */
export interface LegacyNode {
  id: string;
  nodeType: string;
  subtype: string;
  configuration: Record<string, unknown> | null;
  parentNodeId: string | null;
  branchKey: string | null;
  position: number;
}

/** The rule's own trigger columns, used when the tree has no `TRIGGER` node. */
export interface LegacyRuleTrigger {
  triggerType: string;
  triggerConfig: Record<string, unknown> | null;
}

export interface LegacyConversion {
  trigger: AutomationTriggerDefinition;
  branches: AutomationBranchDefinition[];
  /**
   * What the branch list could not say exactly, in the words of the rule.
   *
   * Recorded rather than thrown, because a conversion that refuses leaves the
   * builder with nothing to open; recorded rather than dropped, because a rule
   * that quietly means something new after conversion is the one failure this
   * whole phased plan exists to avoid.
   */
  notes: string[];
}

/** Generates the ids the definition needs. Injected so tests can predict them. */
export type IdFactory = () => string;

/**
 * The comparisons the tree could express, in the vocabulary the branches use.
 *
 * The two operator sets are not a rename of one another — `FilterOperator`
 * belongs to saved-view filters, which is where the node conditions borrowed
 * it, and `CONDITION_OPERATOR` is the wider set the rule builder offers. An
 * unmapped operator is passed through untouched rather than guessed at, so it
 * surfaces as an operator nothing understands at publish time instead of being
 * silently rewritten into a comparison the rule never made.
 */
const OPERATOR_FROM_LEGACY: Readonly<Record<string, ConditionOperator>> = {
  [FilterOperator.EQUALS]: CONDITION_OPERATOR.IS,
  [FilterOperator.NOT_EQUALS]: CONDITION_OPERATOR.IS_NOT,
  [FilterOperator.CONTAINS]: CONDITION_OPERATOR.CONTAINS,
  [FilterOperator.NOT_CONTAINS]: CONDITION_OPERATOR.DOES_NOT_CONTAIN,
  [FilterOperator.IS_EMPTY]: CONDITION_OPERATOR.IS_EMPTY,
  [FilterOperator.IS_NOT_EMPTY]: CONDITION_OPERATOR.IS_NOT_EMPTY,
  [FilterOperator.IN]: CONDITION_OPERATOR.IS_ONE_OF,
  [FilterOperator.NOT_IN]: CONDITION_OPERATOR.IS_NOT_ONE_OF,
  [FilterOperator.GREATER_THAN]: CONDITION_OPERATOR.GREATER_THAN,
  [FilterOperator.GREATER_THAN_OR_EQUAL]: CONDITION_OPERATOR.GREATER_THAN_OR_EQUAL,
  [FilterOperator.LESS_THAN]: CONDITION_OPERATOR.LESS_THAN,
  [FilterOperator.LESS_THAN_OR_EQUAL]: CONDITION_OPERATOR.LESS_THAN_OR_EQUAL,
  [FilterOperator.BEFORE]: CONDITION_OPERATOR.IS_BEFORE,
  [FilterOperator.AFTER]: CONDITION_OPERATOR.IS_AFTER,
};

/** The wording of each loss, named once so a nested rule does not repeat it. */
const NOTE = {
  NO_TRIGGER: 'This rule has no trigger step, so its branches could not be read.',
  DELAY_DROPPED: 'A delay step was dropped — the rule builder has no waiting step.',
  NESTED_BRANCH:
    'A branch nested inside another branch’s “matched” arm could not be kept, so its own ' +
    'alternatives were dropped.',
  FOLDED_CONDITION:
    'A condition placed after a branch was folded into that branch’s own conditions, which ' +
    'changes what runs when it does not hold.',
  DROPPED_SIBLINGS:
    'Steps placed beside a branch rather than on one of its arms were dropped — a branch ends ' +
    'the path it sits on.',
} as const;

/** A comparison as it sits on a `CONDITION` or `BRANCH` node. */
interface LegacyComparison {
  fieldKey: string;
  operator: string;
  value: unknown;
}

/** What one arm holds before the next decision point. */
interface ArmContents {
  conditions: LegacyComparison[];
  actions: AutomationActionDefinition[];
  /** The next `BRANCH` node on this arm, if the arm reaches one. */
  branch: LegacyNode | null;
}

/**
 * Converts one rule's node tree into a trigger and an ordered list of branches.
 *
 * @param nodes every node of the rule, in any order — ordering is taken from
 *              `position`, since that is what the runner walks.
 * @param rule  the rule's own trigger columns, used only as a fallback.
 * @param newId mints the ids the definition rows will carry.
 */
export function convertLegacyRule(
  nodes: readonly LegacyNode[],
  rule: LegacyRuleTrigger,
  newId: IdFactory,
): LegacyConversion {
  const notes = new Set<string>();
  const trigger = triggerFrom(nodes, rule);

  if (nodes.some((node) => node.nodeType === AutomationNodeType.DELAY)) {
    /*
     * `DELAY` is in the node enum, nothing executes it, and the branch model
     * has no waiting step. Dropping it silently would turn a rule that looks
     * like it pauses into one that runs straight through.
     */
    notes.add(NOTE.DELAY_DROPPED);
  }

  /*
   * One non-null parent link makes the whole rule a tree — the same test the
   * runner makes. Reading it any other way would mean the converter and the
   * runner disagreeing about what a rule is, which is the drift a conversion
   * exists to rule out.
   */
  const isTree = nodes.some((node) => node.parentNodeId !== null);

  const branches = isTree ? convertTree(nodes, notes, newId) : convertFlat(nodes, newId);

  return { trigger, branches, notes: [...notes] };
}

/* -------------------------------------------------------------------------- */
/* Trigger                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The `TRIGGER` node wins over the rule's columns.
 *
 * `triggerType` on the rule row is a denormalisation kept for the matcher's
 * indexed query, and the two have been able to disagree — a builder that saved
 * a changed trigger as part of the canvas left the row behind. The node is what
 * somebody edited, so it is what the conversion believes; the columns are what
 * is left when a rule has no trigger node at all.
 */
function triggerFrom(
  nodes: readonly LegacyNode[],
  rule: LegacyRuleTrigger,
): AutomationTriggerDefinition {
  const node = ordered(nodes).find((it) => it.nodeType === AutomationNodeType.TRIGGER);

  if (!node) {
    return { type: rule.triggerType, configuration: rule.triggerConfig ?? {} };
  }

  return { type: node.subtype, configuration: node.configuration ?? {} };
}

/* -------------------------------------------------------------------------- */
/* Flat rules                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A rule with no parentage: one branch, its conditions ANDed, its actions in
 * order.
 *
 * `ALL` rather than `ANY` because that is what the runner does with a flat rule
 * — it looks for the first condition that does not hold and stops — so any
 * other group operator would change what the rule does on its first read.
 */
function convertFlat(nodes: readonly LegacyNode[], newId: IdFactory): AutomationBranchDefinition[] {
  const conditions = ordered(nodes)
    .filter((node) => node.nodeType === AutomationNodeType.CONDITION)
    .map(comparisonOf);

  const actions = ordered(nodes)
    .filter((node) => node.nodeType === AutomationNodeType.ACTION)
    .map((node) => actionOf(node, newId));

  return [primaryBranch(conditions, actions, newId)];
}

/* -------------------------------------------------------------------------- */
/* Tree rules                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A branch chain read as the ordered alternatives it always was.
 *
 * The chain is the point of the rebuild: nesting a branch inside the previous
 * one's else arm is how "otherwise if" had to be built, and this walks that
 * nesting back out into the list the model now has.
 *
 * Two things are carried down the chain rather than left where they were found.
 * A condition sitting on an arm gates everything below it, so it is ANDed into
 * every branch from that point on — `OTHERWISE_IF { gate ∧ c }` is reached
 * exactly when the gate held and nothing above it matched, which is what the
 * tree meant. Actions sitting on an arm before the next branch ran
 * unconditionally, so they are prepended to every branch from that point on,
 * for the same reason.
 */
function convertTree(
  nodes: readonly LegacyNode[],
  notes: Set<string>,
  newId: IdFactory,
): AutomationBranchDefinition[] {
  const trigger = ordered(nodes).find((node) => node.nodeType === AutomationNodeType.TRIGGER);

  if (!trigger) {
    /*
     * A tree with no root cannot be walked, and inventing one would invent a
     * rule. Reported as one empty branch, which reads in the builder as an
     * unfinished rule — which is what it is.
     */
    notes.add(NOTE.NO_TRIGGER);
    return [primaryBranch([], [], newId)];
  }

  const branches: AutomationBranchDefinition[] = [];

  /* What the walk has already required and already done on the way down. */
  let gate: LegacyComparison[] = [];
  let prelude: AutomationActionDefinition[] = [];

  let arm = armFrom(nodes, trigger.id, null, notes, newId);

  /* A tree that never reaches a branch is a flat rule that happens to be
   * chained: one branch holding everything the walk passed. */
  if (!arm.branch) {
    return [primaryBranch(arm.conditions, arm.actions, newId)];
  }

  while (arm.branch !== null) {
    const branchNode = arm.branch;

    gate = [...gate, ...arm.conditions];
    prelude = [...prelude, ...arm.actions];

    const matched = armFrom(nodes, branchNode.id, BranchKey.MATCH, notes, newId);

    /*
     * A branch nested on the *match* arm is a decision inside a decision, and a
     * flat list of alternatives has nowhere to put it.
     */
    if (matched.branch) notes.add(NOTE.NESTED_BRANCH);

    /*
     * A condition after a branch is folded in as an approximation, and the loss
     * is named: the two differ only once there is something below to fall
     * through to. With no chain, `PRIMARY { c ∧ m }` is exactly what the tree
     * did; with one, the tree ran nothing where the list moves on.
     */
    if (matched.conditions.length > 0) notes.add(NOTE.FOLDED_CONDITION);

    branches.push({
      id: newId(),
      type:
        branches.length === 0 ? AutomationBranchType.PRIMARY : AutomationBranchType.OTHERWISE_IF,
      position: branches.length,
      conditionGroup: groupOf([...gate, comparisonOf(branchNode), ...matched.conditions], newId),
      actions: renumber([...prelude, ...matched.actions]),
    });

    const next = armFrom(nodes, branchNode.id, BranchKey.ELSE, notes, newId);

    if (next.branch === null) {
      appendFallback(branches, [...gate, ...next.conditions], [...prelude, ...next.actions], newId);
      break;
    }

    arm = next;
  }

  return branches;
}

/**
 * The end of the chain.
 *
 * An else arm holding actions is the fallback the model calls `OTHERWISE` —
 * unless something gated the chain, in which case the fallback still has a
 * condition to meet and has to stay an `OTHERWISE_IF`. `OTHERWISE` runs when
 * nothing above matched, full stop, and would fire on tasks the tree never
 * touched.
 */
function appendFallback(
  branches: AutomationBranchDefinition[],
  gate: readonly LegacyComparison[],
  actions: readonly AutomationActionDefinition[],
  newId: IdFactory,
): void {
  if (actions.length === 0) return;

  branches.push({
    id: newId(),
    type: gate.length > 0 ? AutomationBranchType.OTHERWISE_IF : AutomationBranchType.OTHERWISE,
    position: branches.length,
    conditionGroup: gate.length > 0 ? groupOf(gate, newId) : null,
    actions: renumber(actions),
  });
}

/**
 * Everything on one arm up to its next branch, in the order the runner walks it.
 *
 * Mirrors the runner's own walk: children filtered by parent, then by arm, then
 * sorted by `position`. A node whose `branchKey` does not match the arm is not
 * reachable there, which is why an arm has to be asked for by name rather than
 * taken as "all children".
 */
function armFrom(
  nodes: readonly LegacyNode[],
  parentId: string,
  arm: string | null,
  notes: Set<string>,
  newId: IdFactory,
): ArmContents {
  const found: ArmContents = { conditions: [], actions: [], branch: null };

  /* Depth-limited for the same reason the runner is: these rows may have been
   * written by an older client, and a cycle here would hang the request rather
   * than produce a wrong answer. */
  const walk = (fromId: string, key: string | null, depth: number): void => {
    if (depth > 50 || found.branch !== null) return;

    const children = ordered(nodes)
      .filter((node) => node.parentNodeId === fromId)
      .filter((node) => (key === null ? true : node.branchKey === key));

    for (const [index, node] of children.entries()) {
      if (found.branch !== null) return;

      if (node.nodeType === AutomationNodeType.BRANCH) {
        found.branch = node;

        /* A branch ends the path it sits on, so anything after it here is
         * unreachable in the list model even though the runner would have run
         * it. Named rather than dropped in silence. */
        if (index < children.length - 1) notes.add(NOTE.DROPPED_SIBLINGS);

        return;
      }

      if (node.nodeType === AutomationNodeType.CONDITION) {
        found.conditions.push(comparisonOf(node));
        walk(node.id, null, depth + 1);
        continue;
      }

      if (node.nodeType === AutomationNodeType.ACTION) {
        found.actions.push(actionOf(node, newId));
        walk(node.id, null, depth + 1);
      }
    }
  };

  walk(parentId, arm, 0);

  return found;
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

function primaryBranch(
  conditions: readonly LegacyComparison[],
  actions: readonly AutomationActionDefinition[],
  newId: IdFactory,
): AutomationBranchDefinition {
  return {
    id: newId(),
    type: AutomationBranchType.PRIMARY,
    position: 0,
    conditionGroup: groupOf(conditions, newId),
    actions: renumber(actions),
  };
}

/**
 * A group, or nothing at all when there is nothing to compare.
 *
 * An empty `ALL` group and no group are both unpublishable, but they say
 * different things: no group is "this branch has not been given a condition
 * yet", which is what a legacy rule with no condition nodes actually is. An
 * empty group would claim somebody had started one.
 */
function groupOf(
  comparisons: readonly LegacyComparison[],
  newId: IdFactory,
): AutomationConditionGroupDefinition | null {
  if (comparisons.length === 0) return null;

  return {
    id: newId(),
    operator: ConditionGroupOperator.ALL,
    conditions: comparisons.map((comparison, index): AutomationConditionDefinition => ({
      id: newId(),
      fieldKey: comparison.fieldKey,
      operator: comparison.operator,
      value: comparison.value,
      position: index,
    })),
  };
}

/**
 * One node's comparison.
 *
 * `field` falls back to the subtype because the runner reads it that way: a
 * condition saved as `subtype: 'priority'` with no `field` in its configuration
 * compares the priority, and converting it to a condition on a field called
 * nothing would quietly stop it matching.
 */
function comparisonOf(node: LegacyNode): LegacyComparison {
  const config = node.configuration ?? {};
  const field = config['field'];
  const operator = typeof config['operator'] === 'string' ? config['operator'] : '';

  return {
    fieldKey: typeof field === 'string' && field !== '' ? field : node.subtype,
    operator: OPERATOR_FROM_LEGACY[operator] ?? operator,
    value: config['value'] ?? null,
  };
}

function actionOf(node: LegacyNode, newId: IdFactory): AutomationActionDefinition {
  return {
    id: newId(),
    actionType: node.subtype,
    configuration: node.configuration ?? {},
    /* Overwritten by `renumber` once the branch it belongs to is known. */
    position: 0,
  };
}

/**
 * Positions come from the list, not from the rows.
 *
 * A legacy `position` is a float chosen for a tree and shared across arms, so
 * carrying it over would give a branch actions numbered 3 and 7 — which the
 * contiguity invariant refuses and the unique index cannot express.
 */
function renumber(actions: readonly AutomationActionDefinition[]): AutomationActionDefinition[] {
  return actions.map((action, index) => ({ ...action, position: index }));
}

/** Sorted by `position`, because the array order of a query result means nothing. */
function ordered(nodes: readonly LegacyNode[]): LegacyNode[] {
  return [...nodes].sort((a, b) => a.position - b.position);
}
