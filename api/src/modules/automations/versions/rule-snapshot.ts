import { AutomationAction, AutomationNodeType, subtaskEntries } from '@coretask/contracts';
import type { AutomationNode, Prisma } from '@prisma/client';

/**
 * A published version's steps, as `AutomationRuleVersion.nodes` holds them.
 *
 * The row shape of `automation_nodes`, less what only the table needs — which
 * rule it belongs to, when it was written, the coordinates nothing reads since
 * layout became derived. So the runner, which used to read node rows, reads a
 * version with no translation in between.
 */
export type SnapshotNode = Pick<
  AutomationNode,
  'id' | 'nodeType' | 'subtype' | 'configuration' | 'parentNodeId' | 'branchKey' | 'position'
>;

/** The draft's rows, as a version keeps them. */
export function snapshotOf(nodes: readonly SnapshotNode[]): SnapshotNode[] {
  return [...nodes]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((node) => ({
      id: node.id,
      nodeType: node.nodeType,
      subtype: node.subtype,
      configuration: node.configuration ?? {},
      parentNodeId: node.parentNodeId,
      branchKey: node.branchKey,
      position: node.position,
    }));
}

/**
 * A stored snapshot, or null when the version has none.
 *
 * Read defensively, because it is JSON: an entry that is not a node is left
 * out rather than handed to the runner, which would then have to wonder about
 * every field of every step.
 */
export function readSnapshot(value: Prisma.JsonValue | null | undefined): SnapshotNode[] | null {
  if (!Array.isArray(value)) return null;

  const types = new Set<string>(Object.values(AutomationNodeType));
  const nodes: SnapshotNode[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row['id'] !== 'string' || typeof row['subtype'] !== 'string') continue;
    if (typeof row['nodeType'] !== 'string' || !types.has(row['nodeType'])) continue;

    nodes.push({
      id: row['id'],
      nodeType: row['nodeType'] as SnapshotNode['nodeType'],
      subtype: row['subtype'],
      configuration: (row['configuration'] ?? {}) as Prisma.JsonValue,
      parentNodeId: typeof row['parentNodeId'] === 'string' ? row['parentNodeId'] : null,
      branchKey: typeof row['branchKey'] === 'string' ? row['branchKey'] : null,
      position: typeof row['position'] === 'number' ? row['position'] : 0,
    });
  }

  return nodes;
}

/**
 * Everyone a version's steps give work to: "Assign to", the people its
 * checklist subtasks go to, and a new task's assignee. A condition that only
 * names someone ("is assigned to Earl") gives nobody anything.
 */
export function ruleAssignees(nodes: readonly SnapshotNode[]): string[] {
  const people = new Set<string>();
  for (const node of nodes) {
    if (node.nodeType !== AutomationNodeType.ACTION) continue;
    const config = (node.configuration ?? {}) as Record<string, unknown>;
    switch (node.subtype) {
      case AutomationAction.ASSIGN_USER:
        add(people, config['userId'] ?? config['assigneeId']);
        break;
      case AutomationAction.CREATE_TASK:
        add(people, config['assigneeId']);
        break;
      case AutomationAction.CREATE_SUBTASK:
        for (const entry of subtaskEntries(config)) add(people, entry.assigneeId);
        break;
    }
  }
  return [...people];
}

function add(people: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value !== '') people.add(value);
}

/** What a version is triggered by: what it was published with. */
export interface SnapshotTrigger {
  triggerType: string;
  triggerConfig: Prisma.JsonValue;
}

/**
 * Whether two graphs say the same thing, whatever their ids.
 *
 * Ids are not part of what a rule says: a template applied, a version restored
 * and a client that names its nodes "t" and "a" all give the same steps fresh
 * ids. So each node is named by its place instead — the path of positions and
 * arms from the root — and the two are compared by that and by what each step
 * is. Two graphs that agree are one rule, and publishing the second would add a
 * version identical to the one before it.
 */
export function sameGraph(a: readonly SnapshotNode[], b: readonly SnapshotNode[]): boolean {
  if (a.length !== b.length) return false;

  const left = canonical(a);
  const right = canonical(b);
  if (left.size !== right.size) return false;

  for (const [path, entry] of left) {
    if (right.get(path) !== entry) return false;
  }
  return true;
}

function canonical(nodes: readonly SnapshotNode[]): Map<string, string> {
  const children = new Map<string | null, SnapshotNode[]>();
  for (const node of nodes) {
    const key = node.parentNodeId;
    children.set(key, [...(children.get(key) ?? []), node]);
  }

  const result = new Map<string, string>();
  const walk = (parentId: string | null, prefix: string, depth: number) => {
    if (depth > 100) return;
    const siblings = [...(children.get(parentId) ?? [])].sort(
      (x, y) => x.position - y.position || stable(x).localeCompare(stable(y)),
    );

    siblings.forEach((node, index) => {
      const path = `${prefix}/${node.branchKey ?? ''}${index}`;
      // A duplicate path means a malformed graph; keeping the first is enough
      // to make two of them unequal to a well-formed one.
      if (!result.has(path)) result.set(path, stable(node));
      walk(node.id, path, depth + 1);
    });
  };
  walk(null, '', 0);

  // A node whose parent is not in the graph never joins the walk; counted
  // here so a graph with one cannot equal a graph without it.
  if (result.size !== nodes.length) result.set('#orphans', String(nodes.length - result.size));

  return result;
}

/** A step's meaning, as a string that compares equal exactly when it is equal. */
function stable(node: SnapshotNode): string {
  return JSON.stringify([node.nodeType, node.subtype, node.branchKey, sorted(node.configuration)]);
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([key, entry]) => [key, sorted(entry)]),
  );
}

/** Whether two trigger configurations are the same, key order aside. */
export function sameConfig(a: Prisma.JsonValue, b: Prisma.JsonValue): boolean {
  return JSON.stringify(sorted(a ?? {})) === JSON.stringify(sorted(b ?? {}));
}
