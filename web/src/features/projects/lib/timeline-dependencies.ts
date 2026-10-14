/** Where a task's bar sits on the timeline canvas, in pixels. */
export interface BarBox {
  left: number;
  right: number;
  /** The row's vertical centre. */
  y: number;
}

export interface DependencyEdge {
  id: string;
  /** The task that has to finish first. */
  blockingId: string;
  /** The task waiting on it. */
  blockedId: string;
}

export interface DependencyPath {
  id: string;
  d: string;
  /** The waiting task is scheduled to start before the one it waits on ends. */
  conflict: boolean;
}

/** How far a line runs out of a bar before it turns. */
const STUB = 8;

/**
 * The arrows Asana's timeline draws between dependent tasks: out of the
 * blocking bar's end, into the waiting bar's start. When the waiting task
 * starts too early the line doubles back around it, and it is a conflict —
 * drawn in red by the caller. Edges with an end off the canvas (collapsed,
 * unscheduled, another project) are left out.
 */
export function dependencyPaths(
  edges: readonly DependencyEdge[],
  boxes: ReadonlyMap<string, BarBox>,
  rowHeight: number,
): DependencyPath[] {
  const paths: DependencyPath[] = [];
  for (const edge of edges) {
    const from = boxes.get(edge.blockingId);
    const to = boxes.get(edge.blockedId);
    if (!from || !to) continue;

    const sx = from.right;
    const sy = from.y;
    const tx = to.left;
    const ty = to.y;
    const conflict = tx < sx;

    let d: string;
    if (tx - sx >= STUB * 2) {
      const turn = sx + STUB;
      d = `M ${sx} ${sy} H ${turn} V ${ty} H ${tx}`;
    } else {
      // Around: out, to the gap between the rows, back past the start, in.
      const between = sy + (ty >= sy ? rowHeight / 2 : -rowHeight / 2);
      d = `M ${sx} ${sy} H ${sx + STUB} V ${between} H ${tx - STUB} V ${ty} H ${tx}`;
    }
    paths.push({ id: edge.id, d, conflict });
  }
  return paths;
}
