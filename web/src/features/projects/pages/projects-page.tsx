import {
  PROJECT_STATUSES,
  ProjectStatus,
  ProjectVisibility,
  WorkItemType,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { ProjectSummary, UserRef } from '@coretask/types';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  Check,
  ChevronDown,
  Folder,
  FolderKanban,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Ticket,
  Upload,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ImportProjectDialog } from '@/features/import/components/import-project-dialog';
import { useTeams } from '@/features/teams/hooks/use-teams';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatDate, humanizeEnum } from '@/lib/utils';
import { usePortfolios, type Portfolio } from '@/stores/portfolio.store';

import { ProjectFormDialog } from '../components/project-form-dialog';
import { ProjectMembersStack } from '../components/sharing/project-members-stack';
import { ProjectPrivacyBadge } from '../components/sharing/project-privacy-badge';
import { ShareProjectDialog } from '../components/sharing/share-project-dialog';
import { useJoinProject } from '../hooks/use-project-members';
import { useArchiveProject, useProjects } from '../hooks/use-projects';
import { resolveProjectAccess } from '../lib/project-access';

/** The Members chip: everything, only what the reader is on, or only what is private. */
type MembershipFilter = 'me' | 'private';

/**
 * One page of everything: the API caps a page at 100, which comfortably holds
 * a workspace this size, so the browse list filters and sorts client-side the
 * way Asana's does. Search still round-trips so it can reach past the cap.
 */
const PAGE_CAP = 100;

const ROW_GRID = 'grid grid-cols-[minmax(0,2.2fr)_150px_minmax(0,1.6fr)_200px] items-center gap-3';

/** Asana's "Browse projects": one searchable list, not a wall of cards. */
export function ProjectsPage() {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  // The team filter lives in the URL, not in state: team cards link straight
  // here, and a shared link has to arrive filtered.
  const { teamId } = useSearch({ from: '/protected/projects' });
  const navigate = useNavigate();
  const { data: teams } = useTeams(workspaceId);
  const portfolios = usePortfolios(workspaceId);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [membership, setMembership] = useState<MembershipFilter | null>(null);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [sortDescending, setSortDescending] = useState(true);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [sharing, setSharing] = useState<ProjectSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = useMemo(
    () => ({
      limit: PAGE_CAP,
      ...(status ? { status } : {}),
      // Archived projects stay hidden until someone asks for them by status.
      ...(status === ProjectStatus.ARCHIVED ? { includeArchived: true } : {}),
      ...(teamId ? { teamId } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [status, teamId, debouncedSearch],
  );

  const { data, isLoading, isError, error } = useProjects(workspaceId, params);
  const archiveProject = useArchiveProject(workspaceId);
  const joinProject = useJoinProject(workspaceId);

  // Creating is a workspace-level act; everything on a row is judged per
  // project, from the `access` each summary carries.
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canCreate = hasAtLeastRole(role, WorkspaceRole.MEMBER);

  const items = useMemo(() => data?.items ?? [], [data]);
  const meta = data?.meta;

  const owners = useMemo(() => {
    const byId = new Map<string, UserRef>();
    for (const project of items) if (project.lead) byId.set(project.lead.id, project.lead);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const portfoliosByProject = useMemo(() => {
    const byProject = new Map<string, Portfolio[]>();
    for (const portfolio of portfolios) {
      for (const projectId of portfolio.projectIds) {
        byProject.set(projectId, [...(byProject.get(projectId) ?? []), portfolio]);
      }
    }
    return byProject;
  }, [portfolios]);

  const visible = useMemo(() => {
    let list = items;
    if (ownerId) list = list.filter((project) => project.lead?.id === ownerId);
    if (membership === 'me') list = list.filter((project) => project.access?.isMember);
    if (membership === 'private') {
      list = list.filter((project) => project.visibility === ProjectVisibility.PRIVATE);
    }
    if (portfolioId) {
      const chosen = new Set(
        portfolios.find((portfolio) => portfolio.id === portfolioId)?.projectIds ?? [],
      );
      list = list.filter((project) => chosen.has(project.id));
    }
    const direction = sortDescending ? -1 : 1;
    return [...list].sort(
      (a, b) => direction * (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)),
    );
  }, [items, ownerId, membership, portfolioId, portfolios, sortDescending]);

  const filtered =
    debouncedSearch !== '' ||
    status !== null ||
    ownerId !== null ||
    membership !== null ||
    portfolioId !== null ||
    Boolean(teamId);

  const clearFilters = () => {
    setSearch('');
    setStatus(null);
    setOwnerId(null);
    setMembership(null);
    setPortfolioId(null);
    void navigate({ to: '/projects', search: {}, replace: true });
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (project: ProjectSummary) => {
    setEditing(project);
    setFormOpen(true);
  };

  if (workspaceLoading) return <BrowseSkeleton />;

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
    <div className="space-y-5">
      <PageHeader
        title="Browse projects"
        actions={
          canCreate && (
            <>
              {/* Same permission as creating by hand — an import is just a
                  lot of creates. */}
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload />
                Import CSV
              </Button>
              <Button onClick={openCreate}>
                <Plus />
                Create project
              </Button>
            </>
          )
        }
      />

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a project"
          aria-label="Find a project"
          className="h-10 rounded-lg pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          label="Owner"
          allLabel="All owners"
          value={ownerId}
          options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
          onSelect={setOwnerId}
        />
        <FilterChip
          label="Members"
          allLabel="Anyone"
          value={membership}
          options={[
            { value: 'me', label: 'I’m a member' },
            { value: 'private', label: 'Private to members' },
          ]}
          onSelect={(value) => setMembership(value as MembershipFilter | null)}
        />
        <FilterChip
          label="Teams"
          allLabel="All teams"
          value={teamId ?? null}
          options={(teams ?? []).map((team) => ({ value: team.id, label: team.name }))}
          onSelect={(value) => {
            void navigate({
              to: '/projects',
              search: value ? { teamId: value } : {},
              replace: true,
            });
          }}
        />
        <FilterChip
          label="Portfolios"
          allLabel="All portfolios"
          value={portfolioId}
          options={portfolios.map((portfolio) => ({
            value: portfolio.id,
            label: portfolio.name,
          }))}
          onSelect={setPortfolioId}
        />
        <FilterChip
          label="Status"
          allLabel="All statuses"
          value={status}
          options={PROJECT_STATUSES.map((value) => ({ value, label: humanizeEnum(value) }))}
          onSelect={setStatus}
        />
      </div>

      {isError && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Could not load projects.'}
          </CardContent>
        </Card>
      )}

      {isLoading && <BrowseRowsSkeleton />}

      {!isLoading && !isError && visible.length === 0 && (
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
              <Button variant="outline" onClick={clearFilters}>
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

      {!isLoading && !isError && visible.length > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[56rem]">
            <div
              className={cn(
                ROW_GRID,
                'border-b px-2 pb-2 text-xs font-medium text-muted-foreground',
              )}
            >
              <span>Name</span>
              <span>Members</span>
              <span>Portfolios</span>
              <button
                type="button"
                onClick={() => setSortDescending((current) => !current)}
                aria-label={`Sort by last modified, ${sortDescending ? 'newest' : 'oldest'} first`}
                className="inline-flex items-center justify-end gap-1 rounded-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <ArrowUpDown className="size-3.5" aria-hidden="true" />
                Last modified
              </button>
            </div>

            {visible.map((project) => {
              const access = resolveProjectAccess(project, role);

              return (
                <ProjectRow
                  key={project.id}
                  project={project}
                  portfolios={portfoliosByProject.get(project.id) ?? []}
                  canEdit={access.canEdit}
                  canArchive={access.canManage}
                  canJoin={access.canJoin}
                  joinPending={
                    joinProject.isPending && joinProject.variables?.projectId === project.id
                  }
                  onEdit={openEdit}
                  onShare={setSharing}
                  onJoin={(target) =>
                    joinProject.mutate({ projectId: target.id, name: target.name })
                  }
                  onToggleArchive={(target) =>
                    archiveProject.mutate({
                      projectId: target.id,
                      archived: target.archivedAt !== null,
                    })
                  }
                />
              );
            })}
          </div>
        </div>
      )}

      {meta && meta.total > items.length && (
        <p className="text-xs text-muted-foreground">
          Showing the first {items.length} of {meta.total} projects — search to find the rest.
        </p>
      )}

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        workspaceId={workspaceId}
        project={editing}
      />

      <ImportProjectDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        workspaceId={workspaceId}
      />

      <ShareProjectDialog
        open={sharing !== null}
        onOpenChange={(open) => {
          if (!open) setSharing(null);
        }}
        workspaceId={workspaceId}
        // The list refetches after every change, so the open dialog reads the
        // row as it now is rather than as it was when the menu was clicked.
        project={sharing ? (items.find((item) => item.id === sharing.id) ?? sharing) : null}
        access={resolveProjectAccess(
          sharing ? (items.find((item) => item.id === sharing.id) ?? sharing) : null,
          role,
        )}
      />
    </div>
  );
}

interface FilterChipProps {
  label: string;
  allLabel: string;
  value: string | null;
  options: { value: string; label: string }[];
  onSelect: (value: string | null) => void;
}

/** Asana's rounded filter pill: the label alone until a choice narrows it. */
function FilterChip({ label, allLabel, value, options, onSelect }: FilterChipProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'rounded-full font-normal',
            selected && 'border-primary/40 bg-primary/5 font-medium',
          )}
        >
          {selected ? `${label}: ${selected.label}` : label}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-44 overflow-y-auto">
        <DropdownMenuItem onSelect={() => onSelect(null)}>
          <Check className={cn(value === null ? 'opacity-100' : 'opacity-0')} />
          {allLabel}
        </DropdownMenuItem>
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onSelect(option.value)}>
            <Check className={cn(option.value === value ? 'opacity-100' : 'opacity-0')} />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectRow({
  project,
  portfolios,
  canEdit,
  canArchive,
  canJoin,
  joinPending,
  onEdit,
  onShare,
  onJoin,
  onToggleArchive,
}: {
  project: ProjectSummary;
  portfolios: Portfolio[];
  canEdit: boolean;
  canArchive: boolean;
  canJoin: boolean;
  joinPending: boolean;
  onEdit: (project: ProjectSummary) => void;
  onShare: (project: ProjectSummary) => void;
  onJoin: (project: ProjectSummary) => void;
  onToggleArchive: (project: ProjectSummary) => void;
}) {
  const archived = project.archivedAt !== null;
  const TileIcon = project.defaultWorkItemType === WorkItemType.TICKET ? Ticket : List;
  const extraPortfolios = portfolios.length - 1;

  return (
    <div
      className={cn(
        ROW_GRID,
        'group relative border-b border-border/40 px-2 py-2 transition-colors hover:bg-muted/50',
        archived && 'opacity-70',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white"
          style={{ backgroundColor: project.color }}
        >
          <TileIcon className="size-4" />
        </span>
        <div className="min-w-0">
          {/* The whole row is clickable via this stretched link; interactive
              cells below sit above it with their own z-index. */}
          <div className="flex items-center gap-1.5">
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
            >
              <span className="block truncate text-sm font-medium group-hover:underline">
                {project.name}
              </span>
            </Link>
            {project.visibility === ProjectVisibility.PRIVATE && <ProjectPrivacyBadge size="sm" />}
          </div>
          {archived && <span className="text-xs text-muted-foreground">Archived</span>}
        </div>
      </div>

      {/* From the summary's preview — the row's stretched link owns the click,
          so the stack here is not a button. */}
      <div className="flex items-center">
        <ProjectMembersStack
          members={project.members}
          memberCount={project.memberCount}
          leadId={project.leadId}
          size="sm"
        />
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        {portfolios.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
        {portfolios.slice(0, 1).map((portfolio) => (
          <Link
            key={portfolio.id}
            to="/portfolios/$portfolioId/list"
            params={{ portfolioId: portfolio.id }}
            className="relative z-10 flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
          >
            <Folder
              aria-hidden="true"
              className="size-3.5 shrink-0"
              fill="currentColor"
              style={{ color: portfolio.color }}
            />
            <span className="truncate">{portfolio.name}</span>
          </Link>
        ))}
        {extraPortfolios > 0 && (
          <span className="rounded-md bg-muted px-1.5 py-1 text-xs text-muted-foreground">
            +{extraPortfolios}
          </span>
        )}
      </div>

      <div className="flex items-center justify-end gap-1">
        <div className="relative z-10 flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled
            title="Starring projects is not built yet"
            aria-label="Star project (not built yet)"
          >
            <Star />
          </Button>
          {canJoin && (
            <Button
              variant="ghost"
              size="sm"
              loading={joinPending}
              onClick={() => onJoin(project)}
              aria-label={`Join ${project.name}`}
            >
              Join
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${project.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onShare(project)}>
                <Users />
                Share
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem onSelect={() => onEdit(project)}>
                  <Pencil />
                  Edit project
                </DropdownMenuItem>
              )}
              {canArchive && <DropdownMenuSeparator />}
              {canArchive && (
                <DropdownMenuItem
                  variant={archived ? 'default' : 'destructive'}
                  onSelect={() => onToggleArchive(project)}
                >
                  {archived ? <ArchiveRestore /> : <Archive />}
                  {archived ? 'Restore project' : 'Archive project'}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatDate(project.updatedAt)}
        </span>
      </div>
    </div>
  );
}

function BrowseSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <span className="sr-only">Loading projects</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-full" />
      <BrowseRowsSkeleton />
    </div>
  );
}

function BrowseRowsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}
