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

import type { SummarySegment } from '../lib/node-summary';

/** What the canvas hands each node. */
export interface AutomationNodeData extends Record<string, unknown> {
  category: AutomationNodeType | 'PLACEHOLDER';
  /** What this step does, resolved to real names and split for display. */
  summary: SummarySegment[];
  /** The same sentence as one string, for the accessible name. */
  label: string;
  /** True when this step is missing something it needs. */
  invalid: boolean;
  onOpen?: () => void;
  /** Add a step straight after this one. Absent where that makes no sense. */
  onAddAfter?: () => void;
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
 * The accent, on the icon's tile rather than the card.
 *
 * A node filled edge to edge with saturated colour makes its own text the least
 * readable thing on the canvas, and six of them side by side stop being
 * distinguishable at all. A small tile carries the same signal at a size where
 * the colour stays decoration instead of becoming the background.
 */
const ICON_TILE: Record<string, string> = {
  TRIGGER: 'bg-primary/15 text-primary',
  CONDITION: 'bg-violet-500/15 text-violet-500',
  ACTION: 'bg-emerald-500/15 text-emerald-500',
  BRANCH: 'bg-cyan-500/15 text-cyan-500',
  DELAY: 'bg-amber-500/15 text-amber-500',
  PLACEHOLDER: 'bg-muted text-muted-foreground',
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

  /*
   * One name, used by the card and by the label read aloud.
   *
   * These were two expressions with two different fallbacks, so a placeholder
   * showed "Add a step" and announced itself as "Add" — the accessible name has
   * to contain the visible one, and somebody navigating by voice asking for
   * "add a step" would not have found it.
   */
  const heading = NODE_CATEGORY_LABEL[category as AutomationNodeType] ?? 'Add a step';

  return (
    /*
     * A wrapper, because the card is a button and the add control is another
     * one — nesting them would be invalid markup and the inner click would
     * never be the one that fired.
     */
    <div className="group relative">
      <button
        type="button"
        onClick={node.onOpen}
        aria-label={`${heading} — ${node.label}`}
        className={cn(
          'flex w-[380px] cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
          selected ? 'border-primary' : 'border-border hover:border-muted-foreground/40',
          // A step that cannot run says so in its border as well as its badge, so
          // it is findable while scanning rather than only on inspection.
          node.invalid && 'border-destructive/60',
          isPlaceholder && 'border-dashed bg-transparent shadow-none hover:bg-muted/40',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            ICON_TILE[category],
          )}
        >
          <Icon className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">{heading}</span>

          {/*
          The value is set apart from the sentence around it — "Section is
          `Incoming Request`" — so a rule can be read at a glance instead of
          word by word. Which parts are values is decided where the sentence is
          built, not here, so the card cannot disagree with the name a screen
          reader is given for the same step.
        */}
          <span
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm',
              isPlaceholder ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {node.summary.map((part, index) =>
              part.chip ? (
                <span
                  key={index}
                  className="max-w-[210px] truncate rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground"
                >
                  {part.text}
                </span>
              ) : (
                <span key={index} className="truncate">
                  {part.text}
                </span>
              ),
            )}
          </span>
        </span>

        {node.invalid && (
          <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        )}

        {/*
        Handles are the anchors edges attach to. Hidden rather than absent:
        React Flow needs them positioned to route an edge, and a visible dot on
        every node reads as something to drag when connections are made by
        adding steps, not by drawing lines.
      */}
        <Handle
          type="target"
          position={Position.Left}
          className="!opacity-0"
          isConnectable={false}
        />
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

      {/*
        Revealed on hover, and on keyboard focus.
        
        A permanent button on every card is a second thing to read on every
        step; one that only ever appears on hover cannot be reached without a
        mouse. `group-focus-within` covers both, so tabbing through the rule
        surfaces the same control a pointer does.
      */}
      {node.onAddAfter && (
        <button
          type="button"
          aria-label={`Add a step after: ${node.label}`}
          onClick={node.onAddAfter}
          className={cn(
            'absolute -right-3 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-opacity',
            'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
            'hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
          )}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
