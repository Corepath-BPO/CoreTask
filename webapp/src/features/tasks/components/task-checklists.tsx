import { MAX_CHECKLISTS_PER_TASK, MAX_CHECKLIST_ITEMS } from '@coretask/contracts';
import type { TaskChecklist, TaskChecklistItem } from '@coretask/types';
import { ListTodo, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useState } from 'react';

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
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { useChecklistActions, useTaskChecklists } from '../hooks/use-task-checklists';

type Actions = ReturnType<typeof useChecklistActions>;

const quietButton =
  'cursor-pointer rounded px-1 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40';

const iconButton =
  'cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40';

/**
 * A task's checklists: named lists of things to tick off.
 *
 * Lighter than subtasks — an item is a line and a tick, with no assignee or
 * date of its own — which is what a move-in inspection or a launch list wants.
 * The "Add a checklist" automation step writes the same lists, so a rule can
 * hand every new lease the same twelve checks.
 *
 * Shown to anyone who can edit the task, and to anyone else only once there
 * is a checklist to read.
 */
export function TaskChecklists({
  workspaceId,
  taskId,
  canEdit,
}: {
  workspaceId: string | undefined;
  taskId: string;
  canEdit: boolean;
}) {
  const { data: checklists = [] } = useTaskChecklists(workspaceId, taskId);
  const actions = useChecklistActions(workspaceId, taskId);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  // The list just made, so its item box opens ready for the first line.
  const [fresh, setFresh] = useState<string | null>(null);
  const focusOnMount = useCallback((node: HTMLInputElement | null) => node?.focus(), []);

  if (!canEdit && checklists.length === 0) return null;

  const full = checklists.length >= MAX_CHECKLISTS_PER_TASK;

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const before = new Set(checklists.map((list) => list.id));
    actions.create.mutate(
      { name: trimmed },
      {
        onSuccess: (lists) => {
          setFresh(lists.find((list) => !before.has(list.id))?.id ?? null);
          setName('');
          setNaming(false);
        },
      },
    );
  };

  return (
    <section className="space-y-2" aria-label="Checklists">
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ListTodo className="size-3.5" aria-hidden="true" />
          Checklists
        </h3>
        {canEdit && !full && (
          <button
            type="button"
            onClick={() => setNaming(true)}
            aria-label="Add a checklist"
            className={iconButton}
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {checklists.map((checklist) => (
        <ChecklistBlock
          key={checklist.id}
          checklist={checklist}
          canEdit={canEdit}
          actions={actions}
          startAdding={checklist.id === fresh}
        />
      ))}

      {canEdit &&
        !full &&
        (naming ? (
          <Input
            ref={focusOnMount}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
              if (event.key === 'Escape') {
                // Answered here: the panel's own Escape would close it.
                event.preventDefault();
                setName('');
                setNaming(false);
              }
            }}
            onBlur={() => {
              if (name.trim() === '') setNaming(false);
            }}
            placeholder="Name the checklist, then press Enter"
            aria-label="New checklist name"
            className="h-8"
          />
        ) : (
          <button type="button" onClick={() => setNaming(true)} className={quietButton}>
            Add checklist
          </button>
        ))}
    </section>
  );
}

function ChecklistBlock({
  checklist,
  canEdit,
  actions,
  startAdding,
}: {
  checklist: TaskChecklist;
  canEdit: boolean;
  actions: Actions;
  startAdding: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(checklist.name);
  const [adding, setAdding] = useState(startAdding);
  const [title, setTitle] = useState('');
  const [confirming, setConfirming] = useState(false);
  const focusOnMount = useCallback((node: HTMLInputElement | null) => node?.focus(), []);

  const done = checklist.items.filter((item) => item.completed).length;
  const full = checklist.items.length >= MAX_CHECKLIST_ITEMS;

  const rename = () => {
    setRenaming(false);
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === checklist.name) {
      setDraftName(checklist.name);
      return;
    }
    actions.update.mutate({ checklistId: checklist.id, name: trimmed });
  };

  const add = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    // Enter adds and stays open, so the next line can follow.
    actions.addItem.mutate(
      { checklistId: checklist.id, title: trimmed },
      { onSuccess: () => setTitle('') },
    );
  };

  return (
    <div className="rounded-md border border-border/70 px-2 py-1.5">
      <div className="flex items-center gap-2">
        {renaming ? (
          <Input
            ref={focusOnMount}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') rename();
              if (event.key === 'Escape') {
                // Answered here: the panel's own Escape would close it.
                event.preventDefault();
                setDraftName(checklist.name);
                setRenaming(false);
              }
            }}
            onBlur={rename}
            aria-label="Checklist name"
            className="h-7 flex-1"
          />
        ) : (
          <h4 className="min-w-0 flex-1 truncate text-sm font-medium">{checklist.name}</h4>
        )}
        <span
          className="rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground"
          aria-label={`${done} of ${checklist.items.length} done`}
        >
          {done}/{checklist.items.length}
        </span>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for the checklist "${checklist.name}"`}
                className={iconButton}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onSelect={() => {
                  setDraftName(checklist.name);
                  setRenaming(true);
                }}
              >
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
                <Trash2 />
                Delete checklist
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {checklist.items.length > 0 && (
        <ul className="mt-1">
          {checklist.items.map((item) => (
            <ChecklistItemRow
              key={item.id}
              checklistId={checklist.id}
              item={item}
              canEdit={canEdit}
              actions={actions}
            />
          ))}
        </ul>
      )}

      {canEdit &&
        !full &&
        (adding ? (
          <Input
            ref={focusOnMount}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
              if (event.key === 'Escape') {
                // Answered here: the panel's own Escape would close it.
                event.preventDefault();
                setTitle('');
                setAdding(false);
              }
            }}
            onBlur={() => {
              if (title.trim() === '') setAdding(false);
            }}
            placeholder="Write an item, then press Enter"
            aria-label={`New item for "${checklist.name}"`}
            className="mt-1 h-8"
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={quietButton}>
            Add an item
          </button>
        ))}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this checklist?</AlertDialogTitle>
            <AlertDialogDescription>
              “{checklist.name}” and its {checklist.items.length} item
              {checklist.items.length === 1 ? '' : 's'} are removed from the task.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => actions.remove.mutate(checklist.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChecklistItemRow({
  checklistId,
  item,
  canEdit,
  actions,
}: {
  checklistId: string;
  item: TaskChecklistItem;
  canEdit: boolean;
  actions: Actions;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const focusOnMount = useCallback((node: HTMLInputElement | null) => node?.focus(), []);
  const boxId = `checklist-item-${item.id}`;

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === item.title) {
      setDraft(item.title);
      return;
    }
    actions.updateItem.mutate({ checklistId, itemId: item.id, title: trimmed });
  };

  return (
    <li className="group flex min-h-8 items-center gap-2 px-1">
      <Checkbox
        id={boxId}
        checked={item.completed}
        disabled={!canEdit}
        onCheckedChange={(checked) =>
          actions.updateItem.mutate({ checklistId, itemId: item.id, completed: checked === true })
        }
      />
      {editing ? (
        <Input
          ref={focusOnMount}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') {
              // Answered here: the panel's own Escape would close it.
              event.preventDefault();
              setDraft(item.title);
              setEditing(false);
            }
          }}
          onBlur={save}
          aria-label="Item text"
          className="h-7 flex-1"
        />
      ) : (
        <label
          htmlFor={boxId}
          title={
            item.completed && item.completedBy ? `Ticked by ${item.completedBy.name}` : undefined
          }
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            canEdit && 'cursor-pointer',
            item.completed && 'text-muted-foreground line-through decoration-muted-foreground/50',
          )}
        >
          {item.title}
        </label>
      )}
      {canEdit && !editing && (
        <span className="flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit "${item.title}"`}
            onClick={() => {
              setDraft(item.title);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove "${item.title}"`}
            onClick={() => actions.removeItem.mutate({ checklistId, itemId: item.id })}
          >
            <X aria-hidden="true" />
          </Button>
        </span>
      )}
    </li>
  );
}
