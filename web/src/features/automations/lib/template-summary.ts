import {
  ACTION_LABEL,
  AUTOMATION_TEMPLATE_REFERENCE_KIND_LABEL,
  CONDITION_OPERATOR_LABEL,
  TRIGGER_LABEL,
  isFallbackBranch,
  type AutomationAction,
  type AutomationTrigger,
  type ConditionOperator,
} from '@coretask/contracts';
import type { AutomationTemplateNode, AutomationTemplateUnresolved } from '@coretask/types';

/**
 * What a template does, in a line.
 *
 * A library card cannot draw the canvas and should not try: what somebody is
 * choosing between is "assign on arrival" and "flag overdue work", and that is
 * a sentence. Read from the nodes rather than from the name, because the name
 * is whatever somebody typed and the nodes are what will actually happen.
 *
 * Ids stay unresolved on purpose. A template's section and field ids belong to
 * the project it was saved in, so "Move to 019fc8…" cannot be turned into "Move
 * to Done" here — and once applied, the builder shows the real names anyway.
 */
export interface TemplateStep {
  kind: 'check' | 'otherwise' | 'action' | 'unknown';
  label: string;
}

export interface TemplateSummary {
  trigger: string;
  steps: TemplateStep[];
  actionCount: number;
}

/** The plain words for the fields a condition can be about. */
const CONDITION_FIELD_LABEL: Readonly<Record<string, string>> = {
  sectionId: 'section',
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee',
  createdById: 'creator',
  reporterId: 'reporter',
  dueDate: 'due date',
  startDate: 'start date',
  title: 'title',
  description: 'description',
  completed: 'completed',
};

function conditionLabel(configuration: Record<string, unknown>): string {
  const field = configuration['field'];
  const operator = configuration['operator'];

  const subject =
    typeof field !== 'string' || field === ''
      ? 'something'
      : field.startsWith('customField:')
        ? 'a field'
        : (CONDITION_FIELD_LABEL[field] ?? field);

  const comparison =
    typeof operator === 'string'
      ? (CONDITION_OPERATOR_LABEL[operator as ConditionOperator]?.toLocaleLowerCase() ?? '')
      : '';

  return comparison ? `${subject} ${comparison} …` : subject;
}

/**
 * The steps in the order the runner walks them.
 *
 * Depth-first from the trigger, siblings by `order`, so a branch reads as its
 * question followed by its actions before the next question — the same order
 * the canvas draws and the runner evaluates. A flat rule from before the canvas
 * has no parentage at all and falls back to stored order, which is what it
 * always meant.
 */
function walk(nodes: readonly AutomationTemplateNode[]): AutomationTemplateNode[] {
  const isTree = nodes.some((node) => node.parentId !== null);
  const sorted = [...nodes].sort((a, b) => a.order - b.order);
  if (!isTree) return sorted;

  const children = new Map<string | null, AutomationTemplateNode[]>();
  for (const node of sorted) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }

  const seen = new Set<string>();
  const ordered: AutomationTemplateNode[] = [];
  const visit = (node: AutomationTemplateNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    ordered.push(node);
    for (const child of children.get(node.id) ?? []) visit(child);
  };

  for (const root of children.get(null) ?? []) visit(root);
  // Anything unreachable still counts as a step somebody built.
  for (const node of sorted) visit(node);

  return ordered;
}

export function summariseTemplate(template: {
  triggerType: string;
  nodes: readonly AutomationTemplateNode[];
}): TemplateSummary {
  const ordered = walk(template.nodes);

  const triggerNode = ordered.find((node) => node.nodeType === 'TRIGGER');
  const triggerType = triggerNode?.subtype || template.triggerType;
  const trigger = TRIGGER_LABEL[triggerType as AutomationTrigger] ?? triggerType;

  const steps: TemplateStep[] = [];
  let actionCount = 0;

  for (const node of ordered) {
    switch (node.nodeType) {
      case 'TRIGGER':
        break;
      case 'ACTION':
        actionCount += 1;
        steps.push({
          kind: 'action',
          label: ACTION_LABEL[node.subtype as AutomationAction] ?? node.subtype,
        });
        break;
      case 'CONDITION':
      case 'BRANCH':
        if (isFallbackBranch(node.configuration)) {
          steps.push({ kind: 'otherwise', label: 'Otherwise' });
        } else {
          steps.push({ kind: 'check', label: `Check if ${conditionLabel(node.configuration)}` });
        }
        break;
      default:
        steps.push({ kind: 'unknown', label: node.subtype });
    }
  }

  return { trigger, steps, actionCount };
}

/**
 * What a freshly applied draft still needs, as one sentence.
 *
 * "A section for Move to a section (was Done)" tells somebody what to open and
 * what to look for; the raw list — a node type, a subtype, a kind — tells them
 * nothing they can act on. The old name is the useful half: the project they
 * are in may well have the same thing under a different name.
 */
export function describeUnresolved(unresolved: readonly AutomationTemplateUnresolved[]): string {
  if (unresolved.length === 0) return '';

  const parts = unresolved.map((entry) => {
    const kind = AUTOMATION_TEMPLATE_REFERENCE_KIND_LABEL[entry.kind] ?? 'a value';
    const step =
      entry.nodeType === 'TRIGGER'
        ? (TRIGGER_LABEL[entry.subtype as AutomationTrigger] ?? 'the trigger')
        : entry.nodeType === 'ACTION'
          ? (ACTION_LABEL[entry.subtype as AutomationAction] ?? entry.subtype)
          : 'a condition';

    return `${kind} for “${step}” (was ${entry.name})`;
  });

  return `Choose for this project: ${parts.join('; ')}.`;
}
