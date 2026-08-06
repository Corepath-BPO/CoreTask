import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { GitBranch, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

/** What the canvas hands each edge. */
export interface AutomationEdgeData extends Record<string, unknown> {
  /** Insert a step between the two ends of this edge. */
  onInsertStep?: (parentId: string) => void;
  /** Split the rule at this point, so what follows becomes one of two paths. */
  onInsertBranch?: (parentId: string) => void;
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
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [open, setOpen] = useState(false);
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

          <button
            type="button"
            aria-label="Add a step here"
            aria-expanded={open}
            onClick={() => setOpen((previous) => !previous)}
            className={cn(
              'pointer-events-auto flex size-6 cursor-pointer items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors',
              'hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              open && 'border-primary text-primary',
            )}
          >
            <MoreHorizontal className="size-3.5" aria-hidden="true" />
          </button>

          {open && (
            <div className="pointer-events-auto absolute left-1/2 top-full flex flex-col items-start pt-1">
              {/* The dashed drop says these belong to the point above rather
                  than floating loose on the canvas. */}
              <span
                aria-hidden="true"
                className="ml-0 h-6 w-px border-l border-dashed border-muted-foreground/50"
              />

              <div className="flex translate-x-[-1px] flex-col items-start gap-1">
                <EdgeAction
                  icon={Plus}
                  label="Add a step"
                  onClick={() => {
                    setOpen(false);
                    actions.onInsertStep?.(source);
                  }}
                />
                <EdgeAction
                  icon={GitBranch}
                  label="Add branch"
                  onClick={() => {
                    setOpen(false);
                    actions.onInsertBranch?.(source);
                  }}
                />
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
  icon: typeof Plus;
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
