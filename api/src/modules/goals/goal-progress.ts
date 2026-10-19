import { GoalProgressSource, metricProgress } from '@coretask/contracts';

export interface ProgressNode {
  id: string;
  parentId: string | null;
  progressSource: GoalProgressSource;
  /** The stored value; meaningful only for MANUAL. */
  progress: number;
  projectIds: string[];
  /** For METRIC: its figures, when all three are set. */
  metric?: { start: number; current: number; target: number } | null;
}

/**
 * Every goal's progress, 0–100, rolled up the way Asana does it.
 *
 * - MANUAL reads the stored number.
 * - METRIC measures its current value between its start and its target.
 * - PROJECTS averages its connected projects' completion.
 * - SUB_GOALS averages its children, each worked out by its own rule — so a
 *   company goal over team goals over project-driven goals updates itself as
 *   the tasks underneath get done.
 *
 * Nothing to average reads as 0. A cycle cannot reach this from the API, but a
 * goal found on its own path is treated as having no children rather than
 * recursing forever.
 */
export function rollUpProgress(
  nodes: readonly ProgressNode[],
  projectCompletion: ReadonlyMap<string, number>,
): Map<string, number> {
  const children = new Map<string, ProgressNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }

  const result = new Map<string, number>();
  const visiting = new Set<string>();

  const average = (values: number[]) =>
    values.length === 0
      ? 0
      : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

  const progressOf = (node: ProgressNode): number => {
    const known = result.get(node.id);
    if (known !== undefined) return known;
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);

    let value: number;
    switch (node.progressSource) {
      case GoalProgressSource.PROJECTS:
        value = average(
          node.projectIds
            .map((id) => projectCompletion.get(id))
            .filter((completion): completion is number => completion !== undefined),
        );
        break;
      case GoalProgressSource.SUB_GOALS:
        value = average((children.get(node.id) ?? []).map(progressOf));
        break;
      case GoalProgressSource.METRIC:
        value = node.metric
          ? metricProgress(node.metric.start, node.metric.current, node.metric.target)
          : 0;
        break;
      default:
        value = Math.min(100, Math.max(0, Math.round(node.progress)));
    }

    visiting.delete(node.id);
    result.set(node.id, value);
    return value;
  };

  for (const node of nodes) progressOf(node);
  return result;
}

/**
 * Whether making `candidateParentId` the parent of `goalId` would make the goal
 * its own ancestor — walking up from the candidate until the root.
 */
export function wouldCreateCycle(
  goalId: string,
  candidateParentId: string,
  parentOf: ReadonlyMap<string, string | null>,
): boolean {
  let cursor: string | null | undefined = candidateParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === goalId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}
