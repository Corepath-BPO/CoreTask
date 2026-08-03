import { PROJECT_STATUSES, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { ProjectSummary } from '@coretask/types';
import { FolderKanban, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { humanizeEnum } from '@/lib/utils';

import { ProjectCard } from '../components/project-card';
import { ProjectFormDialog } from '../components/project-form-dialog';
import { useArchiveProject, useProjects } from '../hooks/use-projects';

const ALL_STATUSES = '__all__';
const PAGE_SIZE = 12;

export function ProjectsPage() {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<string>(ALL_STATUSES);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  /**
   * Filters reset paging at the point of change rather than in an effect
   * reacting to them — otherwise page 3 of the old filter is requested once
   * before the reset lands, which shows a flash of wrong (or empty) results.
   */
  const applyFilter = <T,>(setter: (value: T) => void) => {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  };

  const onSearchChange = applyFilter(setSearch);
  const onStatusChange = applyFilter(setStatus);
  const onArchivedChange = applyFilter(setIncludeArchived);

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(status !== ALL_STATUSES ? { status } : {}),
      ...(includeArchived ? { includeArchived: true } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [page, status, includeArchived, debouncedSearch],
  );

  const { data, isLoading, isError, error } = useProjects(workspaceId, params);
  const archiveProject = useArchiveProject(workspaceId);

  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canCreate = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canArchive = hasAtLeastRole(role, WorkspaceRole.MANAGER);

  const projects = data?.items ?? [];
  const meta = data?.meta;
  const filtered = debouncedSearch !== '' || status !== ALL_STATUSES || includeArchived;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (project: ProjectSummary) => {
    setEditing(project);
    setFormOpen(true);
  };

  if (workspaceLoading) return <ProjectsSkeleton />;

  if (!workspace) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No workspace yet"
        description="Create a workspace before adding projects."
        className="mt-10"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description={`Boards, sections and work across ${workspace.name}.`}
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Plus />
              New project
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search by name or key…"
            aria-label="Search projects"
            className="pl-9"
          />
        </div>

        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger aria-label="Filter by status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
            {PROJECT_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {humanizeEnum(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => onArchivedChange(event.target.checked)}
            className="size-4 rounded border-input accent-primary focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
          Show archived
        </label>
      </div>

      {isError && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Could not load projects.'}
          </CardContent>
        </Card>
      )}

      {isLoading && <ProjectsGridSkeleton />}

      {!isLoading && !isError && projects.length === 0 && (
        <EmptyState
          icon={FolderKanban}
          title={filtered ? 'No projects match those filters' : 'No projects yet'}
          description={
            filtered
              ? 'Try a different search term, or clear the filters.'
              : 'A project groups work into sections and gives its tickets a key like CORE-1001.'
          }
          action={
            filtered ? (
              <Button
                variant="outline"
                onClick={() => {
                  onSearchChange('');
                  onStatusChange(ALL_STATUSES);
                  onArchivedChange(false);
                }}
              >
                Clear filters
              </Button>
            ) : canCreate ? (
              <Button onClick={openCreate}>
                <Plus />
                Create your first project
              </Button>
            ) : undefined
          }
        />
      )}

      {projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onEdit={openEdit}
              onToggleArchive={(target) =>
                archiveProject.mutate({
                  projectId: target.id,
                  archived: target.archivedAt !== null,
                })
              }
              canEdit={canCreate}
              canArchive={canArchive}
            />
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} of {meta.totalPages} · {meta.total} projects
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        workspaceId={workspaceId}
        project={editing}
      />
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading projects</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-9 w-full max-w-md" />
      <ProjectsGridSkeleton />
    </div>
  );
}

function ProjectsGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="space-y-3 py-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-3 w-1/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
