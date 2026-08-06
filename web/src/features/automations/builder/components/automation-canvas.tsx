import type { AutomationGraph, AutomationMetadata } from '@coretask/types';
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
import { useEffect, useMemo } from 'react';

import '@xyflow/react/dist/style.css';

import { AutomationNode, type AutomationNodeData } from '../nodes/automation-node';
import { isNodeIncomplete, summarise } from '../lib/node-summary';

/** Registered once, outside render: a new object each time remounts every node. */
const nodeTypes = { automation: AutomationNode };

interface Props {
  graph: AutomationGraph;
  metadata: AutomationMetadata | undefined;
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
  onOpenNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
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

function Canvas({ graph, metadata, selectedId, onSelect, onOpenNode, onMoveNode }: Props) {
  const { fitView } = useReactFlow();

  const nodes = useMemo<Node<AutomationNodeData>[]>(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: 'automation',
        position: node.position,
        selected: node.id === selectedId,
        data: {
          category: node.type,
          summary: summarise(node, metadata),
          invalid: isNodeIncomplete(node),
          onOpen: () => onOpenNode(node.id),
        },
      })),
    [graph.nodes, metadata, selectedId, onOpenNode],
  );

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.kind === 'DEFAULT' ? {} : { sourceHandle: 'branch' }),
        ...(edge.label ? { label: edge.label } : {}),
        type: 'smoothstep',
        animated: false,
        style: { strokeWidth: 1.5 },
      })),
    [graph.edges],
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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      // Connections are made by adding steps, never by dragging between dots.
      // This is a workflow builder, not a diagram editor.
      nodesConnectable={false}
      edgesFocusable={false}
      onNodeDragStop={(_event, node) => onMoveNode(node.id, node.position)}
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
  );
}
