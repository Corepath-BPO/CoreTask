import {
  AUTOMATION_NODE_TYPES,
  AutomationEdgeKind,
  AutomationNodeType,
  BranchKey,
  GraphIssueLevel,
  OPERATORS_BY_VALUE_KIND,
  operatorTakesValue,
  PLACEHOLDER_NODE_TYPE,
  type FilterOperator,
  type AutomationNodeType as NodeType,
  type ConditionValueKind,
} from '@coretask/contracts';
import { z } from 'zod';

import { uuidSchema } from './common.js';

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

  if (conditions.length === 0 && actions.length > 0) {
    warn('No condition is set, so this rule runs every time its trigger fires.');
  }

  // Every node except the trigger needs a parent that exists, or it is a step
  // nothing can reach — invisible on the canvas and never run.
  const ids = new Set(nodes.map((node) => node.id));

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

  for (const issue of detectCycles(nodes)) issues.push(issue);
  for (const issue of validateBranches(nodes)) issues.push(issue);

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
  return OPERATORS_BY_VALUE_KIND[kind].includes(operator as FilterOperator);
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

  if (operatorTakesValue(operator as FilterOperator)) {
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
