import { Search } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
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
import { Skeleton } from '@/components/ui/skeleton';
import { usePortfolioStore, type Portfolio } from '@/stores/portfolio.store';

import { usePortfolioProjectIndex } from '../hooks/use-portfolio-projects';

interface AddProjectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  portfolio: Portfolio | null;
}

export function AddProjectsDialog({
  open,
  onOpenChange,
  workspaceId,
  portfolio,
}: AddProjectsDialogProps) {
  const addProjects = usePortfolioStore((state) => state.addProjects);

  // Fetch only while the dialog is open — an id of `undefined` disables the query.
  const { projectsById, isLoading } = usePortfolioProjectIndex(open ? workspaceId : undefined);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  /** Clearing on close (not in an effect) leaves the next open with a blank slate. */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSearch('');
      setSelected(new Set());
    }
    onOpenChange(next);
  };

  const memberIds = new Set(portfolio?.projectIds ?? []);
  const candidates = [...projectsById.values()].filter((project) => !memberIds.has(project.id));

  const query = search.trim().toLowerCase();
  const visible = query
    ? candidates.filter(
        (project) =>
          project.name.toLowerCase().includes(query) || project.key.toLowerCase().includes(query),
      )
    : candidates;

  const toggle = (projectId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });

  const confirm = () => {
    if (!workspaceId || !portfolio || selected.size === 0) return;

    addProjects(workspaceId, portfolio.id, [...selected]);
    toast.success(
      `${selected.size} ${selected.size === 1 ? 'project' : 'projects'} added to "${portfolio.name}"`,
    );
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add projects</DialogTitle>
          <DialogDescription>
            A project can sit in any number of portfolios — adding it here changes nothing about the
            project.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or key…"
            aria-label="Search projects"
            className="pl-8"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <span className="sr-only">Loading projects</span>
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {candidates.length === 0
              ? 'Every project is already in this portfolio.'
              : 'No projects match that search.'}
          </p>
        ) : (
          <ul aria-label="Projects to add" className="max-h-72 space-y-1 overflow-y-auto">
            {visible.map((project) => (
              <li key={project.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60">
                  <input
                    type="checkbox"
                    checked={selected.has(project.id)}
                    onChange={() => toggle(project.id)}
                    className="size-4 rounded border-input accent-primary focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  />
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{project.name}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {project.key}
                  </Badge>
                  {project.archivedAt !== null && <Badge variant="muted">Archived</Badge>}
                </label>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={selected.size === 0}>
            Add {selected.size > 0 ? selected.size : ''}{' '}
            {selected.size === 1 ? 'project' : 'projects'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
