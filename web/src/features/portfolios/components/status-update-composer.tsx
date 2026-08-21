import type { ProjectSummary } from '@coretask/types';
import {
  ChevronDown,
  ChevronRight,
  Globe,
  MoreHorizontal,
  Paperclip,
  Plus,
  Slack,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { cn, daysUntil, formatDate, initials, percentage } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';
import {
  useProjectStatusUpdate,
  useStatusUpdateStore,
  type ProjectStatusUpdate,
  type ProjectStatusUpdateValue,
} from '@/stores/status-update.store';

import { STATUS_UPDATE_OPTIONS, statusUpdateOption } from '../lib/status-updates';
import { StatusUpdateChip } from './status-update';

interface StatusUpdateComposerProps {
  project: ProjectSummary;
  /** The status picked from the menu; the composer starts on it. */
  initialStatus: ProjectStatusUpdateValue;
  onClose: () => void;
}

/**
 * Asana's full-page status composer, faithfully: breadcrumb bar with Public /
 * recipients / Post, a status-coloured accent line, a title that only shows
 * its box when engaged, the full field column, Summary and Next steps, an AI
 * draft pill (rule-based over the live numbers), and the "Build your update"
 * rail. Rendered through a portal — the panel that opens it is
 * CSS-transformed, which would otherwise trap `fixed` inside it.
 */
export function StatusUpdateComposer({
  project,
  initialStatus,
  onClose,
}: StatusUpdateComposerProps) {
  const setStatus = useStatusUpdateStore((state) => state.setStatus);
  const previous = useProjectStatusUpdate(project.id);
  const currentUser = useCurrentUser();

  const [status, setStatusValue] = useState<ProjectStatusUpdateValue>(initialStatus);
  const [title, setTitle] = useState(`${project.name} - ${formatDate(new Date())}`);
  const [summary, setSummary] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [railTab, setRailTab] = useState<'previous' | 'highlights' | 'drafts'>('highlights');

  const option = statusUpdateOption(status);
  const accent = option.filled ? 'bg-emerald-500' : option.dot;

  const remaining = project.taskCount - project.completedTaskCount;
  const progress = percentage(project.completedTaskCount, project.taskCount);
  const overdue =
    project.dueDate !== null && project.archivedAt === null && daysUntil(project.dueDate) < 0;

  const post = () => {
    setStatus(project.id, status, {
      title: title.trim() || null,
      note: summary.trim() || null,
      nextSteps: nextSteps.trim() || null,
    });
    toast.success(
      project.lead ? `Update posted, ${project.lead.name} will be notified` : 'Update posted',
    );
    onClose();
  };

  /** Rule-based draft over the live numbers — no model, and none needed. */
  const draftWithAi = () => {
    setSummary(
      `${project.name} is ${progress}% complete. ${project.completedTaskCount} of ${project.taskCount} tasks are done across ${project.sectionCount} ${project.sectionCount === 1 ? 'section' : 'sections'}.${overdue ? ' The project is past its due date.' : ''}`,
    );
    setNextSteps(
      remaining > 0
        ? `Close out the remaining ${remaining} ${remaining === 1 ? 'task' : 'tasks'} on the board.`
        : 'All tasks are complete. Wrap up and archive.',
    );
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Status update for ${project.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: project.color }}
        />
        <span className="max-w-56 truncate text-sm font-medium">{project.name}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm text-muted-foreground">Status update</span>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
            <Globe className="size-3.5" aria-hidden="true" />
            Public
          </span>
          <span aria-hidden="true" className="hidden h-4 w-px bg-border md:block" />
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {project.lead ? '1 person will be notified' : 'Nobody will be notified'}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast('Only the project owner is notified in this local build.')}
          >
            <Plus />
            Add recipients
          </Button>
          <Button size="sm" onClick={post}>
            Post
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="More options" disabled>
            <MoreHorizontal />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close status update" onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>
      {/* The status sets the accent, the way Asana's top rule turns amber on
          "At risk". */}
      <div aria-hidden="true" className={cn('h-0.5 shrink-0', accent)} />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-10">
            {/* Plain heading until engaged — the box appears on hover/focus. */}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Update title"
              className="-mx-4 w-[calc(100%+2rem)] rounded-lg border border-transparent bg-transparent px-4 py-2.5 text-2xl font-semibold hover:border-input focus-visible:border-input focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            />

            <dl className="space-y-4 text-sm">
              <div className="flex items-center gap-4">
                <dt className="w-36 shrink-0 text-muted-foreground">
                  Status{' '}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </dt>
                <dd>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Change status"
                        className="rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                      >
                        <StatusUpdateChip status={status} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      {STATUS_UPDATE_OPTIONS.map((statusOption) => (
                        <DropdownMenuItem
                          key={statusOption.value}
                          onSelect={() => setStatusValue(statusOption.value)}
                        >
                          <StatusUpdateChip status={statusOption.value} />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </dd>
              </div>

              <div className="flex items-center gap-4">
                <dt className="w-36 shrink-0 text-muted-foreground">Draft collaborators</dt>
                <dd className="flex items-center gap-1.5">
                  {currentUser && (
                    <Avatar className="size-6" title={currentUser.name}>
                      {currentUser.avatarUrl && <AvatarImage src={currentUser.avatarUrl} alt="" />}
                      <AvatarFallback className="text-[9px]">
                        {initials(currentUser.name)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  {Array.from({ length: 2 }).map((_, index) => (
                    <span
                      key={index}
                      aria-hidden="true"
                      className="flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/40"
                    >
                      <UserRound className="size-3 text-muted-foreground/60" />
                    </span>
                  ))}
                  <Button variant="ghost" size="icon-sm" aria-label="Add collaborators" disabled>
                    <Plus />
                  </Button>
                </dd>
              </div>

              <div className="flex items-center gap-4">
                <dt className="w-36 shrink-0 text-muted-foreground">Owner</dt>
                <dd>
                  {project.lead ? (
                    <span className="inline-flex items-center gap-2">
                      <Avatar className="size-5">
                        {project.lead.avatarUrl && (
                          <AvatarImage src={project.lead.avatarUrl} alt="" />
                        )}
                        <AvatarFallback className="text-[9px]">
                          {initials(project.lead.name)}
                        </AvatarFallback>
                      </Avatar>
                      {project.lead.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </dd>
              </div>

              <div className="flex items-center gap-4">
                <dt className="w-36 shrink-0 text-muted-foreground">Dates</dt>
                <dd>
                  {project.startDate || project.dueDate ? (
                    <>
                      {project.startDate ? formatDate(project.startDate) : '…'}
                      {' - '}
                      {project.dueDate ? formatDate(project.dueDate) : '…'}
                    </>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </dd>
              </div>

              <div className="flex items-center gap-4">
                <dt className="w-36 shrink-0 text-muted-foreground">Priority</dt>
                {/* Projects have no priority in CoreTask; an honest em dash,
                    like Asana shows for unset fields. */}
                <dd className="text-muted-foreground">-</dd>
              </div>

              <div className="flex items-center gap-4">
                <dt className="w-36 shrink-0 text-muted-foreground">Connected channel</dt>
                <dd>
                  <Button variant="outline" size="sm" disabled>
                    <Slack />
                    Connect Slack
                  </Button>
                </dd>
              </div>

              <div>
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground"
                >
                  Show or hide fields
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </button>
              </div>

              <div>
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
                >
                  <Paperclip className="size-3.5" aria-hidden="true" />
                  Add attachment
                </button>
              </div>
            </dl>

            <section className="space-y-2">
              <h2 className="text-xl font-semibold">Summary</h2>
              <Textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="How's this project going?"
                rows={4}
                className="resize-none rounded-none border-0 border-b px-0 shadow-none focus-visible:ring-0"
              />
            </section>

            <section className="space-y-2">
              <h2 className="text-xl font-semibold">Next steps</h2>
              <Textarea
                value={nextSteps}
                onChange={(event) => setNextSteps(event.target.value)}
                placeholder="What's next for the team?"
                rows={3}
                className="resize-none rounded-none border-0 border-b px-0 shadow-none focus-visible:ring-0"
              />
            </section>

            <div className="flex items-center gap-3 rounded-full border bg-muted/40 py-1.5 pr-1.5 pl-4">
              <Sparkles className="size-4 shrink-0 text-primary-strong" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                Draft this update from the project&apos;s live numbers
              </span>
              <Button variant="secondary" size="sm" className="rounded-full" onClick={draftWithAi}>
                Draft it
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Local build: posting stores the update in this browser. The notification is
              simulated.
            </p>
          </div>
        </div>

        <aside className="hidden w-80 shrink-0 space-y-4 overflow-y-auto border-l p-4 lg:block">
          <h2 className="text-lg font-semibold">Build your update</h2>

          <div className="flex gap-1">
            <RailTab active={railTab === 'previous'} onClick={() => setRailTab('previous')}>
              Previous update
            </RailTab>
            <RailTab active={railTab === 'highlights'} onClick={() => setRailTab('highlights')}>
              Highlights
            </RailTab>
            <RailTab active={railTab === 'drafts'} onClick={() => setRailTab('drafts')}>
              Drafts
            </RailTab>
          </div>

          {railTab === 'highlights' && (
            <div className="space-y-3">
              <RailStatCard
                count={project.completedTaskCount}
                noun={project.completedTaskCount === 1 ? 'task' : 'tasks'}
                qualifier="completed"
                shape="circle"
                shapeClass="bg-emerald-500"
              />
              <RailStatCard
                count={remaining}
                noun={remaining === 1 ? 'task' : 'tasks'}
                qualifier="incomplete"
                shape="circle"
                shapeClass="bg-muted-foreground/40"
              />
              <RailStatCard
                count={project.sectionCount}
                noun={project.sectionCount === 1 ? 'section' : 'sections'}
                qualifier="on the board"
                shape="square"
                shapeClass="bg-emerald-500"
              />
              <RailChartCard title="Incomplete tasks by assignee" />
              <RailChartCard title="Completed tasks by assignee" />
              <RailChartCard title="Incomplete tasks by section" />
              <p className="text-xs text-muted-foreground">
                Charts are placeholders. Reporting lands with the API.
              </p>
            </div>
          )}

          {railTab === 'previous' && <PreviousUpdate previous={previous} />}

          {railTab === 'drafts' && <p className="text-sm text-muted-foreground">No drafts yet.</p>}
        </aside>
      </div>
    </div>,
    document.body,
  );
}

function RailTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-secondary text-secondary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function RailStatCard({
  count,
  noun,
  qualifier,
  shape,
  shapeClass,
}: {
  count: number;
  noun: string;
  qualifier: string;
  shape: 'circle' | 'square';
  shapeClass: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">
          {count} {noun}
        </span>
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
          {qualifier}
          <ChevronDown className="size-3" aria-hidden="true" />
        </span>
        <span className="ml-auto inline-flex items-center gap-0.5 text-xs text-muted-foreground">
          all time
          <ChevronDown className="size-3" aria-hidden="true" />
        </span>
      </div>
      <div aria-hidden="true" className="space-y-2 pt-3">
        {Array.from({ length: 2 }).map((_, index) => (
          <span
            key={index}
            className={cn(
              'block size-3.5',
              shapeClass,
              shape === 'circle' ? 'rounded-full' : 'rounded-[3px]',
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Asana shows these as grey lollipop sketches until there is data — same here. */
function RailChartCard({ title }: { title: string }) {
  const tops = [6, 12, 18, 24, 32, 36, 40];

  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{title}</p>
      <div aria-hidden="true" className="mt-2 flex justify-between px-1">
        {tops.map((top, index) => (
          <div key={index} className="relative h-24 w-4">
            <span
              className="absolute left-1/2 size-3.5 -translate-x-1/2 rounded-full bg-muted-foreground/50"
              style={{ top }}
            />
            <span
              className="absolute left-1/2 w-[3px] -translate-x-1/2 bg-muted-foreground/25"
              style={{ top: top + 12, bottom: 12 }}
            />
            <span className="absolute bottom-0 left-1/2 size-3.5 -translate-x-1/2 rounded-full bg-muted-foreground/30" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviousUpdate({ previous }: { previous: ProjectStatusUpdate | null }) {
  if (!previous) {
    return <p className="text-sm text-muted-foreground">No previous update yet.</p>;
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <StatusUpdateChip status={previous.status} />
      {previous.title && <p className="text-sm font-medium">{previous.title}</p>}
      {previous.note && <p className="text-sm">{previous.note}</p>}
      {previous.nextSteps && (
        <p className="text-sm text-muted-foreground">Next: {previous.nextSteps}</p>
      )}
      <p className="text-xs text-muted-foreground">Updated {formatDate(previous.updatedAt)}</p>
    </div>
  );
}
