import type {
  AutomationBranchType,
  AutomationRuleNameMode,
  AutomationRuleStatus,
  ConditionGroupOperator,
} from '@coretask/contracts';

/**
 * A rule as the builder loads and saves it: a trigger and ordered branches.
 *
 * This is the same shape the `automation_rule_versions` tables hold, which is
 * the point — the canvas is a projection of the rule rather than the rule
 * itself, so branch `n` draws on row `n` and reordering is a change to one
 * number rather than a rewrite of what connects to what.
 */

/**
 * What starts a rule, and how that event is narrowed.
 *
 * `type` is a member of `AutomationTrigger` but typed as a string, because the
 * runner matches it against a database column: a rule saved before a trigger
 * was renamed still has to load and report itself as unrunnable rather than
 * fail to deserialise.
 */
export interface AutomationTriggerDefinition {
  type: string;
  /** Trigger scoping — the chosen form and its section ids, and so on. */
  configuration: Record<string, unknown>;
}

/** One comparison inside a group. */
export interface AutomationConditionDefinition {
  id: string;
  /** What is being compared — `status`, `sectionId`, `customField:<id>`. */
  fieldKey: string;
  operator: string;
  /**
   * Shape follows the operator: a scalar, a list for the `one of` forms, and
   * null for the ones that carry their whole question in the operator.
   */
  value: unknown;
  /** Ordinal within the group. Contiguous from zero. */
  position: number;
}

export interface AutomationConditionGroupDefinition {
  id: string;
  operator: ConditionGroupOperator;
  conditions: AutomationConditionDefinition[];
}

/** One thing a branch does, in the order it does it. */
export interface AutomationActionDefinition {
  id: string;
  actionType: string;
  configuration: Record<string, unknown>;
  /** Ordinal within the branch. Contiguous from zero. */
  position: number;
}

export interface AutomationBranchDefinition {
  id: string;
  type: AutomationBranchType;
  /** Ordinal within the rule. Contiguous from zero, and PRIMARY holds zero. */
  position: number;
  /** Null on OTHERWISE, which is chosen by nothing above it having matched. */
  conditionGroup: AutomationConditionGroupDefinition | null;
  actions: AutomationActionDefinition[];
}

export interface AutomationRuleDefinition {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: AutomationRuleStatus;
  nameMode: AutomationRuleNameMode;
  /** The number of the version being edited. */
  version: number;
  /**
   * The number of the version currently running, null until first publish.
   *
   * Separate from `version` because editing a live rule must not change what it
   * does: while a draft is being written these two differ, and that difference
   * is what the header's "unpublished changes" state is derived from.
   */
  publishedVersion: number | null;
  trigger: AutomationTriggerDefinition;
  branches: AutomationBranchDefinition[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
