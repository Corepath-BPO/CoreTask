import { ActivityAction, ActivityEntity } from '@coretask/contracts';
import type { ActivityEntry } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import { History, Zap } from 'lucide-react';
import { useMemo } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjectActivity } from '@/features/activity/hooks/use-activity';
import { describeStory } from '@/features/activity/lib/story-text';
import { useProjectWorkItems } from '@/features/work-items/hooks/use-project-work-items';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { formatRelativeTime } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

const DAY_LABEL = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' });

/** "Today", "Yesterday" or the date — the headings the feed is grouped under. */
function dayHeading(iso: string, now: Date): string {
  const day = new Date(iso);
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((startOf(now).getTime() - startOf(day).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return DAY_LABEL.format(day);
}

/**
 * The project's Activity tab: everything that happened in it, newest first,
 * grouped by day — who did what, and to which task.
 *
 * Each line is written the way the task pane writes its own stories, then
 * followed by the task it was about, so "changed the due date" says which
 * due date.
 */
export function ProjectActivityPage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const me = useCurrentUser();
  const navigate = useNavigate();

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useProjectActivity(
    workspaceId,
    projectId,
  );
  // Titles for the lines: the same list every other tab already holds.
  const { data: workItems } = useProjectWorkItems(workspaceId, projectId, {});

  const titles = useMemo(
    () => new Map((workItems?.items ?? []).map((item) => [item.id, item])),
    [workItems],
  );

  const groups = useMemo(() => {
    const now = new Date();
    const entries = (data?.pages ?? []).flatMap((page) => page.items);
    const result: { heading: string; entries: ActivityEntry[] }[] = [];
    for (const entry of entries) {
      const heading = dayHeading(entry.createdAt, now);
      const last = result[result.length - 1];
      if (last && last.heading === heading) last.entries.push(entry);
      else result.push({ heading, entries: [entry] });
    }
    return result;
  }, [data]);

  const openItem = (entry: ActivityEntry) => {
    if (entry.entity !== ActivityEntity.TASK && entry.entity !== ActivityEntity.TICKET) return;
    if (!titles.has(entry.entityId)) return;
    void navigate({
      to: '/projects/$projectId/list',
      params: { projectId },
      search: { task: entry.entityId },
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No activity yet"
        description="As people add, change and finish work in this project, it shows up here."
      />
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {groups.map((group) => (
        <section key={group.heading} aria-label={group.heading}>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {group.heading}
          </h2>
          <ol className="space-y-1">
            {group.entries.map((entry) => {
              const item = titles.get(entry.entityId);
              const itemWord = entry.entity === ActivityEntity.TICKET ? 'ticket' : 'task';
              const text =
                entry.entity === ActivityEntity.TASK || entry.entity === ActivityEntity.TICKET
                  ? describeStory(entry, { itemWord, meId: me?.id })
                  : entry.summary.charAt(0).toLowerCase() + entry.summary.slice(1);

              return (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/40"
                >
                  {entry.actor ? (
                    <PersonAvatar
                      name={entry.actor.name}
                      avatarUrl={entry.actor.avatarUrl}
                      className="mt-0.5 size-6"
                      fallbackClassName="text-[10px]"
                    />
                  ) : (
                    <span
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted"
                      aria-hidden="true"
                    >
                      <Zap className="size-3.5 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="leading-snug">
                      <span className="font-medium">{entry.actor?.name ?? 'Automation'}</span>{' '}
                      <span className="text-muted-foreground">
                        {entry.action === ActivityAction.COMMENTED ? 'commented on' : text}
                      </span>
                      {item && (
                        <>
                          {entry.action === ActivityAction.COMMENTED ? ' ' : ' · '}
                          <button
                            type="button"
                            onClick={() => openItem(entry)}
                            className="cursor-pointer font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                          >
                            {item.title}
                          </button>
                        </>
                      )}
                    </p>
                    <time
                      dateTime={entry.createdAt}
                      title={new Date(entry.createdAt).toLocaleString()}
                      className="text-xs text-muted-foreground"
                    >
                      {formatRelativeTime(entry.createdAt)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void fetchNextPage()}
            loading={isFetchingNextPage}
          >
            Show older activity
          </Button>
        </div>
      )}
    </div>
  );
}
