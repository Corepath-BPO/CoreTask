import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import {
  CopyPlus,
  CornerDownRight,
  GitBranch,
  MoreHorizontal,
  Plus,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** What the canvas hands each edge. */
export interface AutomationEdgeData extends Record<string, unknown> {
  /** Insert a step between the two ends of this edge. */
  onInsertStep?: (parentId: string) => void;
  /** Split the rule at this point, so what follows becomes one of two paths. */
  onInsertBranch?: (parentId: string) => void;
  /** Present only on an "otherwise" arm: ask another question before falling back. */
  onAddElseIf?: (branchId: string) => void;
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
  /** The fallback: actions with no question, for when nothing else matched. */
  onAddOtherwise?: (parentId: string) => void;
}

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
  source,
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
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
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
          {(actions.onAddElseIf || actions.isJunction) && (
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
                <DropdownMenuItem
                  className="cursor-pointer"
                  onSelect={() => actions.onDuplicate?.(target)}
                >
                  <CopyPlus className="size-4" aria-hidden="true" />
                  Duplicate branch
                </DropdownMenuItem>

                <DropdownMenuItem
                  className="cursor-pointer"
                  onSelect={() => actions.onInsertBranch?.(source)}
                >
                  <GitBranch className="size-4" aria-hidden="true" />
                  Add branch below
                </DropdownMenuItem>

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
            The branch control, always on screen rather than behind the dot.
            
            Adding a branch is a thing people come to this canvas to do, and a
            rule with a single path gives no other hint that it could have
            more — so hiding it inside a menu meant the feature only existed
            for somebody who already knew it did.
            
            Adding a *step* is not offered here at all any more. That belongs to
            the steps: the plus on a card, and the "Do this…" placeholder. Two
            doors into one room, a few pixels apart, is how a step lands
            somewhere nobody meant.
          */}
          {(actions.onAddElseIf || actions.isJunction) && (
            <div className="pointer-events-auto absolute left-1/2 top-full flex flex-col items-start">
              <span
                aria-hidden="true"
                className="h-8 w-px border-l border-dashed border-muted-foreground/50"
              />

              <div className="-translate-x-px">
                {/*
                  On an "otherwise" arm the same act is asking another question,
                  so it is worded as that rather than offered twice.
                */}
                {actions.onAddElseIf ? (
                  <EdgeAction
                    icon={CornerDownRight}
                    label="Otherwise if…"
                    onClick={() => actions.onAddElseIf?.(source)}
                  />
                ) : (
                  /*
                    Two named kinds, asked before anything is built.
                    
                    "Add branch" on its own decided for somebody: it made a
                    split with a question on it, when what they wanted may have
                    been the fallback that runs when nothing matched. Those are
                    different things and the words are the only place to tell
                    them apart, so the question comes before the shape.
                  */
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:border-primary"
                      >
                        <GitBranch className="size-3.5" aria-hidden="true" />
                        Add branch
                      </button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="start" className="w-[300px]">
                      <DropdownMenuItem
                        className="cursor-pointer flex-col items-start gap-0.5"
                        onSelect={() => actions.onInsertBranch?.(source)}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <Plus className="size-3.5" aria-hidden="true" />
                          Otherwise if…
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Add another set of conditions and actions to this rule.
                        </span>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        className="cursor-pointer flex-col items-start gap-0.5"
                        onSelect={() => actions.onAddOtherwise?.(source)}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <Plus className="size-3.5" aria-hidden="true" />
                          Otherwise
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Add actions that will run if all other conditions are not met.
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function EdgeAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
