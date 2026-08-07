import type { AutomationNodeType } from '@coretask/contracts';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  ArrowRight,
  Clock,
  Copy,
  CornerDownRight,
  GitBranch,
  ListFilter,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import type { SummarySegment } from '../lib/node-summary';

/** What the canvas hands each node. */
export interface AutomationNodeData extends Record<string, unknown> {
  category: AutomationNodeType | 'PLACEHOLDER';
  /**
   * The category line: what kind of step this is.
   *
   * Handed in rather than looked up from the category, because the fallback row
   * is a condition by node type and "Check if" is precisely what it does not do
   * — and the words a card says are decided in one place, beside the sentence
   * underneath them.
   */
  heading: string;
  /**
   * The row that runs when nothing else matched.
   *
   * A condition by node type, and nothing like one to read: it asks no
   * question. The glyph says so — an arrow rather than the filter every other
   * condition carries — which is the difference somebody sees before they have
   * read a word of the card.
   */
  isFallback?: boolean;
  /** What this step does, resolved to real names and split for display. */
  summary: SummarySegment[];
  /** The same sentence as one string, for the accessible name. */
  label: string;
  /** True when this step is missing something it needs. */
  invalid: boolean;
  onOpen?: () => void;
  /** Add a step straight after this one. Absent where that makes no sense. */
  onAddAfter?: () => void;
  /** A copy of this step, running immediately after it. */
  onDuplicate?: () => void;
  /**
   * Pick a different trigger. Present only on the trigger.
   *
   * The card opens the picker while nothing is chosen and that step's settings
   * afterwards, so once a trigger was set there was no way back to the list —
   * changing it meant deleting the rule, which is not a thing anybody should
   * have to do to fix a mis-click.
   */
  onChangeTrigger?: () => void;
  /** Absent on the trigger: a rule with nothing to start it is not a rule. */
  onDelete?: () => void;
  /**
   * Take this whole branch off the rule, actions and all.
   *
   * Only on a row somebody added. It is a different act from `onDelete`, which
   * removes one step and joins the rule back up around it — a branch has to go
   * as a piece, or its actions come back as things that run every time.
   */
  onRemove?: () => void;
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
  const Icon = node.isFallback ? CornerDownRight : (ICON[category] ?? ArrowRight);
  const isPlaceholder = category === 'PLACEHOLDER';

  /*
   * One name, used by the card and by the label read aloud.
   *
   * These were two expressions with two different fallbacks, so a placeholder
   * showed "Add a step" and announced itself as "Add" — the accessible name has
   * to contain the visible one, and somebody navigating by voice asking for
   * "add a step" would not have found it.
   *
   * A card can have no heading at all — an unanswered branch is one line that
   * says everything — and the name is then the line itself rather than a dash
   * with nothing in front of it.
   */
  const heading = node.heading;
  const name = heading ? `${heading} — ${node.label}` : node.label;

  return (
    /*
     * A wrapper, because the card is a button and the add control is another
     * one — nesting them would be invalid markup and the inner click would
     * never be the one that fired.
     */
    // `nodrag nopan` so a click on a menu is not read as a gesture on the canvas.
    <div className="nodrag nopan group relative">
      <button
        type="button"
        onClick={node.onOpen}
        aria-label={name}
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
          {/* Absent, not empty: a blank line still takes a line, and this card
              is a single sentence when it has no category to name. */}
          {heading && <span className="block text-xs text-muted-foreground">{heading}</span>}

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
          <AlertCircle
            // Room for whatever sits at the right-hand edge: the menu alone, or
            // the menu with the remove control beside it.
            className={cn('size-4 shrink-0 text-destructive', node.onRemove ? 'mr-13' : 'mr-6')}
            aria-hidden="true"
          />
        )}

        {/*
        Handles are the anchors edges attach to. Hidden rather than absent:
        React Flow needs them positioned to route an edge, and a visible dot on
        every node reads as something to drag when connections are made by
        adding steps, not by drawing lines.

        Anchored a fixed distance from the top, not at half the height.

        A card grows when its summary wraps, and the layout places cards by
        their top edge — so two neighbours on the same line have their tops
        aligned and their middles at different heights. Handles at 50% therefore
        put the two ends of one edge at different heights, and the line between
        them came out as a step. Measuring from the top instead makes every
        connection point the same distance down, which is level by construction
        however tall any card happens to be.

        The distance is the middle of the icon tile: `py-2.5` of padding plus
        half of a `size-8` tile. Keep it in step with those two if either
        changes.
      */}
        <Handle
          type="target"
          position={Position.Left}
          className="!top-[26px] !translate-y-0 !opacity-0"
          isConnectable={false}
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!top-[26px] !translate-y-0 !opacity-0"
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
        The step's own menu, on the card rather than only in the side panel.
        
        Deleting the third of five steps means finding it, opening it, then
        deleting it — three acts for one intention. Here it is where the step
        is, which is where somebody already is when they decide.
      */}
      {(node.onDuplicate || node.onDelete || node.onChangeTrigger) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More for: ${node.label}`}
              className={cn(
                'absolute top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-opacity',
                // Out of the way of the remove control, which is permanent and
                // therefore owns the corner where the two would otherwise sit.
                node.onRemove ? 'right-9' : 'right-2',
                'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
                'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              )}
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            {node.onChangeTrigger && (
              <DropdownMenuItem className="cursor-pointer" onSelect={node.onChangeTrigger}>
                <Zap className="size-4" aria-hidden="true" />
                Change trigger
              </DropdownMenuItem>
            )}
            {node.onDuplicate && (
              <DropdownMenuItem className="cursor-pointer" onSelect={node.onDuplicate}>
                <Copy className="size-4" aria-hidden="true" />
                Duplicate
              </DropdownMenuItem>
            )}
            {node.onDelete && (
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onSelect={node.onDelete}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/*
        On the card, not behind a hover.

        A branch nobody has answered yet is a question sitting in the middle of
        a rule, and the way back out of it has to be as visible as the card
        itself — hidden until hover, the only obvious move is to answer a
        question that was very likely a mis-click.
      */}
      {node.onRemove && (
        <button
          type="button"
          aria-label={`Remove branch: ${node.label}`}
          onClick={node.onRemove}
          className={cn(
            'absolute right-2 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors',
            'hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}

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
