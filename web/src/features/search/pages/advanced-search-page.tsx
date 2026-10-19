import {
  SAVED_SEARCH_NAME_MAX,
  SEARCH_COMPLETIONS,
  SEARCH_COMPLETION_LABEL,
  SEARCH_DUES,
  SEARCH_DUE_LABEL,
  SEARCH_ME,
  SEARCH_NOBODY,
  SEARCH_RESULTS_LIMIT,
  SEARCH_SORTS,
  SEARCH_SORT_LABEL,
  SearchCompletion,
  SearchDue,
  SearchSort,
  WorkspaceRole,
  sameTaskSearch,
  type TaskSearchFilters,
} from '@coretask/contracts';
import type { SavedSearch, TaskSearchResult } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  CircleCheck,
  Circle,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { PersonAvatar } from '@/components/data-display/person-avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { useTags } from '@/features/tags/hooks/use-tags';
import { TaskDetailDialog } from '@/features/tasks/components/task-detail-dialog';
import {
  useActiveWorkspace,
  useWorkspaceMembers,
} from '@/features/workspaces/hooks/use-workspaces';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { cn } from '@/lib/utils';
import { daysUntil, formatDueDate } from '@/lib/utils/format';

import {
  useDeleteSavedSearch,
  useSavedSearches,
  useSaveSearch,
  useTaskSearch,
  useUpdateSavedSearch,
} from '../hooks/use-advanced-search';
import { filtersFromParams, paramsFromFilters, type SearchParams } from '../lib/search-url';

interface Option {
  value: string;
  label: string;
}

/**
 * Advanced search — Asana's: words to look for, then who, where, what state
 * and when, over every task the reader can see. The search lives in the
 * address bar, so it is a link; **Save search** names it and puts it in the
 * sidebar. A saved search opened from there can be changed and saved again,
 * renamed or deleted. Results open in the task panel without leaving.
 */
export function AdvancedSearchPage({ params }: { params: SearchParams }) {
  const navigate = useNavigate();
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;

  const filters = useMemo(() => filtersFromParams(params), [params]);
  const { data: page, isLoading, isFetching } = useTaskSearch(workspaceId, filters);
  const { data: savedSearches } = useSavedSearches(workspaceId);
  const saved = savedSearches?.find((search) => search.id === params.saved) ?? null;
  const changed = saved ? !sameTaskSearch(saved.filters, filters) : false;

  const { data: members } = useWorkspaceMembers(workspaceId);
  const { data: projects } = useProjects(workspaceId, { limit: 100 });
  const { data: tags } = useTags(workspaceId);

  const people: Option[] = (members ?? []).map((member) => ({
    value: member.user.id,
    label: member.user.name,
  }));
  const me: Option = { value: SEARCH_ME, label: 'Me' };
  const projectOptions: Option[] = (projects?.items ?? []).map((project) => ({
    value: project.id,
    label: project.name,
  }));

  const go = (next: TaskSearchFilters, extra: Pick<SearchParams, 'saved' | 'task'> = {}) =>
    void navigate({
      to: '/search',
      search: {
        ...paramsFromFilters(next),
        ...(params.saved ? { saved: params.saved } : {}),
        ...extra,
      },
      replace: true,
    });
  const set = (patch: Partial<TaskSearchFilters>) =>
    go({ ...filters, ...patch }, params.task ? { task: params.task } : {});

  const [text, setText] = useState(filters.text ?? '');
  useDebouncedValue(text, (settled) => {
    if (settled !== (filters.text ?? '')) set({ text: settled || undefined });
  });

  const [saving, setSaving] = useState<'new' | 'rename' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const save = useSaveSearch(workspaceId);
  const update = useUpdateSavedSearch(workspaceId);
  const remove = useDeleteSavedSearch(workspaceId);

  const anyFilter = Object.keys(filters).some((key) => key !== 'sort');

  return (
    <div className="space-y-5">
      <PageHeader
        title={saved ? saved.name : 'Advanced search'}
        description={
          saved
            ? 'A saved search. Change the filters and save again, or keep it as it is.'
            : 'Find tasks across every project you can see.'
        }
        actions={
          saved ? (
            <>
              {changed && (
                <Button
                  disabled={update.isPending}
                  onClick={() => update.mutate({ searchId: saved.id, payload: { filters } })}
                >
                  Save changes
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Saved search options">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setSaving('new')}>
                    <Check />
                    Save as a new search
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setSaving('rename')}>
                    <Pencil />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button onClick={() => setSaving('new')}>Save search</Button>
          )
        }
      />

      <div className="space-y-3">
        <div className="relative max-w-xl">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={text}
            aria-label="Contains the words"
            placeholder="Contains the words…"
            className="pl-9"
            onChange={(event) => setText(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2" aria-label="Filters" role="group">
          <MultiPicker
            label="Assignee"
            options={[me, { value: SEARCH_NOBODY, label: 'Unassigned' }, ...people]}
            selected={filters.assigneeIds ?? []}
            onChange={(assigneeIds) => set({ assigneeIds })}
          />
          <MultiPicker
            label="Projects"
            options={projectOptions}
            selected={filters.projectIds ?? []}
            onChange={(projectIds) => set({ projectIds })}
          />
          <MultiPicker
            label="Tags"
            options={(tags ?? []).map((tag) => ({ value: tag.id, label: tag.name }))}
            selected={filters.tagIds ?? []}
            onChange={(tagIds) => set({ tagIds })}
          />
          <SingleSelect
            label="Status"
            value={filters.completion ?? SearchCompletion.INCOMPLETE}
            options={SEARCH_COMPLETIONS.map((value) => ({
              value,
              label: SEARCH_COMPLETION_LABEL[value],
            }))}
            onChange={(completion) =>
              set({
                completion:
                  completion === SearchCompletion.INCOMPLETE
                    ? undefined
                    : (completion as SearchCompletion),
              })
            }
          />
          <SingleSelect
            label="Due date"
            value={filters.due ?? SearchDue.ANY}
            options={SEARCH_DUES.map((value) => ({ value, label: SEARCH_DUE_LABEL[value] }))}
            onChange={(due) => set({ due: due === SearchDue.ANY ? undefined : (due as SearchDue) })}
          />
          <MultiPicker
            label="Created by"
            options={[me, ...people]}
            selected={filters.createdByIds ?? []}
            onChange={(createdByIds) => set({ createdByIds })}
          />
          <MultiPicker
            label="Collaborators"
            options={[me, ...people]}
            selected={filters.collaboratorIds ?? []}
            onChange={(collaboratorIds) => set({ collaboratorIds })}
          />
          <SingleSelect
            label="Sort"
            prefix="Sort:"
            value={filters.sort ?? SearchSort.DUE_DATE}
            options={SEARCH_SORTS.map((value) => ({ value, label: SEARCH_SORT_LABEL[value] }))}
            onChange={(sort) =>
              set({ sort: sort === SearchSort.DUE_DATE ? undefined : (sort as SearchSort) })
            }
          />
          {anyFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setText('');
                go(filters.sort ? { sort: filters.sort } : {});
              }}
            >
              <X />
              Clear
            </Button>
          )}
        </div>
      </div>

      <section aria-label="Results" className="space-y-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {page
            ? page.total === 0
              ? 'No tasks match.'
              : page.total > page.items.length
                ? `${page.total} tasks — showing the first ${SEARCH_RESULTS_LIMIT}`
                : `${page.total} task${page.total === 1 ? '' : 's'}`
            : ' '}
        </p>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : (
          page &&
          page.items.length > 0 && (
            <ul
              className={cn(
                'divide-y rounded-lg border transition-opacity',
                isFetching && 'opacity-70',
              )}
            >
              {page.items.map((task) => (
                <ResultRow
                  key={task.id}
                  task={task}
                  onOpen={() => go(filters, { task: task.id })}
                />
              ))}
            </ul>
          )
        )}
      </section>

      <TaskDetailDialog
        workspaceId={workspaceId}
        taskId={params.task ?? null}
        role={role}
        onClose={() => go(filters)}
      />

      {saving && (
        <NameDialog
          title={saving === 'rename' ? 'Rename search' : 'Save search'}
          initial={saving === 'rename' && saved ? saved.name : ''}
          pending={save.isPending || update.isPending}
          onClose={() => setSaving(null)}
          onSubmit={(name) => {
            if (saving === 'rename' && saved) {
              update.mutate(
                { searchId: saved.id, payload: { name } },
                { onSuccess: () => setSaving(null) },
              );
            } else {
              save.mutate(
                { name, filters },
                {
                  onSuccess: (created: SavedSearch) => {
                    setSaving(null);
                    go(filters, { saved: created.id });
                  },
                },
              );
            }
          }}
        />
      )}

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{saved?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The search leaves your sidebar. The tasks it found are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!saved) return;
                remove.mutate(saved.id, {
                  onSuccess: () =>
                    void navigate({
                      to: '/search',
                      search: paramsFromFilters(filters),
                      replace: true,
                    }),
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ResultRow({ task, onOpen }: { task: TaskSearchResult; onOpen: () => void }) {
  const done = task.completedAt !== null;
  const overdue = !done && task.dueDate !== null && daysUntil(task.dueDate) < 0;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
      >
        {done ? (
          <CircleCheck
            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-label="Completed"
          />
        ) : (
          <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate font-medium', done && 'text-muted-foreground')}>
            {task.title}
          </span>
          {task.parentTitle && (
            <span className="block truncate text-xs text-muted-foreground">
              Subtask of {task.parentTitle}
            </span>
          )}
        </span>
        {task.project && (
          <span className="hidden max-w-[12rem] shrink-0 items-center gap-1.5 truncate text-xs text-muted-foreground sm:flex">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: task.project.color }}
              aria-hidden="true"
            />
            <span className="truncate">{task.project.name}</span>
          </span>
        )}
        <span className="w-24 shrink-0 text-right text-xs tabular-nums">
          {task.dueDate ? (
            <span className={overdue ? 'text-destructive' : 'text-muted-foreground'}>
              {formatDueDate(task.dueDate)}
            </span>
          ) : null}
        </span>
        {task.assignee ? (
          <PersonAvatar
            name={task.assignee.name}
            avatarUrl={task.assignee.avatarUrl}
            title={task.assignee.name}
            className="size-6 shrink-0"
            fallbackClassName="text-[10px]"
          />
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

/** A filter that takes several values: a button saying what is chosen, and a list to choose from. */
function MultiPicker({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[] | undefined) => void;
}) {
  const names = selected.map(
    (value) => options.find((option) => option.value === value)?.label ?? '…',
  );
  const summary =
    names.length === 0
      ? label
      : names.length <= 2
        ? `${label}: ${names.join(', ')}`
        : `${label}: ${names.slice(0, 2).join(', ')} +${names.length - 2}`;

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={selected.length > 0 ? 'secondary' : 'outline'}
          size="sm"
          aria-label={selected.length > 0 ? summary : `Filter by ${label.toLowerCase()}`}
        >
          <span className="max-w-[14rem] truncate">{summary}</span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={`Find ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  onSelect={() => toggle(option.value)}
                >
                  <Check
                    className={cn(
                      'size-4',
                      selected.includes(option.value) ? 'opacity-100' : 'opacity-0',
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SingleSelect({
  label,
  prefix,
  value,
  options,
  onChange,
}: {
  label: string;
  /** Said before the value when the value alone would not say what it is. */
  prefix?: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        // Radix sends '' when its options change; that is not a choice.
        if (next && next !== value) onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="h-8 w-auto gap-1.5">
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NameDialog({
  title,
  initial,
  pending,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const ready = name.trim() !== '' && !pending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Saved searches are yours, listed in your sidebar.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onSubmit(name.trim());
          }}
        >
          <Input
            aria-label="Search name"
            value={name}
            autoFocus
            maxLength={SAVED_SEARCH_NAME_MAX}
            placeholder="e.g. Overdue in Maintenance"
            onChange={(event) => setName(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
