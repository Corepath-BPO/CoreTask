import { GRAPH_LAYOUT } from '@coretask/contracts';
import type { AutomationGraphEdge, AutomationMetadata } from '@coretask/types';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import '@xyflow/react/dist/style.css';

import { useTheme } from '@/stores/theme.store';

import { AutomationEdge } from '../nodes/automation-edge';
import { AutomationNode, type AutomationNodeData } from '../nodes/automation-node';
import {
  branchRows,
  fallbackRow,
  isUnansweredRow,
  withDescendants,
  type CanvasNode,
} from '../lib/graph-edits';
import { layoutGraph } from '../lib/layout';
import { isNodeIncomplete, nodeHeading, summarise, summariseParts } from '../lib/node-summary';

/** Registered once, outside render: a new object each time remounts every node. */
const nodeTypes = { automation: AutomationNode };
const edgeTypes = { automation: AutomationEdge };

interface Props {
  /** Widened for the placeholder, which the canvas draws and the database has
      no row for — see `CanvasNode`. */
  graph: { nodes: CanvasNode[]; edges: AutomationGraphEdge[] };
  metadata: AutomationMetadata | undefined;
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
  onOpenNode: (nodeId: string) => void;
  /** Add a step directly after `parentId`, before whatever follows it. */
  onInsertStep: (parentId: string) => void;
  /** Add another question on a row of its own. */
  onAddElseIf: () => void;
  /** Add the row that runs when nothing else matched. */
  onAddOtherwise: () => void;
  /**
   * Copy a step. A branch comes with its actions and lands on a row of its own
   * — the page decides which of the two this is, so every control agrees.
   */
  onDuplicateNode: (nodeId: string) => void;
  onChangeTrigger: () => void;
  /** Remove a step, or a whole branch when the step is one. */
  onDeleteNode: (nodeId: string) => void;
  /** Put a branch row at another place among the rows, counted from the top. */
  onMoveRow: (rowId: string, toIndex: number) => void;
}

/**
 * The rule, drawn.
 *
 * React Flow rather than hand-rolled panning: viewport transforms, edge routing
 * around a moving node, and pointer maths that behaves the same on a trackpad
 * and a touchscreen are a great deal of subtle work, and none of it is what
 * makes this builder good.
 *
 * The canvas owns nothing. It renders the graph it is given and reports what
 * somebody did to it — which keeps the rule's shape in one place instead of
 * being half in the editor state and half in a graph library's internals.
 */
export function AutomationCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({
  graph,
  metadata,
  selectedId,
  onSelect,
  onOpenNode,
  onInsertStep,
  onAddElseIf,
  onAddOtherwise,
  onDuplicateNode,
  onDeleteNode,
  onChangeTrigger,
  onMoveRow,
}: Props) {
  // React Flow draws its own zoom controls; told the theme, they match it.
  const { resolvedTheme } = useTheme();
  const { fitView } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  /*
   * Which steps already have something after them.
   *
   * Placeholders count: a card inviting somebody to choose an action *is* the
   * add control for that spot, so a plus beside its parent would be a second
   * one pointing at the same place.
   */
  const hasFollower = useMemo(
    () => new Set(graph.nodes.map((node) => node.parentId).filter(Boolean) as string[]),
    [graph.nodes],
  );

  /*
   * Positions come from the shape, not from the stored coordinates.
   *
   * A rule's meaning is what follows what, so the drawing has to be derived
   * from that or it describes a different rule than the one that will run —
   * insert a step in the middle and every stored position after it is recording
   * where things used to be.
   */
  const placement = useMemo(() => layoutGraph(graph.nodes), [graph.nodes]);

  const triggerIds = useMemo(
    () => new Set(graph.nodes.filter((node) => node.type === 'TRIGGER').map((node) => node.id)),
    [graph.nodes],
  );

  /*
   * Which conditions are rows, and which of those is the first.
   *
   * A card cannot tell on its own: being the rule's leading question is a fact
   * about the rule rather than about the step, and it decides both what the
   * unanswered card says and whether it carries a control to remove itself.
   */
  const rows = useMemo(() => branchRows(graph.nodes), [graph.nodes]);
  const alternatives = useMemo(() => new Set(rows.slice(1).map((row) => row.id)), [rows]);
  const fallbackId = useMemo(() => fallbackRow(graph.nodes)?.id ?? null, [graph.nodes]);

  /*
   * The rows that can be put in another order: every one but the fallback,
   * which runs when nothing above it held and so is always last. One row has
   * nowhere to go.
   */
  const movableRows = useMemo(
    () => rows.filter((row) => row.id !== fallbackId),
    [rows, fallbackId],
  );

  /*
   * A row being dragged, and how far it has moved.
   *
   * The canvas owns no positions — they are derived from the rule — so a drag
   * is held here as an offset over the layout until it is dropped, and the
   * drop becomes an edit to the rule's order. The row's actions move with it:
   * a question dragged away from its answers would be a different rule for as
   * long as the drag lasted.
   */
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null);
  const dragged = useMemo(
    () => (drag ? new Set(withDescendants(graph.nodes, drag.id)) : null),
    [drag, graph.nodes],
  );

  /**
   * Where among the movable rows a row dropped at this height lands: the
   * nearest line. A row passes another once it is more than halfway to the
   * next line, so dropping it mostly over a row takes that row's place rather
   * than needing to be pushed past its top edge.
   */
  const dropIndex = (rowId: string, y: number) =>
    movableRows.filter(
      (row) =>
        row.id !== rowId && (placement.get(row.id)?.y ?? 0) + GRAPH_LAYOUT.BRANCH_GAP / 2 < y,
    ).length;

  /*
   * The one connection that carries the "Add branch" pill.
   *
   * Every branch hangs off the trigger, so every one of those connections looks
   * alike to an edge — and offering the pill on each drew three identical
   * buttons down the spine of a three-branch rule. The last row's is the one
   * that means anything: a branch added from there appears directly beneath it.
   *
   * A rule with no branches at all still needs somewhere to start one, so it
   * falls back to whatever the trigger leads to first.
   */
  const branchTailId = useMemo(() => {
    const last = rows.at(-1);
    if (last) return last.id;

    const trigger = graph.nodes.find((node) => node.type === 'TRIGGER');
    if (!trigger) return null;

    return (
      graph.nodes
        .filter((node) => node.parentId === trigger.id)
        .sort((a, b) => a.order - b.order)[0]?.id ?? null
    );
  }, [rows, graph.nodes]);

  const nodes = useMemo<Node<AutomationNodeData>[]>(
    () =>
      graph.nodes.map((node) => {
        const place = { alternative: alternatives.has(node.id) };
        const laidOut = placement.get(node.id) ?? node.position;
        const rowIndex = movableRows.findIndex((row) => row.id === node.id);
        const movable = rowIndex >= 0 && movableRows.length > 1;

        return {
          id: node.id,
          type: 'automation',
          // Down or up by the drag, never sideways: a row's place is its line.
          position:
            drag && dragged?.has(node.id) ? { x: laidOut.x, y: laidOut.y + drag.dy } : laidOut,
          ...(movable ? { draggable: true, dragHandle: '.branch-drag-handle' } : {}),
          selected: node.id === selectedId,
          data: {
            category: node.type,
            // The fallback is a condition by node type and reads as nothing
            // like one, so the card is told which it is rather than inferring
            // it from the words above the sentence.
            isFallback: node.id === fallbackId,
            heading: nodeHeading(node, place),
            summary: summariseParts(node, metadata, place),
            label: summarise(node, metadata, place),
            invalid: isNodeIncomplete(node),
            onOpen: () => onOpenNode(node.id),
            ...(movable
              ? {
                  draggable: true,
                  ...(rowIndex > 0 ? { onMoveUp: () => onMoveRow(node.id, rowIndex - 1) } : {}),
                  ...(rowIndex < movableRows.length - 1
                    ? { onMoveDown: () => onMoveRow(node.id, rowIndex + 1) }
                    : {}),
                }
              : {}),
            /*
             * Only where nothing follows yet.
             *
             * The plus means "and then", so on a step that already leads
             * somewhere it would have to mean "insert between" instead — which
             * is what the control on the connection itself does. Two controls a
             * few pixels apart doing subtly different things is how somebody
             * ends up with a step in the wrong place.
             *
             * Never on a placeholder either: that card is already the
             * invitation.
             */
            ...(node.type === 'PLACEHOLDER' || hasFollower.has(node.id)
              ? {}
              : { onAddAfter: () => onInsertStep(node.id) }),

            /*
             * No menu on a placeholder: there is nothing yet to copy or remove,
             * and the card already offers the only thing that applies to it.
             */
            ...(node.type === 'PLACEHOLDER'
              ? {}
              : {
                  /*
                   * Everything but the fallback can be copied.
                   *
                   * A rule falls back once — a second "otherwise" is a branch
                   * that can never run — so the offer is withdrawn rather than
                   * taken and then refused at publish.
                   */
                  ...(node.id === fallbackId
                    ? {}
                    : { onDuplicate: () => onDuplicateNode(node.id) }),
                  // Only the trigger can be swapped for a different kind; every
                  // other step is replaced by deleting it and choosing again.
                  ...(node.type === 'TRIGGER' ? { onChangeTrigger } : {}),
                  // Every step but the trigger. A rule with nothing to start it
                  // is not a rule; the way to change what starts one is to pick a
                  // different trigger.
                  ...(node.type === 'TRIGGER' ? {} : { onDelete: () => onDeleteNode(node.id) }),
                }),

            /*
             * A question nobody has answered carries its own way out.
             *
             * The connector's menu can remove any branch, but one still reading
             * "+ Otherwise if…" is a half-finished thing in the middle of a
             * rule — the way back from it has to be visible on the card rather
             * than a hover away, or the only obvious move is to answer a
             * question that was a mis-click.
             *
             * Never on the first row: that one is the rule's own question, and
             * removing it leaves a rule that runs every time.
             */
            ...(alternatives.has(node.id) && isUnansweredRow(node)
              ? { onRemove: () => onDeleteNode(node.id) }
              : {}),
          },
        };
      }),
    [
      graph.nodes,
      metadata,
      selectedId,
      onOpenNode,
      onInsertStep,
      hasFollower,
      placement,
      alternatives,
      fallbackId,
      onDuplicateNode,
      onDeleteNode,
      onChangeTrigger,
      onMoveRow,
      movableRows,
      drag,
      dragged,
    ],
  );

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.kind === 'DEFAULT' ? {} : { sourceHandle: 'branch' }),
        ...(edge.label ? { label: edge.label } : {}),
        type: 'automation',
        animated: false,
        data: {
          onAddElseIf,
          // A rule falls back once, so the row that does cannot be copied.
          ...(edge.target === fallbackId ? {} : { onDuplicate: onDuplicateNode }),
          onDelete: onDeleteNode,
          onAddOtherwise,

          /*
           * Offered once, because a rule can only fall back once.
           *
           * A second "otherwise" is a row that can never run — the first one
           * always holds — so the menu stops offering it rather than letting
           * somebody build a branch and be told about it at publish.
           */
          hasFallback: fallbackId !== null,

          /*
           * Only the trigger's own connection carries the branch controls.
           *
           * Every branch is a row hanging off the trigger, so there is one place
           * to add one — and a control between a check and its action would be
           * offering a branch where none can go.
           */
          ...(triggerIds.has(edge.source) ? { isJunction: true } : {}),

          // And exactly one of them carries the pill — see `branchTailId`.
          ...(triggerIds.has(edge.source) && edge.target === branchTailId
            ? { isBranchTail: true }
            : {}),
        },
      })),
    [
      graph.edges,
      onAddElseIf,
      onAddOtherwise,
      onDuplicateNode,
      onDeleteNode,
      fallbackId,
      branchTailId,
      triggerIds,
    ],
  );

  /*
   * Fit once the graph has a shape, not on every change.
   *
   * Refitting whenever a node moves fights the person moving it — the viewport
   * jumps as they drag. Keyed on the node count so adding or removing a step
   * brings the new shape into view and nothing else does.
   */
  useEffect(() => {
    if (graph.nodes.length === 0) return;

    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
    });

    return () => cancelAnimationFrame(frame);
  }, [graph.nodes.length, fitView]);

  /*
   * And again whenever the canvas itself changes size.
   *
   * Opening the side panel takes 360px off the drawing surface without changing
   * the rule, so nothing about the graph says to look again and the last step
   * ends up behind the panel. Watching the element rather than the thing that
   * moved it means this is right for a resized window too, and it cannot fire
   * before the new width exists — which is what made keying it on the panel's
   * own state measure the layout one frame too early.
   */
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;

    let frame = 0;
    let first = true;

    const observer = new ResizeObserver(() => {
      // The observer fires once on attach, which would refit for no reason.
      if (first) {
        first = false;
        return;
      }

      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
      });
    });

    observer.observe(element);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitView]);

  return (
    <div ref={wrapper} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Connections are made by adding steps, never by dragging between dots.
        // This is a workflow builder, not a diagram editor.
        nodesConnectable={false}
        /*
         * And steps are not dragged either.
         *
         * The arrangement is what says which arm a step is on and what follows
         * what, so a step dragged somewhere else would be drawing a rule that
         * does not exist. Position is a consequence of the rule here rather
         * than a property of it, which also means it can never be saved wrong.
         */
        nodesDraggable={false}
        /*
         * …except a branch row, by its handle. Moving a row changes nothing
         * about what follows what — only which question is asked first — so
         * it is the one drag that draws a rule that exists. Dropped, it is an
         * edit to the rows' order, and the layout puts it on its new line.
         */
        onNodeDrag={(_event, node) => {
          const from = placement.get(node.id);
          if (from) setDrag({ id: node.id, dy: node.position.y - from.y });
        }}
        onNodeDragStop={(_event, node) => {
          setDrag(null);
          onMoveRow(node.id, dropIndex(node.id, node.position.y));
        }}
        edgesFocusable={false}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: false }}
        minZoom={0.3}
        maxZoom={1.5}
        colorMode={resolvedTheme}
        className="bg-background"
      >
        {/* A very faint grid: enough to say the surface pans, quiet enough that
          the nodes stay the thing being read. */}
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="opacity-40" />
        <Controls showInteractive={false} className="!shadow-sm" />
      </ReactFlow>
    </div>
  );
}
