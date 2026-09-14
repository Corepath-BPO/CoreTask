import type { AutomationRuleStatus, AutomationTemplateReferenceKind } from '@coretask/contracts';

import type { SaveAutomationGraphNode } from './automation-graph.js';

/**
 * A rule saved to the workspace's library.
 *
 * A snapshot of a rule's graph, not a link to the rule: the rule goes on being
 * edited and archived, and a template that changed underneath everybody who had
 * already used it would be a rule nobody wrote.
 */
export interface AutomationTemplate {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  /** The node tree in the shape the builder saves, ids and parentage included. */
  nodes: AutomationTemplateNode[];
  allowChaining: boolean;
  /** Where it came from. Null once the rule or project is gone. */
  sourceRuleId: string | null;
  sourceProject: { id: string; name: string } | null;
  createdBy: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  /** How many drafts have been started from it. */
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A node inside a template.
 *
 * `SaveAutomationGraphNode` with the builder's `type` written as the table's
 * `nodeType` — a template is stored ready to post to `POST /automations`, so
 * it speaks that endpoint's spelling rather than the canvas's.
 */
export interface AutomationTemplateNode extends Omit<
  SaveAutomationGraphNode,
  'type' | 'parentId' | 'branchKey'
> {
  nodeType: SaveAutomationGraphNode['type'];
  parentId: string | null;
  branchKey: string | null;
}

/**
 * Something the template named that the target project does not have.
 *
 * Reported rather than refused: the draft is created with that choice left
 * blank, and the builder asks for it the way it asks for any unanswered step.
 * `name` is what the source project called it, which is the only clue the
 * person applying the template has about what to choose instead.
 */
export interface AutomationTemplateUnresolved {
  nodeType: string;
  subtype: string;
  kind: AutomationTemplateReferenceKind;
  /** What it was called where the template was saved. */
  name: string;
}

/** What applying a template answers with. */
export interface AppliedAutomationTemplate {
  /** The draft that was created, as `GET /automations/:ruleId` returns it. */
  rule: { id: string; projectId: string; name: string; status: AutomationRuleStatus };
  unresolved: AutomationTemplateUnresolved[];
}
