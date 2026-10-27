import type { AutomationGraphEdge, AutomationMetadata } from '@coretask/types';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
} from '@xyflow/react';
import {
  List,
  ListCollapse,
  Map as MapIcon,
  Maximize,
  Minus,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import '@xyflow/react/dist/style.css';

import { useTheme } from '@/stores/theme.store';
import { cn } from '@/lib/utils';

import {
  AddPathNode,
  FlowBlockNode,
  type AddPathData,
  type FlowBlockData,
  type FlowLine,
} from '../nodes/flow-block-node';
import { FLOW_CARD_WIDTH, FLOW_COLUMN_GAP, flowLayout } from '../lib/flow-blocks';
import { branchRows, fallbackRow, type CanvasNode } from '../lib/graph-edits';
import { isNodeIncomplete, summarise, summariseParts } from '../lib/node-summary';

/** Registered once, outside render: a new object each time remounts every card. */
const nodeTypes = { block: FlowBlockNode, addPath: AddPathNode };

interface Props {
  /** Widened for the placeholder, which the canvas draws and the database has
      no row for — see `CanvasNode`. */
  graph: { nodes: CanvasNode[]; edges: AutomationGraphEdge[] };
  metadata: AutomationMetadata | undefined;
  /** The project the rule belongs to, named on the trigger card. */
  projectName?: string;
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
  onOpenNode: (nodeId: string) => void;
  /** Add a step directly after `parentId`, before whatever follows it. */
  onInsertStep: (parentId: string) => void;
  /** Add another path beside the others. */
  onAddElseIf: () => void;
  /** Add the path that runs when nothing else matched. */
  onAddOtherwise: () => void;
  /** Copy a step; a path comes with its actions. */
  onDuplicateNode: (nodeId: string) => void;
  onChangeTrigger: () => void;
  /** Remove a step, or a whole path when the step is one. */
  onDeleteNode: (nodeId: string) => void;
  /** Put a path at another place among the paths, counted from the left. */
  onMoveRow: (rowId: string, toIndex: number) => void;
}

/**
 * The rule, drawn the way the Asana teams read rules: the trigger at the top,
 * its paths side by side beneath it, and each path's actions in one numbered
 * card. See `docs/architecture/automation-builder-layout.md`.
 *
 * The canvas owns nothing. It renders the graph it is given and reports what
 * somebody did to it, so the rule's shape stays in one place.
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
  projectName,
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
  const { resolvedTheme } = useTheme();
  const { fitView } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showMap, setShowMap] = useState(false);

  /*
   * Card heights once drawn.
   *
   * A card's height depends on how its sentences wrap, which only the browser
   * knows. The first frame places cards by estimate; this reads what React Flow
   * measured and the layout runs again with real heights. Read as one string so
   * an unchanged measurement is no change at all.
   *
   * Each height is handed back on its node as `measured`. React Flow forgets a
   * node's size when it is given a node without one, and a card that did not
   * change size is never measured again — so without this, the re-render the
   * heights cause would make every card forget its size and stay hidden.
   */
  const measured = useStore((state) =>
    [...state.nodeLookup.values()]
      .filter((node) => (node.measured?.height ?? 0) > 0 && (node.measured?.width ?? 0) > 0)
      .map(
        (node) =>
          `${node.id}\u0000${Math.round(node.measured?.width ?? 0)}\u0000${Math.round(node.measured?.height ?? 0)}`,
      )
      .join('\u0001'),
  );
  const sizes = useMemo(
    () =>
      new Map(
        measured
          .split('\u0001')
          .filter(Boolean)
          .map((entry) => entry.split('\u0000') as [string, string, string])
          .map(
            ([id, width, height]) =>
              [id, { width: Number(width), height: Number(height) }] as const,
          ),
      ),
    [measured],
  );

  const layout = useMemo(
    () =>
      flowLayout(graph.nodes, {
        collapsed,
        heights: new Map([...sizes].map(([id, size]) => [id, size.height])),
      }),
    [graph.nodes, collapsed, sizes],
  );

  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const rows = useMemo(() => branchRows(graph.nodes), [graph.nodes]);
  const fallbackId = useMemo(() => fallbackRow(graph.nodes)?.id ?? null, [graph.nodes]);
  // The fallback runs when nothing above it held, so it stays last and cannot move.
  const movableRows = useMemo(
    () => rows.filter((row) => row.id !== fallbackId),
    [rows, fallbackId],
  );

  const blockNodes = useMemo<Node<FlowBlockData>[]>(
    () =>
      layout.blocks.map((block) => {
        const lineFor = (nodeId: string, index: number): FlowLine => {
          const node = byId.get(nodeId) as CanvasNode;
          // A path's own question is moved, copied and removed with the path,
          // from the card's menu; the checks after it are steps of their own.
          const isRow = block.kind === 'PATH' && index === 0;
          const number = layout.numbers.get(nodeId);

          return {
            nodeId,
            category: node.type,
            ...(number !== undefined ? { number } : {}),
            summary: summariseParts(node, metadata),
            label: summarise(node, metadata),
            invalid: isNodeIncomplete(node),
            ...(node.id === fallbackId ? { isFallback: true } : {}),
            selected: nodeId === selectedId,
            ...(node.type === 'TRIGGER' ? { onChangeTrigger } : {}),
            ...(node.type !== 'TRIGGER' && node.type !== 'PLACEHOLDER' && !isRow
              ? { onDuplicate: () => onDuplicateNode(nodeId), onDelete: () => onDeleteNode(nodeId) }
              : {}),
          };
        };

        const rowId = block.kind === 'PATH' ? block.nodeIds[0] : undefined;
        const rowIndex = rowId ? movableRows.findIndex((row) => row.id === rowId) : -1;
        const lastId = block.nodeIds[block.nodeIds.length - 1] as string;
        const last = byId.get(lastId);
        const paths = rows.filter((row) => row.id !== fallbackId).length;

        const data: FlowBlockData = {
          kind: block.kind,
          title:
            block.kind === 'TASK'
              ? 'Task'
              : block.kind === 'TRIGGER'
                ? 'Trigger'
                : (block.pathLabel ?? 'Check if'),
          ...(block.kind === 'TRIGGER' && projectName ? { projectName } : {}),
          lines: block.nodeIds.map(lineFor),
          collapsed,
          onOpenLine: onOpenNode,
          ...(rowId
            ? {
                pathMenu: {
                  ...(rowIndex > 0 ? { onMoveLeft: () => onMoveRow(rowId, rowIndex - 1) } : {}),
                  ...(rowIndex >= 0 && rowIndex < movableRows.length - 1
                    ? { onMoveRight: () => onMoveRow(rowId, rowIndex + 1) }
                    : {}),
                  // A rule falls back once, so the fallback cannot be copied.
                  ...(rowId === fallbackId ? {} : { onDuplicate: () => onDuplicateNode(rowId) }),
                  onDelete: () => onDeleteNode(rowId),
                },
              }
            : {}),
          // A step still being chosen is already the invitation to add one.
          ...(block.endsColumn && last?.type !== 'PLACEHOLDER'
            ? {
                add: {
                  onAddAction: () => onInsertStep(lastId),
                  pathLabel: paths === 0 ? 'Check if' : 'Else if',
                  onAddPath: onAddElseIf,
                  ...(fallbackId === null && paths > 0 ? { onAddOtherwise } : {}),
                },
              }
            : {}),
        };

        return {
          id: block.id,
          type: 'block',
          position: layout.positions.get(block.id) ?? { x: 0, y: 0 },
          // Handed back so a re-render does not make React Flow forget it; see `heights`.
          ...(sizes.has(block.id)
            ? { measured: sizes.get(block.id) as { width: number; height: number } }
            : {}),
          data,
          draggable: false,
          selectable: false,
        };
      }),
    [
      layout,
      sizes,
      byId,
      rows,
      movableRows,
      fallbackId,
      metadata,
      projectName,
      selectedId,
      collapsed,
      onOpenNode,
      onInsertStep,
      onAddElseIf,
      onAddOtherwise,
      onDuplicateNode,
      onDeleteNode,
      onChangeTrigger,
      onMoveRow,
    ],
  );

  /*
   * "Add path", to the right of the last path, at the paths' height — Asana's
   * "Add branch". Only once there is a path: before that, the + under the
   * trigger's column offers the first one as "Check if".
   */
  const nodes = useMemo<Node[]>(() => {
    const paths = layout.blocks.filter((block) => block.kind === 'PATH');
    const first = paths[0] ? layout.positions.get(paths[0].id) : undefined;
    if (!first) return blockNodes;

    const lastColumn = Math.max(...layout.blocks.map((block) => block.column));
    const data: AddPathData = {
      onAddPath: onAddElseIf,
      ...(fallbackId === null ? { onAddOtherwise } : {}),
    };
    return [
      ...blockNodes,
      {
        id: 'add-path',
        type: 'addPath',
        // Handed back like every card's; see `sizes`.
        ...(sizes.has('add-path')
          ? { measured: sizes.get('add-path') as { width: number; height: number } }
          : {}),
        position: { x: (lastColumn + 1) * (FLOW_CARD_WIDTH + FLOW_COLUMN_GAP), y: first.y },
        data,
        draggable: false,
        selectable: false,
      },
    ];
  }, [blockNodes, layout, sizes, fallbackId, onAddElseIf, onAddOtherwise]);

  const edges = useMemo<Edge[]>(
    () =>
      layout.blocks
        .filter((block) => block.parentId !== null)
        .map((block) => ({
          id: `${block.parentId}->${block.id}`,
          source: block.parentId as string,
          target: block.id,
          type: 'smoothstep',
          pathOptions: { borderRadius: 10 },
          style: { strokeWidth: 1.5 },
          focusable: false,
        })),
    [layout.blocks],
  );

  /*
   * Fit once the rule has a shape, and again when a card is added or removed —
   * not on every change, which would fight somebody panning around it.
   */
  const blockCount = layout.blocks.length;
  // Once every card has its real height too: the first fit is on estimates, and
  // a tall card measured afterwards would push the last one out of view.
  const allMeasured = layout.blocks.every((block) => sizes.has(block.id));
  useEffect(() => {
    if (blockCount === 0) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.15, maxZoom: 1, duration: 200 });
    });
    return () => cancelAnimationFrame(frame);
  }, [blockCount, collapsed, allMeasured, fitView]);

  /*
   * And when the canvas itself changes size: opening the side panel narrows the
   * drawing without changing the rule, and the last column would end up behind
   * it.
   */
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    let frame = 0;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void fitView({ padding: 0.15, maxZoom: 1, duration: 200 });
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
        // Steps are added from the cards, never by drawing lines between them,
        // and where a card sits follows from the rule, so nothing is dragged.
        nodesConnectable={false}
        nodesDraggable={false}
        edgesFocusable={false}
        /*
         * A node that can be neither selected nor dragged and has no click
         * handler gets no pointer events from React Flow, so every click on a
         * card fell through to the canvas. The lines inside each card handle
         * their own clicks; this only keeps the cards clickable.
         */
        onNodeClick={() => undefined}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: false }}
        minZoom={0.2}
        maxZoom={1.5}
        colorMode={resolvedTheme}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} className="opacity-60" />
        <Panel position="top-left" className="!m-3">
          <Toolbar
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            showMap={showMap}
            onShowMapChange={setShowMap}
          />
        </Panel>
        {showMap && <MiniMap pannable zoomable className="!rounded-lg !border !border-border" />}
      </ReactFlow>
    </div>
  );
}

/** Fit, zoom, the minimap, and expanded or collapsed cards: the left-hand tools. */
function Toolbar({
  collapsed,
  onCollapsedChange,
  showMap,
  onShowMapChange,
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  showMap: boolean;
  onShowMapChange: (show: boolean) => void;
}) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col rounded-lg border border-border bg-card p-1 shadow-sm">
        <ToolButton
          icon={Maximize}
          label="Fit to view"
          onClick={() => void fitView({ padding: 0.15, duration: 200 })}
        />
        <ToolButton icon={Plus} label="Zoom in" onClick={() => void zoomIn({ duration: 150 })} />
        <ToolButton icon={Minus} label="Zoom out" onClick={() => void zoomOut({ duration: 150 })} />
        <ToolButton
          icon={MapIcon}
          label={showMap ? 'Hide minimap' : 'Show minimap'}
          pressed={showMap}
          onClick={() => onShowMapChange(!showMap)}
        />
      </div>
      <div className="flex flex-col rounded-lg border border-border bg-card p-1 shadow-sm">
        <ToolButton
          icon={List}
          label="Expanded view"
          pressed={!collapsed}
          onClick={() => onCollapsedChange(false)}
        />
        <ToolButton
          icon={ListCollapse}
          label="Collapsed view"
          pressed={collapsed}
          onClick={() => onCollapsedChange(true)}
        />
      </div>
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  pressed,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
        pressed && 'bg-muted text-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
