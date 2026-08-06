import type {
  AutomationEdgeKind,
  AutomationNodeType,
  AutomationRuleStatus,
  ConditionValueKind,
  GraphIssueLevel,
} from '@coretask/contracts';

/**
 * One node as the builder reads and writes it.
 *
 * `parentId` and `branchKey` are the structure; everything else is what the
 * node does and where it sits. This is the same row `automation_nodes` holds,
 * which is the point — the canvas edits the rule, not a picture of one.
 */
export interface AutomationGraphNode {
  id: string;
  type: AutomationNodeType;
  /** The specific trigger, condition or action, e.g. `ASSIGN_USER`. */
  subtype: string;
  configuration: Record<string, unknown>;
  position: { x: number; y: number };
  /** Null for the trigger, which is where every rule starts. */
  parentId: string | null;
  /** Which arm of a parent branch this hangs off. Null on the main path. */
  branchKey: string | null;
  /** Ordinal among siblings sharing a parent and branch. */
  order: number;
}

/**
 * An edge, **derived** rather than stored.
 *
 * There is no edge table and there should not be one: `parentId` already says
 * everything an edge row would, and two representations of the same fact drift.
 * `deriveEdges` builds these from the nodes, and both the API response and the
 * canvas use it so they cannot disagree.
 */
export interface AutomationGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: AutomationEdgeKind;
  /** Drawn on the edge when it leaves a branch — "Match", "Else". */
  label: string | null;
}

export interface AutomationGraph {
  nodes: AutomationGraphNode[];
  edges: AutomationGraphEdge[];
}

/** A rule with its graph, which is what the builder loads. */
export interface AutomationRuleGraph {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: AutomationRuleStatus;
  version: number;
  /** Whether this rule may run on an event another rule caused. */
  allowChaining: boolean;
  createdBy: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  publishedAt: string | null;
  graph: AutomationGraph;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the builder sends back.
 *
 * Nodes only. Edges are not accepted: they are derived from `parentId`, and an
 * endpoint that took both would have to decide which one wins whenever they
 * disagreed — a decision with no right answer.
 */
export interface SaveAutomationGraphPayload {
  name?: string;
  description?: string | null;
  nodes: SaveAutomationGraphNode[];
}

export interface SaveAutomationGraphNode {
  /** Echoed back on the response so the canvas can keep its selection. */
  id: string;
  type: AutomationNodeType;
  subtype: string;
  configuration: Record<string, unknown>;
  position: { x: number; y: number };
  parentId: string | null;
  branchKey: string | null;
  order: number;
}

/** One thing wrong with a graph, addressed to the node that is wrong. */
export interface AutomationGraphIssue {
  level: GraphIssueLevel;
  /** Null when the problem is the rule rather than a node — a missing name. */
  nodeId: string | null;
  /** Which field inside the node's configuration, when it is that specific. */
  path: string | null;
  message: string;
}

export interface AutomationGraphValidation {
  /** No ERROR issues. Warnings do not block publishing. */
  publishable: boolean;
  issues: AutomationGraphIssue[];
}

/**
 * What the forms need to offer real choices.
 *
 * Sections, statuses, priorities and members come from the project rather than
 * a hard-coded list, so a workspace that renamed its statuses sees its own
 * words — and so a rule cannot be built against a status that does not exist.
 */
export interface AutomationMetadata {
  triggers: AutomationCatalogEntry[];
  actions: AutomationCatalogEntry[];
  conditionFields: ConditionFieldDefinition[];
  sections: { id: string; name: string }[];
  statuses: { id: string; name: string; colorToken: string }[];
  priorities: { id: string; name: string; colorToken: string }[];
  members: { id: string; name: string; email: string; avatarUrl: string | null }[];
  customFields: { id: string; name: string; type: string }[];
}

/** One offer in the trigger or action selector. */
export interface AutomationCatalogEntry {
  subtype: string;
  label: string;
  description: string;
  category: string;
  /** False for something declared but not executable — shown disabled. */
  available: boolean;
}

export interface ConditionFieldDefinition {
  field: string;
  label: string;
  valueKind: ConditionValueKind;
  /** Present for ENUM and REFERENCE fields, so the form can offer real values. */
  options?: { value: string; label: string }[];
}
