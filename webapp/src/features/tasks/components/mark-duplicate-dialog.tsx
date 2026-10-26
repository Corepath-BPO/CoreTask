import { CheckCircle2, Circle } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSearch } from '@/features/search/hooks/use-search';
import { cn } from '@/lib/utils';

import { useMarkDuplicate } from '../hooks/use-task-duplicates';

const TASKS_ONLY = ['tasks'] as const;

/**
 * Picks the task this one repeats. Marking it completes this task, links it
 * to that one, and moves its collaborators there — Asana's "Mark as duplicate".
 */
export function MarkDuplicateDialog({
  workspaceId,
  taskId,
  onOpenChange,
}: {
  workspaceId: string | undefined;
  taskId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);
  const { data, isFetching } = useSearch(workspaceId, term, TASKS_ONLY);
  const mark = useMarkDuplicate(workspaceId, taskId);
  const hits = (data?.tasks ?? []).filter((hit) => hit.id !== taskId);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as duplicate</DialogTitle>
          <DialogDescription>
            Choose the task this one repeats. This one is completed, and its collaborators move to
            that one.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={term}
          autoFocus
          aria-label="Find the original task"
          placeholder="Search for the original task…"
          onChange={(event) => {
            setTerm(event.target.value);
            setPicked(null);
          }}
        />
        <ul className="max-h-64 space-y-0.5 overflow-y-auto" aria-label="Matching tasks">
          {term.trim() && !isFetching && hits.length === 0 && (
            <li className="px-2 py-3 text-sm text-muted-foreground">No task matches.</li>
          )}
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                aria-pressed={picked?.id === hit.id}
                onClick={() => setPicked({ id: hit.id, title: hit.title })}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                  picked?.id === hit.id && 'bg-primary/10 ring-1 ring-primary/40',
                )}
              >
                {hit.isCompleted ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                {hit.project && (
                  <span className="max-w-[40%] truncate text-xs text-muted-foreground">
                    {hit.project.name}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!picked || mark.isPending}
            onClick={() =>
              picked && mark.mutate(picked.id, { onSuccess: () => onOpenChange(false) })
            }
          >
            Mark as duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
