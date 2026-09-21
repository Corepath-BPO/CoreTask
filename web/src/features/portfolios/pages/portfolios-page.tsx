import type { ProjectSummary } from '@coretask/types';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Briefcase,
  ChevronDown,
  Folder,
  FolderKanban,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, initials } from '@/lib/utils';
import { usePortfolios, usePortfolioStore, type Portfolio } from '@/stores/portfolio.store';

import { AddProjectsDialog } from '../components/add-projects-dialog';
import { PortfolioFormDialog } from '../components/portfolio-form-dialog';
import { StarButton } from '../components/star-button';
import { usePortfolioProjectIndex } from '../hooks/use-portfolio-projects';
import { projectLeads, rollupPortfolio } from '../lib/rollup';

type PortfolioTab = 'recent' | 'all';
type PortfolioLayout = 'grid' | 'list';

export function PortfoliosPage() {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const navigate = useNavigate();

  const portfolios = usePortfolios(workspaceId);
  const deletePortfolio = usePortfolioStore((state) => state.deletePortfolio);
  const toggleStarred = usePortfolioStore((state) => state.toggleStarred);
  const { projectsById } = usePortfolioProjectIndex(workspaceId);

  const [tab, setTab] = useState<PortfolioTab>('recent');
  const [layout, setLayout] = useState<PortfolioLayout>('grid');
  const [collapsed, setCollapsed] = useState(false);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Portfolio | null>(null);
  const [addingTo, setAddingTo] = useState<Portfolio | null>(null);
  const [deleting, setDeleting] = useState<Portfolio | null>(null);

  const confirmDelete = () => {
    if (!workspaceId || !deleting) return;
    deletePortfolio(workspaceId, deleting.id);
    toast.success(`Portfolio "${deleting.name}" deleted`);
    setDeleting(null);
  };

  if (workspaceLoading) return <PortfoliosSkeleton />;

  if (!workspace) {
    return (
      <EmptyState
        icon={Briefcase}
        title="No workspace yet"
        description="Create a workspace before grouping its projects into portfolios."
        className="mt-10"
      />
    );
  }

  // "Recent and starred" mirrors Asana: starred first, then most recently
  // touched. "Browse all" is the alphabetical catalogue.
  const sorted =
    tab === 'recent'
      ? [...portfolios].sort((a, b) => {
          const aStarred = a.starred ?? false;
          const bStarred = b.starred ?? false;
          if (aStarred !== bStarred) return aStarred ? -1 : 1;
          return b.updatedAt.localeCompare(a.updatedAt);
        })
      : [...portfolios].sort((a, b) => a.name.localeCompare(b.name));

  const tileFor = (portfolio: Portfolio) => {
    const rollup = rollupPortfolio(portfolio, projectsById);
    const shared = {
      portfolio,
      projects: rollup.projects,
      onToggleStar: () => toggleStarred(workspace.id, portfolio.id),
      onAddProjects: () => setAddingTo(portfolio),
      onEdit: () => setEditing(portfolio),
      onDelete: () => setDeleting(portfolio),
    };
    return layout === 'grid' ? (
      <PortfolioTile key={portfolio.id} {...shared} />
    ) : (
      <PortfolioListRow key={portfolio.id} {...shared} />
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portfolios"
        actions={
          <Button variant="outline" onClick={() => setCreating(true)}>
            Create portfolio
          </Button>
        }
      />

      <div className="border-b">
        <nav aria-label="Portfolio views" className="-mb-px flex gap-6">
          <TabButton active={tab === 'recent'} onClick={() => setTab('recent')}>
            Recent and starred
          </TabButton>
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
            Browse all
          </TabButton>
        </nav>
      </div>

      <section className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between border-b pb-2">
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            aria-expanded={!collapsed}
            className="inline-flex items-center gap-1.5 text-sm font-semibold"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-4 transition-transform', collapsed && '-rotate-90')}
            />
            {tab === 'recent' ? 'Recent portfolios' : 'All portfolios'}
          </button>

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={layout === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
            onClick={() => setLayout((current) => (current === 'grid' ? 'list' : 'grid'))}
          >
            {layout === 'grid' ? <List /> : <LayoutGrid />}
          </Button>
        </div>

        {!collapsed &&
          (layout === 'grid' ? (
            <div className="flex flex-wrap justify-center gap-x-10 gap-y-8 sm:justify-start">
              <NewPortfolioTile onClick={() => setCreating(true)} />
              {sorted.map(tileFor)}
            </div>
          ) : (
            <ul aria-label="Portfolios" className="divide-y">
              {sorted.length === 0 ? (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  No portfolios yet. Create one to start watching projects together.
                </li>
              ) : (
                sorted.map(tileFor)
              )}
            </ul>
          ))}
      </section>

      <PortfolioFormDialog
        open={creating}
        onOpenChange={setCreating}
        workspaceId={workspaceId}
        onCreated={(portfolio) =>
          navigate({ to: '/portfolios/$portfolioId', params: { portfolioId: portfolio.id } })
        }
      />

      <PortfolioFormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        workspaceId={workspaceId}
        portfolio={editing}
      />

      <AddProjectsDialog
        open={addingTo !== null}
        onOpenChange={(open) => !open && setAddingTo(null)}
        workspaceId={workspaceId}
        portfolio={addingTo}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its projects are untouched. A portfolio is only a grouping of references. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TabButton({
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
      aria-current={active ? 'page' : undefined}
      className={cn(
        'border-b-2 pb-2 text-sm transition-colors',
        active
          ? 'border-foreground font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** The Asana-style folder silhouette: a tab over a rounded body. */
function FolderShape({
  color,
  className,
  children,
}: {
  color: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('relative', className)}>
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 h-5 w-14 rounded-t-xl opacity-80"
        style={{ backgroundColor: color }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-2.5 bottom-0 rounded-2xl rounded-tl-md"
        style={{ backgroundColor: color }}
      />
      {children}
    </div>
  );
}

function NewPortfolioTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-36 flex-col items-center gap-2 focus-visible:outline-none"
    >
      <span className="flex h-24 w-full items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/30 transition-colors group-hover:border-muted-foreground/60 group-hover:bg-muted/40 group-focus-visible:ring-[3px] group-focus-visible:ring-ring/40">
        <Plus className="size-6 text-muted-foreground" aria-hidden="true" />
      </span>
      <span className="text-sm font-medium">New portfolio</span>
    </button>
  );
}

interface PortfolioItemProps {
  portfolio: Portfolio;
  projects: ProjectSummary[];
  onToggleStar: () => void;
  onAddProjects: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function PortfolioActionsMenu({
  portfolio,
  onAddProjects,
  onEdit,
  onDelete,
  className,
}: Pick<PortfolioItemProps, 'portfolio' | 'onAddProjects' | 'onEdit' | 'onDelete'> & {
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${portfolio.name}`}
          className={className}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onAddProjects}>
          <FolderKanban />
          Add projects
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Edit portfolio
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete portfolio
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PortfolioTile({
  portfolio,
  projects,
  onToggleStar,
  onAddProjects,
  onEdit,
  onDelete,
}: PortfolioItemProps) {
  const leads = projectLeads(projects);
  const memberCount = portfolio.projectIds.length;
  const starred = portfolio.starred ?? false;

  return (
    <div className="group relative flex w-36 flex-col items-center gap-2">
      <Link
        to="/portfolios/$portfolioId"
        params={{ portfolioId: portfolio.id }}
        className="block w-full focus-visible:outline-none"
        aria-label={`Open ${portfolio.name}`}
      >
        <FolderShape
          color={portfolio.color}
          className="h-24 w-full transition-transform group-hover:scale-[1.02]"
        >
          {leads.length > 0 && (
            <div className="absolute bottom-1.5 left-2 flex -space-x-1.5">
              {leads.map((lead) => (
                <Avatar key={lead.id} className="size-5 ring-2 ring-background" title={lead.name}>
                  {lead.avatarUrl && <AvatarImage src={lead.avatarUrl} alt="" />}
                  <AvatarFallback className="text-[8px]">{initials(lead.name)}</AvatarFallback>
                </Avatar>
              ))}
            </div>
          )}
        </FolderShape>
      </Link>

      <div className="w-full text-center">
        <Link
          to="/portfolios/$portfolioId"
          params={{ portfolioId: portfolio.id }}
          className="text-sm font-medium leading-tight hover:underline"
        >
          {portfolio.name}
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {memberCount} {memberCount === 1 ? 'project' : 'projects'}
        </p>
      </div>

      <StarButton
        portfolio={portfolio}
        onToggleStar={onToggleStar}
        className={cn(
          'absolute -top-1 -left-1 z-10 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100',
          starred && 'opacity-100',
        )}
      />
      <PortfolioActionsMenu
        portfolio={portfolio}
        onAddProjects={onAddProjects}
        onEdit={onEdit}
        onDelete={onDelete}
        className="absolute -top-1 -right-1 z-10 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
      />
    </div>
  );
}

function PortfolioListRow({
  portfolio,
  onToggleStar,
  onAddProjects,
  onEdit,
  onDelete,
}: PortfolioItemProps) {
  const memberCount = portfolio.projectIds.length;

  return (
    <li className="group flex items-center gap-3 py-2.5">
      <Folder
        aria-hidden="true"
        className="size-4 shrink-0"
        style={{ color: portfolio.color }}
        fill="currentColor"
      />
      <Link
        to="/portfolios/$portfolioId"
        params={{ portfolioId: portfolio.id }}
        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
      >
        {portfolio.name}
      </Link>
      <span className="shrink-0 text-xs text-muted-foreground">
        {memberCount} {memberCount === 1 ? 'project' : 'projects'}
      </span>
      <StarButton
        portfolio={portfolio}
        onToggleStar={onToggleStar}
        className={cn(
          'opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100',
          (portfolio.starred ?? false) && 'opacity-100',
        )}
      />
      <PortfolioActionsMenu
        portfolio={portfolio}
        onAddProjects={onAddProjects}
        onEdit={onEdit}
        onDelete={onDelete}
        className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
      />
    </li>
  );
}

function PortfoliosSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading portfolios</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-6 w-64" />
      <div className="mx-auto flex w-full max-w-3xl flex-wrap justify-center gap-x-10 gap-y-8 sm:justify-start">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex w-36 flex-col items-center gap-2">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
