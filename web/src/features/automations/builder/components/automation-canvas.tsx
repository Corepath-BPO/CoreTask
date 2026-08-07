import { BranchKey } from '@coretask/contracts';
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
import { useEffect, useMemo, useRef } from 'react';

import '@xyflow/react/dist/style.css';

import { AutomationEdge } from '../nodes/automation-edge';
import { AutomationNode, type AutomationNodeData } from '../nodes/automation-node';
import type { CanvasNode } from '../lib/graph-edits';
import { layoutGraph } from '../lib/layout';
import { isNodeIncomplete, summarise, summariseParts } from '../lib/node-summary';

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
  /** Split the rule directly after `parentId`. */
  onInsertBranch: (parentId: string) => void;
  /** Add another question on this split's "otherwise" arm. */
  onAddElseIf: (branchId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onChangeTrigger: () => void;
  onDeleteNode: (nodeId: string) => void;
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
  onInsertBranch,
  onAddElseIf,
  onDuplicateNode,
  onDeleteNode,
  onChangeTrigger,
}: Props) {
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

  const nodes = useMemo<Node<AutomationNodeData>[]>(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: 'automation',
        position: placement.get(node.id) ?? node.position,
        selected: node.id === selectedId,
        data: {
          category: node.type,
          summary: summariseParts(node, metadata),
          label: summarise(node, metadata),
          invalid: isNodeIncomplete(node),
          onOpen: () => onOpenNode(node.id),
          /*
           * Only where nothing follows yet.
           *
           * The plus means "and then", so on a step that already leads
           * somewhere it would have to mean "insert between" instead — which is
           * what the control on the connection itself does. Two controls a few
           * pixels apart doing subtly different things is how somebody ends up
           * with a step in the wrong place.
           *
           * Never on a placeholder either: that card is already the invitation.
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
                onDuplicate: () => onDuplicateNode(node.id),
                // Only the trigger can be swapped for a different kind; every
                // other step is replaced by deleting it and choosing again.
                ...(node.type === 'TRIGGER' ? { onChangeTrigger } : {}),
                // Every step but the trigger. A rule with nothing to start it
                // is not a rule; the way to change what starts one is to pick a
                // different trigger.
                ...(node.type === 'TRIGGER' ? {} : { onDelete: () => onDeleteNode(node.id) }),
              }),
        },
      })),
    [
      graph.nodes,
      metadata,
      selectedId,
      onOpenNode,
      onInsertStep,
      hasFollower,
      placement,
      onDuplicateNode,
      onDeleteNode,
      onChangeTrigger,
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
          onInsertStep,
          onInsertBranch,
          /*
           * Only on the "otherwise" arm, because that is the only place the
           * offer means anything: an else-if extends the fallback, and offering
           * it on the matching arm would read as "if this matched, then ask a
           * different question", which is not what it does.
           *
           * Keyed on the arm the edge carries rather than on its label — the
           * label is words for people and will be reworded.
           */
          ...(edge.branchKey === BranchKey.ELSE ? { onAddElseIf } : {}),
        },
      })),
    [graph.edges, onInsertStep, onInsertBranch, onAddElseIf],
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
        edgesFocusable={false}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: false }}
        minZoom={0.3}
        maxZoom={1.5}
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
