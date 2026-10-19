import type { SearchKind, SearchResults } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import {
  CheckCircle2,
  Circle,
  Clock,
  FolderKanban,
  Inbox,
  ListChecks,
  ListFilter,
  Loader2,
  Search,
  Ticket,
  User,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { PersonAvatar } from '@/components/data-display/person-avatar';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { cn, formatDueDate, humanizeEnum } from '@/lib/utils';
import { useUiStore } from '@/stores/ui.store';

import { useSearch } from '../hooks/use-search';
import { useRecentItems, type RecentItem } from '../lib/recent-items';

const KIND_CHIPS: { kind: SearchKind; label: string; icon: typeof Search }[] = [
  { kind: 'tasks', label: 'Tasks', icon: ListChecks },
  { kind: 'projects', label: 'Projects', icon: FolderKanban },
  { kind: 'people', label: 'People', icon: User },
  { kind: 'tickets', label: 'Tickets', icon: Ticket },
];

const EMPTY_RECENTS: RecentItem[] = [];

/**
 * The top bar's search, in Asana's shape: the field opens a panel below it
 * with kind chips, recent items while the box is empty, and grouped results
 * as soon as something is typed.
 *
 * Ctrl/⌘ K, or "/" outside a text field, opens it from anywhere.
 */
export function GlobalSearch() {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const navigate = useNavigate();

  // In the UI store so the app's one keyboard listener can open it — see
  // `useGlobalShortcuts` (Ctrl/⌘ K and "/").
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [kind, setKind] = useState<SearchKind | null>(null);
  useDebouncedValue(term, setDebounced);

  const kinds = kind ? [kind] : [];
  const { data, isFetching, isError } = useSearch(workspaceId, debounced, kinds);

  const recents = useRecentItems((state) =>
    workspaceId ? (state.byWorkspace[workspaceId] ?? EMPTY_RECENTS) : EMPTY_RECENTS,
  );
  const remember = useRecentItems((state) => state.remember);

  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setTerm('');
    setDebounced('');
    setKind(null);
  }, [setOpen]);

  const go = (item: RecentItem) => {
    if (workspaceId) remember(workspaceId, item);
    close();
    void navigate({ to: item.href });
  };

  const showingResults = debounced.trim().length > 0;
  const results = showingResults ? data : undefined;

  /*
   * The highlight is held here rather than left to cmdk. Results arrive after
   * the list has rendered, and cmdk only picks a first item when its own
   * filter runs — which is off — so Enter on a fresh answer did nothing until
   * an arrow key had been pressed. Asana's first result is always live.
   */
  const firstValue = results
    ? results.tasks[0]
      ? `task:${results.tasks[0].id}`
      : results.projects[0]
        ? `project:${results.projects[0].id}`
        : results.tickets[0]
          ? `ticket:${results.tickets[0].id}`
          : results.people[0]
            ? `person:${results.people[0].id}`
            : ''
    : recents[0]
      ? `recent:${recents[0].kind}:${recents[0].id}`
      : 'jump:my-tasks';

  // Whatever was highlighted belongs to the answer it was chosen in; a new
  // answer starts back on its own first row.
  const [pick, setPick] = useState({ value: '', within: '' });
  const highlighted = pick.within === firstValue ? pick.value : firstValue;
  const nothingFound =
    results !== undefined &&
    results.tasks.length +
      results.tickets.length +
      results.projects.length +
      results.people.length ===
      0;

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search"
          aria-keyshortcuts="Control+K /"
          className={cn(
            'flex h-10 flex-1 items-center gap-2.5 rounded-lg border bg-muted/40 px-3.5 text-sm text-muted-foreground transition-colors sm:max-w-lg',
            'hover:border-input hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 truncate text-left">Search tasks, tickets, projects, people</span>
          <kbd className="hidden shrink-0 rounded border bg-background px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground sm:inline">
            Ctrl K
          </kbd>
        </button>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={-40}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        className="w-[min(40rem,calc(100vw-1.5rem))] overflow-hidden p-0"
      >
        {/* The server ranks; cmdk filtering the answer again would hide hits. */}
        <Command
          shouldFilter={false}
          label="Search"
          value={highlighted}
          onValueChange={(value) => setPick({ value, within: firstValue })}
        >
          <div className="relative">
            <CommandInput
              ref={inputRef}
              value={term}
              onValueChange={setTerm}
              placeholder={kind ? `Search ${kind}…` : 'Search'}
              aria-label="Search the workspace"
            />
            {isFetching && showingResults && (
              <Loader2
                className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </div>

          <div
            className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2"
            role="group"
            aria-label="Search only"
          >
            {KIND_CHIPS.map((chip) => {
              const Icon = chip.icon;
              const on = kind === chip.kind;
              return (
                <button
                  key={chip.kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setKind(on ? null : chip.kind);
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30',
                    on
                      ? 'border-primary/50 bg-primary/10 text-primary-strong'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {chip.label}
                </button>
              );
            })}
          </div>

          <CommandList className="max-h-[min(28rem,60vh)]">
            {showingResults ? (
              <>
                {isError && (
                  <p className="px-3 py-6 text-center text-sm text-destructive">
                    Search failed. Try again in a moment.
                  </p>
                )}
                {nothingFound && !isFetching && (
                  <CommandEmpty>Nothing matches “{debounced.trim()}”.</CommandEmpty>
                )}
                {results && <ResultGroups results={results} onPick={go} />}
                <CommandGroup>
                  <CommandItem
                    value="advanced-search"
                    onSelect={() => {
                      close();
                      void navigate({ to: '/search', search: { q: debounced.trim() } });
                    }}
                  >
                    <ListFilter className="size-4 text-muted-foreground" aria-hidden="true" />
                    Advanced search for “{debounced.trim()}”
                  </CommandItem>
                </CommandGroup>
              </>
            ) : (
              <>
                {recents.length > 0 && (
                  <CommandGroup heading="Recents">
                    {recents.map((item) => (
                      <CommandItem
                        key={`${item.kind}:${item.id}`}
                        value={`recent:${item.kind}:${item.id}`}
                        onSelect={() => go(item)}
                      >
                        <KindIcon item={item} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.detail && (
                          <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                            {item.detail}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {recents.length > 0 && <CommandSeparator />}

                <CommandGroup heading="Jump to">
                  <CommandItem
                    value="jump:my-tasks"
                    onSelect={() => {
                      close();
                      void navigate({ to: '/my-tasks' });
                    }}
                  >
                    <CheckCircle2 className="size-4 text-muted-foreground" aria-hidden="true" />
                    My tasks
                  </CommandItem>
                  <CommandItem
                    value="jump:inbox"
                    onSelect={() => {
                      close();
                      void navigate({ to: '/inbox' });
                    }}
                  >
                    <Inbox className="size-4 text-muted-foreground" aria-hidden="true" />
                    Inbox
                  </CommandItem>
                  <CommandItem
                    value="jump:tickets"
                    onSelect={() => {
                      close();
                      void navigate({ to: '/tickets' });
                    }}
                  >
                    <Ticket className="size-4 text-muted-foreground" aria-hidden="true" />
                    Ticket queue
                  </CommandItem>
                  <CommandItem
                    value="jump:advanced-search"
                    onSelect={() => {
                      close();
                      void navigate({ to: '/search' });
                    }}
                  >
                    <ListFilter className="size-4 text-muted-foreground" aria-hidden="true" />
                    Advanced search
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>

          <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>
              <kbd className="font-sans">↑↓</kbd> to move
            </span>
            <span>
              <kbd className="font-sans">Enter</kbd> to open
            </span>
            <span>
              <kbd className="font-sans">Esc</kbd> to close
            </span>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ResultGroups({
  results,
  onPick,
}: {
  results: SearchResults;
  onPick: (item: RecentItem) => void;
}) {
  return (
    <>
      {results.tasks.length > 0 && (
        <CommandGroup heading="Tasks">
          {results.tasks.map((task) => {
            const item: RecentItem = {
              kind: 'task',
              id: task.id,
              label: task.title,
              detail: task.parent ? `in ${task.parent.title}` : (task.project?.name ?? null),
              color: task.project?.color ?? null,
              // A project task opens in its project's list, beside its
              // neighbours; one with no project opens over My Tasks.
              href: task.project
                ? `/projects/${task.project.id}/list?task=${task.id}`
                : `/my-tasks?task=${task.id}`,
            };
            return (
              <CommandItem key={task.id} value={`task:${task.id}`} onSelect={() => onPick(item)}>
                {task.isCompleted ? (
                  <CheckCircle2 className="size-4 text-success" aria-label="Completed" />
                ) : (
                  <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
                )}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    task.isCompleted && 'text-muted-foreground line-through',
                  )}
                >
                  {task.title}
                </span>
                {item.detail && (
                  <span className="flex max-w-[40%] shrink-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
                    {task.project && !task.parent && (
                      <span
                        className="size-2 shrink-0 rounded-[3px]"
                        style={{ backgroundColor: task.project.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate">{item.detail}</span>
                  </span>
                )}
                {task.dueDate && !task.isCompleted && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDueDate(task.dueDate)}
                  </span>
                )}
                {task.assignee && (
                  <PersonAvatar
                    name={task.assignee.name}
                    avatarUrl={task.assignee.avatarUrl}
                    className="size-5"
                    fallbackClassName="text-[9px]"
                  />
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}

      {results.projects.length > 0 && (
        <CommandGroup heading="Projects">
          {results.projects.map((project) => {
            const item: RecentItem = {
              kind: 'project',
              id: project.id,
              label: project.name,
              detail: project.key,
              color: project.color,
              href: `/projects/${project.id}/list`,
            };
            return (
              <CommandItem
                key={project.id}
                value={`project:${project.id}`}
                onSelect={() => onPick(item)}
              >
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: project.color }}
                  aria-hidden="true"
                >
                  <FolderKanban className="size-3 text-white" />
                </span>
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {humanizeEnum(project.status)}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}

      {results.tickets.length > 0 && (
        <CommandGroup heading="Tickets">
          {results.tickets.map((ticket) => {
            const item: RecentItem = {
              kind: 'ticket',
              id: ticket.id,
              label: `${ticket.key} ${ticket.title}`,
              detail: ticket.project?.name ?? null,
              href: `/tickets?ticket=${ticket.key}`,
            };
            return (
              <CommandItem
                key={ticket.id}
                value={`ticket:${ticket.id}`}
                onSelect={() => onPick(item)}
              >
                <Ticket className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {ticket.key}
                </span>
                <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {humanizeEnum(ticket.status)}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}

      {results.people.length > 0 && (
        <CommandGroup heading="People">
          {results.people.map((person) => {
            const item: RecentItem = {
              kind: 'person',
              id: person.id,
              label: person.name,
              detail: person.email,
              href: `/members`,
            };
            return (
              <CommandItem
                key={person.id}
                value={`person:${person.id}`}
                onSelect={() => onPick(item)}
              >
                <PersonAvatar
                  name={person.name}
                  avatarUrl={person.avatarUrl}
                  className="size-5"
                  fallbackClassName="text-[9px]"
                />
                <span className="min-w-0 flex-1 truncate">{person.name}</span>
                <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                  {person.email}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}
    </>
  );
}

function KindIcon({ item }: { item: RecentItem }) {
  switch (item.kind) {
    case 'project':
      return (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: item.color ?? 'var(--color-muted)' }}
          aria-hidden="true"
        >
          <FolderKanban className="size-3 text-white" />
        </span>
      );
    case 'ticket':
      return <Ticket className="size-4 text-muted-foreground" aria-hidden="true" />;
    case 'person':
      return <PersonAvatar name={item.label} className="size-5" fallbackClassName="text-[9px]" />;
    default:
      return <Clock className="size-4 text-muted-foreground" aria-hidden="true" />;
  }
}
