import {
  AUTOMATION_BRANCH_TYPE_VALUES,
  AUTOMATION_RULE_NAME_MODE_VALUES,
  AutomationBranchType,
  CONDITION_GROUP_OPERATOR_VALUES,
  ConditionGroupOperator,
  GraphIssueLevel,
  MAX_ACTIONS_PER_EXECUTION,
  type AutomationRuleNameMode,
  type AutomationBranchType as BranchType,
  type ConditionGroupOperator as GroupOperator,
} from '@coretask/contracts';
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Wire schemas                                                                */
/* -------------------------------------------------------------------------- */

const branchType = z.enum(AUTOMATION_BRANCH_TYPE_VALUES as [BranchType, ...BranchType[]]);
const groupOperator = z.enum(
  CONDITION_GROUP_OPERATOR_VALUES as [GroupOperator, ...GroupOperator[]],
);
const nameMode = z.enum(
  AUTOMATION_RULE_NAME_MODE_VALUES as [AutomationRuleNameMode, ...AutomationRuleNameMode[]],
);

/**
 * An ordinal, not a fractional position.
 *
 * Branches, conditions and actions are short ordered lists with a unique index
 * on `(parent, position)`, so reordering renumbers the list rather than
 * inserting at a midpoint. A negative or fractional value could not satisfy
 * that index and would fail at the write instead of here.
 */
const position = z.number().int().min(0);

export const saveRuleConditionSchema = z.object({
  id: z.string().min(1).max(64),
  fieldKey: z.string().trim().min(1).max(120),
  operator: z.string().trim().min(1).max(40),
  /*
   * Unknown here, checked in the API.
   *
   * What a valid value looks like depends on the field it compares against — a
   * section id has to be a section of this project, a person has to still be in
   * the workspace — and none of that is knowable without the database. Guessing
   * a shape at this layer would mean either refusing values that are fine or
   * accepting ones the runner cannot use.
   */
  value: z.unknown(),
  position,
});

export const saveRuleConditionGroupSchema = z.object({
  id: z.string().min(1).max(64),
  operator: groupOperator.default(ConditionGroupOperator.ALL),
  /* A branch nobody can read is a branch nobody can maintain. */
  conditions: z.array(saveRuleConditionSchema).max(20),
});

export const saveRuleActionSchema = z.object({
  id: z.string().min(1).max(64),
  actionType: z.string().trim().min(1).max(60),
  /* Validated per action type in the API, for the same reason `value` is. */
  configuration: z.record(z.string(), z.unknown()).default({}),
  position,
});

export const saveRuleBranchSchema = z.object({
  id: z.string().min(1).max(64),
  type: branchType,
  position,
  conditionGroup: saveRuleConditionGroupSchema.nullish(),
  /*
   * Capped at what one execution may perform: a branch holding more actions
   * than the runner will ever get through is a rule that silently stops
   * part-way, which is worse than one that would not save.
   */
  actions: z.array(saveRuleActionSchema).max(MAX_ACTIONS_PER_EXECUTION),
});

export const saveRuleDefinitionSchema = z.object({
  name: z.string().trim().min(1, 'Give the rule a name').max(120),
  description: z.string().max(2000).nullish(),
  nameMode: nameMode.optional(),
  trigger: z.object({
    type: z.string().trim().min(1).max(60),
    configuration: z.record(z.string(), z.unknown()).default({}),
  }),
  branches: z.array(saveRuleBranchSchema).max(20),
});

export type SaveRuleConditionInput = z.infer<typeof saveRuleConditionSchema>;
export type SaveRuleConditionGroupInput = z.infer<typeof saveRuleConditionGroupSchema>;
export type SaveRuleActionInput = z.infer<typeof saveRuleActionSchema>;
export type SaveRuleBranchInput = z.infer<typeof saveRuleBranchSchema>;
export type SaveRuleDefinitionInput = z.infer<typeof saveRuleDefinitionSchema>;

/* -------------------------------------------------------------------------- */
/* Structural validation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One thing wrong with a rule.
 *
 * Deliberately the same shape as the graph validator's issue so a single list
 * renders both while rules are migrated. `nodeId` carries a branch id here
 * rather than a node id — the field is the thing the issue is *about*, and
 * renaming it would break the one renderer this shape exists to allow.
 */
export interface RuleIssue {
  level: (typeof GraphIssueLevel)[keyof typeof GraphIssueLevel];
  nodeId: string | null;
  path: string | null;
  message: string;
}

interface ValidatableCondition {
  position: number;
}

interface ValidatableConditionGroup {
  conditions: readonly ValidatableCondition[];
}

interface ValidatableAction {
  position: number;
}

interface ValidatableBranch {
  id: string;
  /* A string rather than the union, so a Prisma row and a wire payload both fit. */
  type: string;
  position: number;
  conditionGroup?: ValidatableConditionGroup | null;
  actions: readonly ValidatableAction[];
}

interface ValidatableRuleDefinition {
  name: string | null | undefined;
  trigger?: { type: string | null | undefined } | null;
  branches: readonly ValidatableBranch[];
}

/**
 * Everything wrong with a rule's *shape*, independent of the project.
 *
 * Deliberately not the whole story: whether a section still exists, whether a
 * member is still in the workspace, and whether an operator suits the field it
 * compares against all need metadata this layer does not have, and live in the
 * API's validator. This half runs identically on both sides so the builder can
 * grey out Publish for the same reasons the server would refuse it, without a
 * round trip per keystroke.
 */
export function validateRuleDefinition(definition: ValidatableRuleDefinition): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const error = (message: string, nodeId: string | null = null, path: string | null = null) =>
    issues.push({ level: GraphIssueLevel.ERROR, nodeId, path, message });

  const { name, trigger, branches } = definition;

  if (!name || name.trim() === '') {
    error('Give the rule a name.');
  }

  if (!trigger || !trigger.type || trigger.type.trim() === '') {
    error('Choose what starts this rule.', null, 'trigger');
  }

  if (branches.length === 0) {
    error('Add at least one branch.', null, 'branches');
    return issues;
  }

  /*
   * Order is asked of `position`, not of the array.
   *
   * Position is what the database indexes and what the runner walks, so "which
   * branch is first" is a question about the number. A client that serialises
   * its branches in some other order is still saving a rule that runs correctly,
   * and failing it here would report a fault that does not exist.
   */
  const ordered = [...branches].sort((a, b) => a.position - b.position);

  validateBranchTypes(ordered, error);

  if (!positionsAreSequential(ordered.map((branch) => branch.position))) {
    error('These branches are not in a valid order.', null, 'branches');
  }

  for (const branch of ordered) {
    validateBranchContents(branch, error);
  }

  return issues;
}

type ReportError = (message: string, nodeId?: string | null, path?: string | null) => void;

/**
 * Which branch types may appear, how many of each, and where.
 *
 * Every rule here exists to keep "which branch runs" answerable by reading the
 * list top to bottom. An `OTHERWISE` anywhere but last would have alternatives
 * beneath a branch that already catches everything, and those alternatives
 * would be dead code the builder had drawn as live.
 */
function validateBranchTypes(ordered: readonly ValidatableBranch[], error: ReportError): void {
  const primaries = ordered.filter((branch) => branch.type === AutomationBranchType.PRIMARY);
  const otherwises = ordered.filter((branch) => branch.type === AutomationBranchType.OTHERWISE);

  if (primaries.length === 0) {
    error('A rule has to start with a “Check if” branch.', null, 'branches');
  }

  if (primaries.length > 1) {
    error('A rule can only have one “Check if” branch.', primaries[1]?.id ?? null);
  }

  if (primaries.length > 0 && ordered[0]?.type !== AutomationBranchType.PRIMARY) {
    error('The “Check if” branch has to come first.', primaries[0]?.id ?? null);
  }

  if (otherwises.length > 1) {
    error('A rule can only have one “Otherwise” branch.', otherwises[1]?.id ?? null);
  }

  const last = ordered[ordered.length - 1];
  if (otherwises.length > 0 && last?.type !== AutomationBranchType.OTHERWISE) {
    error('The “Otherwise” branch has to come last.', otherwises[0]?.id ?? null);
  }
}

/** A branch's own conditions and actions. */
function validateBranchContents(branch: ValidatableBranch, error: ReportError): void {
  const group = branch.conditionGroup ?? null;

  if (branch.type === AutomationBranchType.OTHERWISE) {
    /*
     * "Otherwise" is defined by the branches above it, so a condition of its own
     * would make it a second `OTHERWISE_IF` wearing the wrong label — and the
     * runner, which reaches it by exhausting the list, would never test that
     * condition at all.
     */
    if (group !== null) {
      error(
        '“Otherwise” runs when nothing else matched, so it cannot have its own conditions.',
        branch.id,
        'conditionGroup',
      );
    }
  } else if (group === null) {
    error('Choose what this branch checks for.', branch.id, 'conditionGroup');
  } else if (group.conditions.length === 0) {
    error('Add at least one condition to this branch.', branch.id, 'conditionGroup.conditions');
  }

  if (group !== null && !positionsAreSequential(group.conditions.map((it) => it.position))) {
    error(
      'The conditions in this branch are not in a valid order.',
      branch.id,
      'conditionGroup.conditions',
    );
  }

  /*
   * A branch that matches and then does nothing is indistinguishable at runtime
   * from one that never matched, so it can only ever be an unfinished edit.
   */
  if (branch.actions.length === 0) {
    error('Add at least one action to this branch.', branch.id, 'actions');
  }

  if (!positionsAreSequential(branch.actions.map((action) => action.position))) {
    error('The actions in this branch are not in a valid order.', branch.id, 'actions');
  }
}

/**
 * Whether a list's positions are exactly 0…n-1.
 *
 * Catches a duplicate and a gap with one check, because both come from the same
 * failure — a reorder that wrote some rows and not others. A duplicate breaks
 * the unique index outright; a gap does not, and would leave the rule quietly
 * running its steps in an order nobody chose.
 */
function positionsAreSequential(positions: readonly number[]): boolean {
  return [...positions].sort((a, b) => a - b).every((value, index) => value === index);
}
