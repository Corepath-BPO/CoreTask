import type {
  AutomationEdgeKind,
  AutomationNodeType,
  AutomationRuleStatus,
  ConditionValueKind,
  ConditionValueType,
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
  /** Drawn on the edge when it leaves a branch. */
  label: string | null;
  /** Which arm of a split this leaves by, null on the main path. */
  branchKey: string | null;
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
  /**
   * The condition catalogue: what a branch may be asked to check.
   *
   * The endpoint has always sent this and this type did not say so, which left
   * the one client that needed it reading through a cast — and the compiler
   * unable to notice if the endpoint stopped sending it. Declared beside
   * `triggers` and `actions` because it is the third of the same thing: the
   * grouped, searchable list a step is chosen from.
   *
   * Distinct from `conditionFields` below, which is not the picker but what a
   * picked row is then configured with.
   */
  conditions: AutomationCatalogEntry[];
  conditionFields: ConditionFieldDefinition[];
  sections: { id: string; name: string }[];
  statuses: { id: string; name: string; colorToken: string }[];
  priorities: { id: string; name: string; colorToken: string }[];
  members: { id: string; name: string; email: string; avatarUrl: string | null }[];
  /**
   * The project's own fields, with the values each one offers.
   *
   * `options` is declared here because the endpoint has always returned it and
   * this type did not say so — which left every form that needed the choices
   * casting its way to them, and the compiler unable to notice when one of them
   * was wrong.
   */
  customFields: {
    id: string;
    name: string;
    type: string;
    options?: { id: string; label: string; colorToken: string }[];
  }[];
}

/** One offer in the trigger or action selector. */
export interface AutomationCatalogEntry {
  subtype: string;
  label: string;
  description: string;
  category: string;
  /** False for something declared but not executable — shown disabled. */
  available: boolean;
  /**
   * Why it cannot be chosen, when it cannot.
   *
   * A greyed row with no explanation is worse than an absent one: it says "not
   * for you" without saying why or whether that will change. This is the half
   * that makes showing it rather than hiding it the kinder choice.
   */
  reason?: string | null;
  /**
   * The custom field an entry was generated from.
   *
   * Set only for the per-field entries, so the card can render the field's name
   * as a token — "Change `Priority` to…" — rather than baking it into the label
   * and losing the distinction between the words and the field.
   */
  fieldId?: string;
  fieldName?: string;
  /**
   * What this row's value is, on the rows that compare one.
   *
   * Only the condition entries carry it — the same convention as `fieldId`
   * above, which is present only on the generated rows. It is what decides the
   * comparisons the row may use, so choosing a condition can write the field
   * *and* its first operator in one act rather than leaving a step half
   * answered.
   */
  valueType?: ConditionValueType;
}

export interface ConditionFieldDefinition {
  field: string;
  label: string;
  valueKind: ConditionValueKind;
  /** Present for ENUM and REFERENCE fields, so the form can offer real values. */
  options?: { value: string; label: string }[];
}
