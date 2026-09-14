import {
  AUTOMATION_NODE_TYPES,
  AutomationEdgeKind,
  AutomationNodeType,
  BranchKey,
  GraphIssueLevel,
  isFallbackBranch,
  DIRECT_OPERATOR_VALUE_KIND,
  isDirectOperator,
  OPERATORS_BY_VALUE_KIND,
  operatorNeedsValue,
  operatorTakesValue,
  toFilterOperator,
  PLACEHOLDER_NODE_TYPE,
  type FilterOperator,
  type AutomationNodeType as NodeType,
  type ConditionValueKind,
} from '@coretask/contracts';
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Wire schemas                                                                */
/* -------------------------------------------------------------------------- */

const nodeType = z.enum(AUTOMATION_NODE_TYPES as [NodeType, ...NodeType[]]);

export const saveGraphNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: nodeType,
  subtype: z.string().trim().min(1).max(60),
  configuration: z.record(z.string(), z.unknown()).default({}),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  parentId: z.string().min(1).max(64).nullable(),
  branchKey: z.string().trim().min(1).max(40).nullable(),
  order: z.number().finite(),
});

export const saveAutomationGraphSchema = z.object({
  name: z.string().trim().min(1, 'Give the rule a name').max(120).optional(),
  description: z.string().max(2000).nullish(),
  nodes: z.array(saveGraphNodeSchema).max(200),
});

export type SaveGraphNodeInput = z.infer<typeof saveGraphNodeSchema>;
export type SaveAutomationGraphInput = z.infer<typeof saveAutomationGraphSchema>;

/* -------------------------------------------------------------------------- */
/* Edge derivation                                                             */
/* -------------------------------------------------------------------------- */

interface EdgeSource {
  id: string;
  type: string;
  parentId: string | null;
  branchKey: string | null;
  order: number;
}

interface DerivedEdge {
  id: string;
  source: string;
  target: string;
  kind: (typeof AutomationEdgeKind)[keyof typeof AutomationEdgeKind];
  label: string | null;
  /**
   * Which arm of a split this leaves by, null on the main path.
   *
   * Carried rather than inferred from the label: the label is words for people
   * and will be reworded, and a canvas deciding what a control does by matching
   * display text breaks silently the first time somebody improves the wording.
   */
  branchKey: string | null;
}

/**
 * Edges, built from parentage rather than stored.
 *
 * Shared by the API response and the canvas so the two cannot disagree about
 * what connects to what — which is the failure mode a stored edge table invites
 * the moment one write updates a parent and forgets the edge.
 *
 * An edge leaving a branch is labelled by the arm it belongs to; ordinary steps
 * carry no label, because "next" does not need saying.
 */
export function deriveEdges(nodes: readonly EdgeSource[]): DerivedEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return nodes
    .filter((node) => node.parentId !== null && byId.has(node.parentId))
    .sort((a, b) => a.order - b.order)
    .map((node) => {
      const parent = byId.get(node.parentId as string) as EdgeSource;
      const fromBranch = parent.type === AutomationNodeType.BRANCH;

      const kind = !fromBranch
        ? AutomationEdgeKind.DEFAULT
        : node.branchKey === BranchKey.ELSE
          ? AutomationEdgeKind.ELSE
          : AutomationEdgeKind.MATCH;

      return {
        id: `${node.parentId}->${node.id}`,
        source: node.parentId as string,
        target: node.id,
        kind,
        /*
         * Plain words, not the enum.
         *
         * "Match" and "Else" are the keys the engine walks; on a canvas they
         * read as jargon, and an unlabelled pair of arms reads as two identical
         * paths. "Otherwise" is what somebody would say out loud.
         */
        branchKey: node.branchKey,
        label: !fromBranch
          ? null
          : node.branchKey === BranchKey.ELSE
            ? 'Otherwise'
            : 'If it matches',
      };
    });
}

/* -------------------------------------------------------------------------- */
/* Structural validation                                                       */
/* -------------------------------------------------------------------------- */

interface GraphIssue {
  level: (typeof GraphIssueLevel)[keyof typeof GraphIssueLevel];
  nodeId: string | null;
  path: string | null;
  message: string;
}

interface ValidatableNode {
  id: string;
  type: string;
  subtype: string;
  configuration: Record<string, unknown>;
  parentId: string | null;
  branchKey: string | null;
  /**
   * Where this sits among its siblings.
   *
   * Optional because a caller that only knows about a flat list of steps has
   * nothing to say here — but the fallback check below needs it, since "last"
   * is a fact about the order the runner reads, not about the order an array
   * happened to arrive in.
   */
  order?: number;
}

/**
 * Everything wrong with a graph's *shape*, independent of the project.
 *
 * Deliberately not the whole story: whether a section still exists, whether a
 * member is still in the workspace, whether a status belongs to this project —
 * those need the database and live in the API's validator. This half runs
 * identically on both sides so the builder can grey out Publish for the same
 * reasons the server would refuse it, without a round trip per keystroke.
 */
export function validateGraphStructure(
  nodes: readonly ValidatableNode[],
  name: string | null | undefined,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const error = (message: string, nodeId: string | null = null, path: string | null = null) =>
    issues.push({ level: GraphIssueLevel.ERROR, nodeId, path, message });
  const warn = (message: string, nodeId: string | null = null) =>
    issues.push({ level: GraphIssueLevel.WARNING, nodeId, path: null, message });

  if (!name || name.trim() === '') {
    error('Give the rule a name.');
  }

  const triggers = nodes.filter((node) => node.type === AutomationNodeType.TRIGGER);
  const actions = nodes.filter((node) => node.type === AutomationNodeType.ACTION);
  const conditions = nodes.filter((node) => node.type === AutomationNodeType.CONDITION);

  if (triggers.length === 0) error('Choose what starts this rule.');
  if (triggers.length > 1) {
    error('A rule can only start one way.', triggers[1]?.id ?? null);
  }

  const trigger = triggers[0];
  if (trigger && trigger.parentId !== null) {
    error('The trigger has to come first.', trigger.id);
  }

  /*
   * A trigger node with nothing chosen is the same problem as no trigger.
   *
   * The builder starts a new rule with the trigger already on the canvas, so
   * "there is a trigger" became true the moment the page opened while "somebody
   * said what starts this" was still false. Same message on purpose: from where
   * the person is sitting these are one thing, and two different sentences for
   * it would read as two different faults.
   */
  if (trigger && trigger.subtype.trim() === '') {
    error('Choose what starts this rule.', trigger.id, 'subtype');
  }

  if (actions.length === 0) error('Add at least one action.');

  /*
   * A placeholder is the absence of an action, not a kind of one. It is fine in
   * a draft — it is what "+ Do this…" looks like before anybody chooses — and
   * publishing one would hand the runner a step it cannot perform.
   */
  for (const node of nodes) {
    if (node.type === (PLACEHOLDER_NODE_TYPE as string)) {
      error('Finish choosing this action, or remove it.', node.id);
    }
  }

  /*
   * An action with its setting missing.
   *
   * "Move to a section" with no section, "Assign" with nobody named: each
   * published, went ACTIVE, and failed on every run with a message in an
   * execution log nobody was watching — the same silence as an unanswered
   * condition, from the other side of the rule. The canvas already draws the
   * gap as an "Unspecified" chip; this is what makes the chip a reason Publish
   * is off rather than a decoration. It is also what a rule started from the
   * library relies on: a reference the new project could not match is left
   * blank on purpose, and blank has to mean "not yet publishable".
   */
  for (const node of actions) {
    const missing = missingActionSetting(node.subtype, node.configuration ?? {});
    if (missing) error(missing.message, node.id, missing.path);
  }

  /*
   * A question nobody answered.
   *
   * The builder starts a rule with a condition card already on the canvas, so
   * "there is a condition" went true the moment the page opened while "somebody
   * said what to check" was still false. Nothing else catches it: the counts
   * above only count, and the evaluator treats a missing operator as an unknown
   * one and returns false. The result was a rule that published cleanly, went
   * ACTIVE, and recorded a skipped execution for every matching event forever.
   *
   * A branch is the same node in a different hat — its comparison chooses which
   * arm runs, so an unanswered one silently takes the otherwise side every time.
   */
  for (const node of [
    ...conditions,
    ...nodes.filter((n) => n.type === AutomationNodeType.BRANCH),
  ]) {
    const configuration = node.configuration ?? {};

    /*
     * The fallback row is the exception, and has to be.
     *
     * "If all other conditions are not met" has nothing to compare — asking it
     * what it checks would make every rule with an Otherwise unpublishable, on
     * the strength of a question it is defined by not asking.
     */
    if (isFallbackBranch(configuration)) continue;

    const field = configuration['field'];
    const operator = configuration['operator'];

    if (typeof field !== 'string' || field.trim() === '') {
      error('Choose what this step checks.', node.id, 'field');
      continue;
    }

    if (typeof operator !== 'string' || operator.trim() === '') {
      error('Choose how to compare it.', node.id, 'operator');
    }
  }

  if (conditions.length === 0 && actions.length > 0) {
    warn('No condition is set, so this rule runs every time its trigger fires.');
  }

  /*
   * Every node except the trigger needs a parent that exists, or it is a step
   * nothing can reach — invisible on the canvas and never run.
   *
   * Asked only of a graph that has parentage at all. A rule written before the
   * canvas has none — every parent is null — and means "every condition must
   * hold, then every action runs"; the runner still executes that shape, and
   * tells the two apart by this same test. Asking it of one would report every
   * step of a working rule as disconnected and refuse to publish it, for being
   * the shape it was always allowed to have.
   *
   * Which is why this is a fact about the graph rather than about who is
   * asking: an unparented step among parented ones really is unreachable, and
   * the same step in a rule where nothing is parented really does run.
   */
  const isTree = nodes.some((node) => node.parentId !== null);
  const ids = new Set(nodes.map((node) => node.id));

  if (isTree) {
    for (const node of nodes) {
      if (node.type === AutomationNodeType.TRIGGER) continue;

      if (node.parentId === null) {
        error('This step is not connected to anything.', node.id);
        continue;
      }

      if (!ids.has(node.parentId)) {
        error('This step follows something that is no longer here.', node.id);
      }
    }
  }

  for (const issue of detectCycles(nodes)) issues.push(issue);
  for (const issue of validateBranches(nodes)) issues.push(issue);
  for (const issue of validateFallback(nodes)) issues.push(issue);

  return issues;
}

/**
 * What each action cannot run without, under the keys the runner reads.
 *
 * Only the setting whose absence is a failure, not every setting. A due date
 * with no offset means today, a notification with nobody named goes to the
 * assignee, a subtask step is checked for titles by the server — those are
 * rules, not gaps, and refusing them would refuse what somebody built. Both
 * spellings where two are in circulation: the runner reads either, and a rule
 * stored under the older one must not stop publishing on the release that
 * added this check.
 */
const ACTION_REQUIREMENTS: Readonly<
  Record<string, { keys: readonly string[]; path: string; message: string }>
> = {
  ASSIGN_USER: { keys: ['userId', 'assigneeId'], path: 'userId', message: 'Choose who to assign.' },
  MOVE_TO_SECTION: {
    keys: ['sectionId'],
    path: 'sectionId',
    message: 'Choose a section to move to.',
  },
  // The section is optional — left blank, the task lands in the project's
  // first section — so only the project is what the move cannot do without.
  MOVE_TO_PROJECT: {
    keys: ['projectId'],
    path: 'projectId',
    message: 'Choose a project to move to.',
  },
  UPDATE_STATUS: {
    keys: ['status', 'statusDefinitionId'],
    path: 'status',
    message: 'Choose a status.',
  },
  UPDATE_PRIORITY: {
    keys: ['priority', 'priorityDefinitionId'],
    path: 'priority',
    message: 'Choose a priority.',
  },
  SET_CUSTOM_FIELD: {
    keys: ['fieldId', 'customFieldId'],
    path: 'fieldId',
    message: 'Choose a field to set.',
  },
  ADD_COMMENT: { keys: ['body'], path: 'body', message: 'Write the comment.' },
  SET_ESTIMATE: { keys: ['minutes'], path: 'minutes', message: 'Enter the estimate in minutes.' },
};

/**
 * The setting an action is missing, or null when it has what it needs.
 *
 * An action this table does not know is not refused here — whether it exists
 * at all is the server's question, and it asks it in its own words.
 */
export function missingActionSetting(
  subtype: string,
  configuration: Record<string, unknown>,
): { path: string; message: string } | null {
  const requirement = ACTION_REQUIREMENTS[subtype];
  if (!requirement) return null;

  const present = requirement.keys.some((key) => {
    const value = configuration[key];
    return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;
  });

  return present ? null : { path: requirement.path, message: requirement.message };
}

/**
 * The fallback row: one of it, and last.
 *
 * Both halves are about what the runner does. It takes the first row whose
 * condition holds, and a fallback holds unconditionally — so a fallback with
 * rows after it makes those rows unreachable, and a second fallback is a row
 * that can never run. Neither reads as broken on the canvas, which is exactly
 * why it has to be refused here rather than discovered later.
 */
function validateFallback(nodes: readonly ValidatableNode[]): GraphIssue[] {
  const fallbacks = nodes.filter(
    (node) => node.type === AutomationNodeType.CONDITION && isFallbackBranch(node.configuration),
  );

  if (fallbacks.length === 0) return [];

  const issues: GraphIssue[] = [];

  for (const extra of fallbacks.slice(1)) {
    issues.push({
      level: GraphIssueLevel.ERROR,
      nodeId: extra.id,
      path: null,
      message: 'A rule can only have one “otherwise”.',
    });
  }

  const fallback = fallbacks[0] as ValidatableNode;
  const after = nodes.filter(
    (node) =>
      node.id !== fallback.id &&
      node.type === AutomationNodeType.CONDITION &&
      node.parentId === fallback.parentId &&
      (node.order ?? 0) > (fallback.order ?? 0),
  );

  if (after.length > 0) {
    issues.push({
      level: GraphIssueLevel.ERROR,
      nodeId: fallback.id,
      path: null,
      message: '“Otherwise” has to be the last branch — nothing after it could ever run.',
    });
  }

  return issues;
}

/**
 * A step that is its own ancestor.
 *
 * The builder cannot draw one — nodes are added under a parent — but the API
 * accepts a graph from anywhere, and a cycle here would make the runner walk
 * forever rather than merely produce a wrong answer.
 */
function detectCycles(nodes: readonly ValidatableNode[]): GraphIssue[] {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const issues: GraphIssue[] = [];

  for (const node of nodes) {
    const seen = new Set<string>([node.id]);
    let current = parentOf.get(node.id) ?? null;

    while (current !== null) {
      if (seen.has(current)) {
        issues.push({
          level: GraphIssueLevel.ERROR,
          nodeId: node.id,
          path: null,
          message: 'These steps loop back into each other.',
        });
        break;
      }

      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
  }

  return issues;
}

function validateBranches(nodes: readonly ValidatableNode[]): GraphIssue[] {
  const issues: GraphIssue[] = [];

  for (const node of nodes) {
    if (node.type !== AutomationNodeType.BRANCH) continue;

    const arms = nodes.filter((child) => child.parentId === node.id);

    if (arms.length === 0) {
      issues.push({
        level: GraphIssueLevel.ERROR,
        nodeId: node.id,
        path: null,
        message: 'This split has no steps under it.',
      });
      continue;
    }

    // An arm with no key cannot be told from any other, and the runner would
    // have no way to choose between them.
    const unkeyed = arms.find((arm) => arm.branchKey === null);
    if (unkeyed) {
      issues.push({
        level: GraphIssueLevel.ERROR,
        nodeId: unkeyed.id,
        path: null,
        message: 'This step is under a split but not on one of its paths.',
      });
    }
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/* Condition validation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Whether an operator makes sense for the kind of value a field holds.
 *
 * "Date contains High" and "Checkbox greater than 10" are combinations a form
 * should never offer — and the endpoint has to refuse them too, because a form
 * is not a check.
 */
export function operatorFitsValueKind(operator: string, kind: ConditionValueKind): boolean {
  /*
   * The runner's own comparisons fit exactly the kind they are about — a
   * checkbox is checked, a number is between two others, a date is today —
   * and have no filter to translate to, so they are answered first.
   */
  if (isDirectOperator(operator)) return DIRECT_OPERATOR_VALUE_KIND[operator] === kind;

  /*
   * Translated first, because the builder and this table name the same
   * comparison differently.
   *
   * The panel writes `IS`; the table lists `EQUALS`. Compared as strings, every
   * section condition the builder can produce was refused with "“IS” cannot be
   * used with this kind of field" — the panel building something the endpoint
   * would not accept, which is the disagreement sharing this module exists to
   * prevent. An operator with no comparison behind it still fails, which is the
   * check doing its job.
   */
  const comparison = toFilterOperator(operator);

  return comparison !== null && OPERATORS_BY_VALUE_KIND[kind].includes(comparison);
}

export function validateCondition(
  configuration: Record<string, unknown>,
  kind: ConditionValueKind | undefined,
  nodeId: string,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const field = configuration['field'];
  const operator = configuration['operator'];

  if (typeof field !== 'string' || field === '') {
    issues.push({
      level: GraphIssueLevel.ERROR,
      nodeId,
      path: 'field',
      message: 'Choose what to check.',
    });
    return issues;
  }

  if (typeof operator !== 'string' || operator === '') {
    issues.push({
      level: GraphIssueLevel.ERROR,
      nodeId,
      path: 'operator',
      message: 'Choose how to compare it.',
    });
    return issues;
  }

  if (kind === undefined) {
    issues.push({
      level: GraphIssueLevel.ERROR,
      nodeId,
      path: 'field',
      message: 'That field is no longer available on this project.',
    });
    return issues;
  }

  if (!operatorFitsValueKind(operator, kind)) {
    issues.push({
      level: GraphIssueLevel.ERROR,
      nodeId,
      path: 'operator',
      message: `“${operator}” cannot be used with this kind of field.`,
    });
  }

  /*
   * Also translated: "is one of" with no sections chosen has to be caught as a
   * missing value, not waved through because the name was unrecognised. A
   * direct comparison answers for itself, having no filter to translate to:
   * "is checked" and "is today" carry their whole question in the operator,
   * "between" and "within the next" do not.
   */
  const takesValue = isDirectOperator(operator)
    ? operatorNeedsValue(operator)
    : operatorTakesValue(toFilterOperator(operator) ?? (operator as FilterOperator));

  if (takesValue) {
    const value = configuration['value'];

    if (value === undefined || value === null || value === '') {
      issues.push({
        level: GraphIssueLevel.ERROR,
        nodeId,
        path: 'value',
        message: 'Give it something to compare against.',
      });
    }
  }

  return issues;
}
