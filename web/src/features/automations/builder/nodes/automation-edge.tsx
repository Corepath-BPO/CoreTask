import { GRAPH_LAYOUT } from '@coretask/contracts';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { CopyPlus, GitBranch, MoreHorizontal, Plus, Trash2 } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** What the canvas hands each edge. */
export interface AutomationEdgeData extends Record<string, unknown> {
  /** Ask another question, on a row of its own under the trigger. */
  onAddElseIf?: () => void;
  /** Copy the step this connector leads to, along with what follows it. */
  onDuplicate?: (nodeId: string) => void;
  /** Remove the step this connector leads to. */
  onDelete?: (nodeId: string) => void;
  /**
   * The connection leaving the trigger, which owns the rule's branch line.
   *
   * Every branch hangs off the same trigger, so there is one place to start
   * one. Repeating the control on every connection offered a branch between a
   * check and its action, where a branch cannot go — and made three identical
   * dots on a three-step rule, only one of which meant anything.
   */
  isJunction?: boolean;
  /**
   * The connection to the last branch, which carries the pill.
   *
   * One pill per rule, not one per connection. Every branch is a row hanging
   * off the same trigger, so with three of them every junction qualified and
   * the canvas grew three identical "Add branch" buttons stacked down the
   * spine — three doors into one room, and a rule that reads as a mess.
   *
   * The last one, because that is where the branch it adds will appear: the
   * control sits exactly where its result does.
   */
  isBranchTail?: boolean;
  /** The fallback: actions with no question, for when nothing else matched. */
  onAddOtherwise?: () => void;
  /** Whether the rule already falls back, so the offer is not made twice. */
  hasFallback?: boolean;
}

/**
 * How far below the last branch the pill hangs.
 *
 * Half a row down, measured from the connection point rather than from the top
 * of the card: that clears a card of the usual height with room to spare, and
 * lands exactly where the next row's own connector will be — so the branch
 * appears where the control that made it was.
 */
const TAIL_DROP = GRAPH_LAYOUT.BRANCH_GAP / 2;

/** The connector dot, in pixels. Keep in step with `size-6` on it below. */
const DOT_SIZE = 24;

/**
 * The dashed tail, in the wrapper's own coordinates.
 *
 * The wrapper is centred on the dot, so the tail begins one radius down — the
 * dot's lower edge, with no gap for the eye to catch — and ends where the pill
 * hangs, half a row below the corner.
 */
const TAIL_TOP = DOT_SIZE;
const TAIL_HEIGHT = TAIL_DROP - DOT_SIZE / 2;

/**
 * The line between two steps, and the place to add one.
 *
 * The connection is where somebody is already looking when they think "and then
 * something should happen here" — so that is where the control lives, rather
 * than in a toolbar that can only ever mean "at the end". A rule built from a
 * toolbar has to be built in order; a rule built from its edges can be built in
 * any order, which is how people actually think one through.
 *
 * Collapsed to a small dot until asked. Every edge carrying a permanent pair of
 * buttons turns a five-step rule into fifteen controls, and the steps stop being
 * the thing being read.
 */
export function AutomationEdge({
  id,
  label,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const actions = (data ?? {}) as AutomationEdgeData;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  /*
   * A branch's controls sit on the corner its line turns at.
   *
   * The path down to the third row is an L: right from the trigger, down the
   * spine, then right again into the card. Its midpoint — which is what the
   * path hands back for a label — is halfway down the vertical, level with the
   * row above; a dot there governs one branch while sitting beside a different
   * one, and with three rows stacked, guessing wrong deletes the wrong branch.
   *
   * The corner is the one point that belongs to this row and no other: where
   * its own horizontal leaves the shared spine. Derived from the geometry
   * rather than nudged into place — the vertical runs midway between the two
   * columns, and it turns at the height of the card it is heading for. A rule
   * whose branch is level with the trigger has no corner to speak of, and the
   * same expression gives the midpoint of that straight line.
   */
  const onSpine = Boolean(actions.isJunction || actions.isBranchTail);
  const anchorX = onSpine ? (sourceX + targetX) / 2 : labelX;
  const anchorY = onSpine ? targetY : labelY;

  return (
    <>
      <BaseEdge id={id} path={path} style={{ strokeWidth: 1.5 }} />

      <EdgeLabelRenderer>
        {/*
          `pointer-events-auto` on the controls only: the label layer covers the
          whole canvas, and making all of it clickable would swallow panning.
        */}
        <div
          className="nodrag nopan pointer-events-none absolute"
          style={{ transform: `translate(-50%, -50%) translate(${anchorX}px, ${anchorY}px)` }}
        >
          {/*
            Which arm this is, beside the control rather than above it.

            Two arms leaving a split look like two identical paths until one of
            them says "otherwise" — and the wording comes from the same function
            the API uses, so a rule cannot be described one way on the canvas and
            another way in a response.

            To the left because above is where the card is: an arm rising back
            towards the split put its label underneath that card, where the only
            labelled arm was the one going the other way.
          */}
          {label && (
            <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {label}
            </span>
          )}

          {/*
            The connector's own menu: what can be done to the step it leads to.
            
            A branch is read along this line rather than on the card — the card
            says what it checks, the connector says where it sits — so the
            things that move or remove the whole row belong here.
          */}
          {actions.isJunction && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More for this branch"
                  className={cn(
                    'pointer-events-auto flex size-6 cursor-pointer items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors',
                    'hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                    'data-[state=open]:border-primary data-[state=open]:text-primary',
                  )}
                >
                  <MoreHorizontal className="size-3.5" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="start">
                {/* The whole row — its question and the actions under it — on a
                    line of its own directly below. Absent on the fallback,
                    which a rule can only have one of. */}
                {actions.onDuplicate && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={() => actions.onDuplicate?.(target)}
                  >
                    <CopyPlus className="size-4" aria-hidden="true" />
                    Duplicate branch
                  </DropdownMenuItem>
                )}

                {/*
                  No "add branch below" here any more.

                  The pill immediately beneath this menu is the one place a
                  branch starts, and an entry doing the same thing four pixels
                  away was a second door into one room — which is how a branch
                  lands somewhere nobody meant. It also built the old shape: a
                  split with two arms rather than a row of its own.
                */}
                <DropdownMenuItem
                  className="cursor-pointer text-destructive focus:text-destructive"
                  onSelect={() => actions.onDelete?.(target)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/*
            The branch control: one per rule, at the foot of the spine.

            Inside this wrapper rather than anchored to the graph on its own,
            because the wrapper is already centred on the dot — so `left-1/2`
            here *is* the spine, and the dashed line, the pill and the dot share
            one centre by construction. Given its own anchor it drifted half a
            pill-width to the left, which looked like a stub beside the rule.

            And the dot it hangs from is on the corner of the last row, so the
            tail continues the spine straight down from where the drawn line
            stops rather than starting somewhere along it.
          */}
          {actions.isBranchTail && (
            <div
              className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center"
              style={{ top: `${TAIL_TOP}px` }}
            >
              <span
                aria-hidden="true"
                style={{ height: `${TAIL_HEIGHT}px` }}
                className="w-px border-l border-dashed border-muted-foreground/50"
              />

              {/*
              Two named kinds, asked before anything is built.

              "Add branch" on its own decided for somebody: it made a split with
              a question on it, when what they wanted may have been the fallback
              that runs when nothing matched. Those are different things and the
              words are the only place to tell them apart, so the question comes
              before the shape.
            */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="pointer-events-auto flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:border-primary"
                  >
                    <GitBranch className="size-3.5" aria-hidden="true" />
                    Add branch
                  </button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="start" className="w-[300px]">
                  <DropdownMenuItem
                    className="cursor-pointer flex-col items-start gap-0.5"
                    onSelect={() => actions.onAddElseIf?.()}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Plus className="size-3.5" aria-hidden="true" />
                      Otherwise if…
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Add another set of conditions and actions to this rule.
                    </span>
                  </DropdownMenuItem>

                  {/*
                  Offered while the rule has no fallback, and then not.

                  A rule can only fall back once — the first "otherwise" always
                  runs when nothing else matched, so a second one is a branch
                  that never can. Withdrawing the offer says that before anybody
                  builds one; a validation error afterwards says it too late to
                  be any help.
                */}
                  {!actions.hasFallback && (
                    <DropdownMenuItem
                      className="cursor-pointer flex-col items-start gap-0.5"
                      onSelect={() => actions.onAddOtherwise?.()}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Plus className="size-3.5" aria-hidden="true" />
                        Otherwise
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Add actions that will run if all other conditions are not met.
                      </span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
