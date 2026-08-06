import { NODE_CATEGORY_LABEL, type AutomationNodeType } from '@coretask/contracts';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  ArrowRight,
  Clock,
  GitBranch,
  ListFilter,
  Plus,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/** What the canvas hands each node. */
export interface AutomationNodeData extends Record<string, unknown> {
  category: AutomationNodeType | 'PLACEHOLDER';
  /** One line saying what this step does, already resolved to real names. */
  summary: string;
  /** True when this step is missing something it needs. */
  invalid: boolean;
  onOpen?: () => void;
}

const ICON: Record<string, LucideIcon> = {
  TRIGGER: Zap,
  CONDITION: ListFilter,
  ACTION: ArrowRight,
  BRANCH: GitBranch,
  DELAY: Clock,
  PLACEHOLDER: Plus,
};

/**
 * The accent, applied to a strip and an icon rather than the whole card.
 *
 * A node filled edge to edge with saturated colour makes its own text the
 * least readable thing on the canvas, and six of them side by side stop being
 * distinguishable at all.
 */
const ACCENT: Record<string, string> = {
  TRIGGER: 'bg-primary',
  CONDITION: 'bg-violet-500',
  ACTION: 'bg-emerald-500',
  BRANCH: 'bg-cyan-500',
  DELAY: 'bg-amber-500',
  PLACEHOLDER: 'bg-muted-foreground/40',
};

const ICON_TONE: Record<string, string> = {
  TRIGGER: 'text-primary',
  CONDITION: 'text-violet-500',
  ACTION: 'text-emerald-500',
  BRANCH: 'text-cyan-500',
  DELAY: 'text-amber-500',
  PLACEHOLDER: 'text-muted-foreground',
};

/**
 * One step in a rule.
 *
 * Every category renders through here rather than through six near-identical
 * components: they differ by an icon, an accent and a label, and a component
 * each is six places to fix the next time a node grows a control.
 *
 * A button, not a div with a click handler. The canvas is reachable by keyboard
 * — tab to a node, Enter to configure it — and that only works if the thing
 * being tabbed to is something a browser already knows how to focus.
 */
export function AutomationNode({ data, selected }: NodeProps) {
  const node = data as AutomationNodeData;
  const category = node.category;
  const Icon = ICON[category] ?? ArrowRight;
  const isPlaceholder = category === 'PLACEHOLDER';

  return (
    <button
      type="button"
      onClick={node.onOpen}
      aria-label={`${NODE_CATEGORY_LABEL[category as AutomationNodeType] ?? 'Add'} — ${node.summary}`}
      className={cn(
        'relative flex w-[380px] cursor-pointer items-stretch overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        selected ? 'border-primary' : 'border-border hover:border-muted-foreground/40',
        // A step that cannot run says so in its border as well as its badge, so
        // it is findable while scanning rather than only on inspection.
        node.invalid && 'border-destructive/60',
        isPlaceholder && 'border-dashed bg-transparent shadow-none',
      )}
    >
      {/* The accent strip. Decorative — the category is in the text beside it. */}
      <span aria-hidden="true" className={cn('w-1 shrink-0', ACCENT[category])} />

      <span className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3">
        <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_TONE[category])} aria-hidden="true" />

        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-muted-foreground">
            {NODE_CATEGORY_LABEL[category as AutomationNodeType] ?? 'Add a step'}
          </span>
          <span
            className={cn(
              'block truncate text-sm',
              isPlaceholder ? 'text-muted-foreground' : 'font-medium text-foreground',
            )}
          >
            {node.summary}
          </span>
        </span>

        {node.invalid && (
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        )}
      </span>

      {/*
        Handles are the anchors edges attach to. Hidden rather than absent:
        React Flow needs them positioned to route an edge, and a visible dot on
        every node reads as something to drag when connections are made by
        adding steps, not by drawing lines.
      */}
      <Handle type="target" position={Position.Left} className="!opacity-0" isConnectable={false} />
      <Handle
        type="source"
        position={Position.Right}
        className="!opacity-0"
        isConnectable={false}
      />
      <Handle
        type="source"
        id="branch"
        position={Position.Bottom}
        className="!opacity-0"
        isConnectable={false}
      />
    </button>
  );
}
