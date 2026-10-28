import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Copy,
  CornerDownRight,
  GitBranch,
  ListFilter,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { OptionChip } from '../configuration/option-chip';
import type { FlowBlockKind } from '../lib/flow-blocks';
import type { CanvasNode } from '../lib/graph-edits';
import type { SummarySegment } from '../lib/node-summary';

/** One step on a card. */
export interface FlowLine {
  nodeId: string;
  category: CanvasNode['type'];
  /** Its number in the rule, for the trigger and each action. */
  number?: number;
  /** What it does, resolved to real names and split for display. */
  summary: SummarySegment[];
  /** The same sentence as one string, for the accessible name. */
  label: string;
  invalid: boolean;
  isFallback?: boolean;
  selected: boolean;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onChangeTrigger?: () => void;
}

/** What the canvas hands each card. */
export interface FlowBlockData extends Record<string, unknown> {
  kind: FlowBlockKind;
  /** The card's header: "Check if", "Else if", "Otherwise", "Task". */
  title: string;
  /** For the trigger: the project its tasks are in. */
  projectName?: string;
  lines: FlowLine[];
  /** One line per card, for a long rule seen whole. */
  collapsed: boolean;
  onOpenLine: (nodeId: string) => void;
  /** A path's own menu. */
  pathMenu?: {
    onMoveLeft?: () => void;
    onMoveRight?: () => void;
    onDuplicate?: () => void;
    onDelete?: () => void;
  };
  /** The + under the last card of a column. */
  add?: {
    onAddAction: () => void;
    /** "Check if" on a rule with no paths yet, "Else if" after that. */
    pathLabel: string;
    onAddPath: () => void;
    /** Offered while the rule has no fallback. */
    onAddOtherwise?: () => void;
  };
}

const ICON: Record<string, LucideIcon> = {
  TRIGGER: Zap,
  CONDITION: ListFilter,
  BRANCH: GitBranch,
  ACTION: ArrowRight,
  PLACEHOLDER: Plus,
};

/** The accent sits on the icon's tile, never the whole card; see the step card's history. */
const ICON_TILE: Record<string, string> = {
  TRIGGER: 'bg-primary/15 text-primary-strong',
  CONDITION: 'bg-violet-500/15 text-violet-500',
  BRANCH: 'bg-violet-500/15 text-violet-500',
  ACTION: 'bg-emerald-500/15 text-emerald-500',
  PLACEHOLDER: 'bg-muted text-muted-foreground',
};

/**
 * One card of the rule: the trigger, a path, or a run of actions.
 *
 * The card is a frame; each line in it is its own step, selected and opened on
 * its own, so the side panel, the validator and saving all still work step by
 * step. Laid out by `flowLayout`; see `docs/architecture/automation-builder-layout.md`.
 */
export function FlowBlockNode({ data }: NodeProps) {
  const block = data as FlowBlockData;
  const anySelected = block.lines.some((line) => line.selected);
  const anyInvalid = block.lines.some((line) => line.invalid);

  return (
    <div className="nopan nodrag group/card relative">
      <Handle type="target" position={Position.Top} className="!opacity-0" isConnectable={false} />

      <div
        className={cn(
          'w-[300px] rounded-xl border bg-card text-left shadow-sm transition-colors',
          anySelected ? 'border-primary' : 'border-border',
          anyInvalid && !anySelected && 'border-destructive/60',
        )}
      >
        <CardHeader block={block} />

        {block.collapsed ? (
          <CollapsedLine block={block} />
        ) : (
          <ul className="flex flex-col gap-0.5 px-1.5 pb-1.5">
            {block.lines.map((line) => (
              <li key={line.nodeId}>
                <StepLine
                  line={line}
                  kind={block.kind}
                  onOpen={() => block.onOpenLine(line.nodeId)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {block.add && <AddStep add={block.add} />}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!opacity-0"
        isConnectable={false}
      />
    </div>
  );
}

function CardHeader({ block }: { block: FlowBlockData }) {
  if (block.kind === 'TRIGGER') {
    return (
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-xs text-muted-foreground">
        <span>Tasks in</span>
        {block.projectName && (
          <span className="max-w-[180px] truncate rounded bg-muted px-1.5 py-0.5 text-foreground">
            {block.projectName}
          </span>
        )}
      </div>
    );
  }

  const icon =
    block.kind === 'TASK' ? (
      <CircleCheck className="size-3.5" aria-hidden="true" />
    ) : block.title === 'Otherwise' ? (
      <CornerDownRight className="size-3.5" aria-hidden="true" />
    ) : (
      <GitBranch className="size-3.5" aria-hidden="true" />
    );

  return (
    <div className="flex h-9 items-center gap-1.5 pl-3 pr-1.5 text-xs font-medium text-muted-foreground">
      {icon}
      <span className="flex-1">{block.title}</span>
      {block.pathMenu && <PathMenu title={block.title} menu={block.pathMenu} />}
    </div>
  );
}

function CollapsedLine({ block }: { block: FlowBlockData }) {
  const first = block.lines[0];
  const more = block.lines.length - 1;
  return (
    <button
      type="button"
      onClick={() => first && block.onOpenLine(first.nodeId)}
      className="block w-full truncate px-3 pb-2.5 text-left text-sm text-foreground"
    >
      {first ? `${first.number ? `${first.number}. ` : ''}${first.label}` : ''}
      {more > 0 && <span className="text-muted-foreground"> · {more} more</span>}
    </button>
  );
}

function StepLine({
  line,
  kind,
  onOpen,
}: {
  line: FlowLine;
  kind: FlowBlockKind;
  onOpen: () => void;
}) {
  const Icon = line.isFallback ? CornerDownRight : (ICON[line.category] ?? ArrowRight);
  const placeholder = line.category === 'PLACEHOLDER';
  const menu: { label: string; icon: LucideIcon; onSelect: () => void; destructive?: boolean }[] = [
    ...(line.onChangeTrigger
      ? [{ label: 'Change trigger', icon: RefreshCw, onSelect: line.onChangeTrigger }]
      : []),
    ...(line.onDuplicate ? [{ label: 'Duplicate', icon: Copy, onSelect: line.onDuplicate }] : []),
    ...(line.onDelete
      ? [{ label: 'Delete', icon: Trash2, onSelect: line.onDelete, destructive: true }]
      : []),
  ];
  const name = `${line.number ? `${line.number}. ` : ''}${line.label}`;

  return (
    <div
      className={cn(
        'group/line relative flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors',
        line.selected ? 'bg-primary/10' : 'hover:bg-muted/60',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={name}
        aria-pressed={line.selected}
        className="flex min-w-0 flex-1 items-start gap-2.5 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
            placeholder
              ? 'border border-dashed border-muted-foreground/50'
              : ICON_TILE[line.category],
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          {kind === 'TRIGGER' && (
            <span className="mb-0.5 inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-px text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <Zap className="size-3" aria-hidden="true" />
              Trigger
            </span>
          )}
          <SummaryText line={line} placeholder={placeholder} />
        </span>
        {line.invalid && (
          <AlertCircle className="mt-1 size-4 shrink-0 text-destructive" aria-hidden="true" />
        )}
      </button>

      {menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More for: ${name}`}
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
                'opacity-0 focus-visible:opacity-100 group-hover/line:opacity-100 data-[state=open]:opacity-100',
              )}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menu.map((item) => (
              <DropdownMenuItem
                key={item.label}
                onSelect={item.onSelect}
                className={cn(item.destructive && 'text-destructive focus:text-destructive')}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * The step's sentence, with the values it names set apart as chips.
 *
 * Inline text rather than a row of flex items, so a long sentence wraps like a
 * sentence and the step number stays in front of its first word.
 */
function SummaryText({ line, placeholder }: { line: FlowLine; placeholder: boolean }) {
  return (
    <span
      className={cn(
        'block min-w-0 text-[13px] leading-6',
        placeholder ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {line.number !== undefined && <span className="mr-1 tabular-nums">{line.number}.</span>}
      {line.summary.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && ' '}
          <Segment part={part} />
        </Fragment>
      ))}
    </span>
  );
}

function Segment({ part }: { part: SummarySegment }): ReactNode {
  const chip = 'inline-block max-w-[200px] truncate align-middle leading-5';
  if (part.placeholder) {
    return (
      <span
        className={cn(
          chip,
          'rounded border border-dashed border-muted-foreground/60 px-1.5 text-muted-foreground',
        )}
      >
        {part.text}
      </span>
    );
  }
  if (part.chip && part.colorToken) {
    return (
      <OptionChip
        label={part.text}
        colorToken={part.colorToken}
        className={cn(chip, 'max-w-[200px]')}
      />
    );
  }
  if (part.chip) {
    return <span className={cn(chip, 'rounded bg-muted px-1.5')}>{part.text}</span>;
  }
  return <span>{part.text}</span>;
}

function PathMenu({
  title,
  menu,
}: {
  title: string;
  menu: NonNullable<FlowBlockData['pathMenu']>;
}) {
  const items: { label: string; icon: LucideIcon; onSelect: () => void; destructive?: boolean }[] =
    [
      ...(menu.onMoveLeft
        ? [{ label: 'Move left', icon: ArrowLeft, onSelect: menu.onMoveLeft }]
        : []),
      ...(menu.onMoveRight
        ? [{ label: 'Move right', icon: ArrowRight, onSelect: menu.onMoveRight }]
        : []),
      ...(menu.onDuplicate
        ? [{ label: 'Duplicate path', icon: Copy, onSelect: menu.onDuplicate }]
        : []),
      ...(menu.onDelete
        ? [{ label: 'Delete path', icon: Trash2, onSelect: menu.onDelete, destructive: true }]
        : []),
    ];
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`More for: ${title}`}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            onSelect={item.onSelect}
            className={cn(item.destructive && 'text-destructive focus:text-destructive')}
          >
            <item.icon className="size-4" aria-hidden="true" />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The + under a column: an action, or another path. */
function AddStep({ add }: { add: NonNullable<FlowBlockData['add']> }) {
  return (
    <div className="absolute left-1/2 top-full flex -translate-x-1/2 flex-col items-center">
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Add step"
            className="flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:border-primary hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Actions</DropdownMenuLabel>
          <DropdownMenuItem onSelect={add.onAddAction}>
            <ArrowRight className="size-4" aria-hidden="true" />
            <span className="flex flex-col">
              <span>Action</span>
              <span className="text-xs text-muted-foreground">Do something in CoreTask</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Flow controls
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={add.onAddPath}>
            <GitBranch className="size-4" aria-hidden="true" />
            <span className="flex flex-col">
              <span>{add.pathLabel}</span>
              <span className="text-xs text-muted-foreground">Branch based on conditions</span>
            </span>
          </DropdownMenuItem>
          {add.onAddOtherwise && (
            <DropdownMenuItem onSelect={add.onAddOtherwise}>
              <CornerDownRight className="size-4" aria-hidden="true" />
              <span className="flex flex-col">
                <span>Otherwise</span>
                <span className="text-xs text-muted-foreground">When no path above holds</span>
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** What the canvas hands the "Add path" button beside the paths. */
export interface AddPathData extends Record<string, unknown> {
  onAddPath: () => void;
  /** Offered while the rule has no fallback. */
  onAddOtherwise?: () => void;
}

/**
 * Another path beside the last one, as Asana's "Add branch" on the connector.
 *
 * Separate from the + under a column, which a column still waiting for its
 * first action does not have — so a rule whose newest path has nothing in it
 * yet could not otherwise grow another.
 */
export function AddPathNode({ data }: NodeProps) {
  const add = data as AddPathData;

  return (
    <div className="nopan nodrag">
      <Handle type="target" position={Position.Top} className="!opacity-0" isConnectable={false} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Add path"
            className="flex h-8 items-center gap-1.5 rounded-full border border-dashed border-border bg-card px-3 text-xs font-medium text-muted-foreground shadow-sm hover:border-primary hover:text-foreground"
          >
            <GitBranch className="size-3.5" aria-hidden="true" />
            Add path
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuItem onSelect={add.onAddPath}>
            <GitBranch className="size-4" aria-hidden="true" />
            <span className="flex flex-col">
              <span>Else if</span>
              <span className="text-xs text-muted-foreground">
                Another question, tried after these
              </span>
            </span>
          </DropdownMenuItem>
          {add.onAddOtherwise && (
            <DropdownMenuItem onSelect={add.onAddOtherwise}>
              <CornerDownRight className="size-4" aria-hidden="true" />
              <span className="flex flex-col">
                <span>Otherwise</span>
                <span className="text-xs text-muted-foreground">When no path above holds</span>
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
