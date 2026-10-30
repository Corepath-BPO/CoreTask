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
  /**
   * The version the rule runs, null until it is first published.
   *
   * `graph` below is the draft — what the builder edits and saves. The rule
   * runs this version until the draft is published again.
   */
  publishedVersion: AutomationRuleVersionSummary | null;
  /** Whether the draft says something the running version does not. */
  hasUnpublishedChanges: boolean;
  graph: AutomationGraph;
  createdAt: string;
  updatedAt: string;
}

/** One published version of a rule, as its history lists it. */
export interface AutomationRuleVersionSummary {
  id: string;
  /** Counts up from 1 within the rule. */
  version: number;
  /** What the rule was called when this was published. */
  name: string | null;
  triggerType: string;
  publishedAt: string;
  publishedBy: { id: string; name: string; avatarUrl: string | null } | null;
  /** Whether this is the version running now. */
  isPublished: boolean;
  /** Steps after the trigger. */
  stepCount: number;
}

/** A version with its steps, drawn as the canvas draws a rule. */
export interface AutomationRuleVersionDetail extends AutomationRuleVersionSummary {
  triggerConfig: Record<string, unknown>;
  graph: AutomationGraph;
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

/** What somebody asks for when they describe a rule instead of building one. */
export interface DraftAutomationPayload {
  /** "When a task moves to Week 1, assign it to Sam." */
  prompt: string;
}

/**
 * A rule drafted from a sentence, for the builder to open unsaved.
 *
 * Nothing is created: the builder holds it as it holds a starter, and the
 * first save is what makes the rule. The nodes are in the shape that save
 * sends, a trigger and a straight line of steps under it, with ids that have
 * never been to the database.
 */
export interface AutomationDraft {
  name: string;
  description: string | null;
  nodes: SaveAutomationGraphNode[];
  /** The validator's answer about the draft, the same one Publish would give. */
  validation: AutomationGraphValidation;
  /**
   * What was asked for and is not in the draft: the model's own note about
   * what the steps could not express, and any step it named wrongly.
   */
  notes: string[];
}

/**
 * What the engine can do at all, independent of any one project.
 *
 * Separate from `permissions`: this says what is possible, that says what this
 * caller may do. A client that conflates them tells a manager a feature is
 * forbidden when it simply does not exist yet.
 */
export interface AutomationCapabilities {
  /** The runner walks a branch's arms and takes one. */
  branching: boolean;
  /** A Wait step pauses a run until the clock resumes it. */
  delays: boolean;
  externalActions: boolean;
  /** A model is set up: the AI steps run, and a rule can be drafted from a sentence. */
  ai: boolean;
  conditionsOnCustomFields: boolean;
  actionsOnCustomFields: boolean;
  maxActionsPerExecution: number;
  maxRuleDepth: number;
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
  /**
   * The workspace's webhook endpoints, for the "Send a webhook" step. Host
   * only, not the URL: an n8n address often carries a path token, and this
   * list is read by every manager who can edit a rule.
   */
  webhookEndpoints: { id: string; name: string; host: string; enabled: boolean }[];
  /**
   * The workspace's other live projects, each with its sections, for the step
   * that moves a task out of this project.
   *
   * Sent with the metadata rather than fetched per pick: the panel needs the
   * target's sections the moment a project is chosen, and a round trip on
   * every pick would leave the section box empty while it arrived. This
   * project is left out — a move to where the task already is is not a move —
   * and so are archived ones.
   */
  projects: { id: string; name: string; color: string; sections: { id: string; name: string }[] }[];
  statuses: { id: string; name: string; colorToken: string }[];
  priorities: { id: string; name: string; colorToken: string }[];
  members: { id: string; name: string; email: string; avatarUrl: string | null }[];
  /**
   * Who a step may give work to — "Assign to", a checklist subtask, a new
   * task: the project's members and the workspace's owner, the list the
   * runner holds a rule to. Optional only so a client built before the limit
   * keeps reading the response; without it, `members`.
   */
  assignees?: { id: string; name: string; email: string; avatarUrl: string | null }[];
  /**
   * The workspace's teams, for the step that makes one responsible for the
   * task. Optional only so a client built before teams were offered keeps
   * reading the response.
   */
  teams?: { id: string; name: string; color: string }[];
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
  /**
   * What this server's engine can do. The endpoint has always sent it; it is
   * declared since the Add automation page reads `ai`, to offer drafting a
   * rule only where a model is set up. Optional, as `teams` is, so a fixture
   * written before it keeps compiling.
   */
  capabilities?: AutomationCapabilities;
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
   * What a rule with this entry acts on: tasks, tickets, or either. The
   * builder offers a ticket rule only the entries that name tickets.
   */
  subjects?: ('TASK' | 'TICKET')[];
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
  /**
   * Present for ENUM and REFERENCE fields, so the form can offer real values.
   *
   * The colour rides along where the row has one — a status, a priority, a
   * select option — because the builder shows the value as the same tinted chip
   * the rest of the app shows it as, and a form offering "In Progress" in plain
   * text beside a board showing it in blue reads as two different values.
   */
  options?: { value: string; label: string; colorToken?: string }[];
}
