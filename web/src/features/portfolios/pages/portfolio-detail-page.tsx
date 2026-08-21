import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Briefcase, Folder, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { initials } from '@/lib/utils';
import { usePortfolio, usePortfolioStore } from '@/stores/portfolio.store';

import { PortfolioFormDialog } from '../components/portfolio-form-dialog';
import { PortfolioViewTabs } from '../components/portfolio-view-tabs';
import { StarButton } from '../components/star-button';
import { usePortfolioProjectIndex } from '../hooks/use-portfolio-projects';
import { projectLeads, rollupPortfolio } from '../lib/rollup';

interface PortfolioDetailPageProps {
  portfolioId: string;
}

/**
 * The portfolio shell: header, tabs and an outlet, mirroring the project
 * detail page. Each tab renders in the outlet; the details panel on the right
 * is the portfolio's own metadata, not a view of its work.
 */
export function PortfolioDetailPage({ portfolioId }: PortfolioDetailPageProps) {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const navigate = useNavigate();

  const portfolio = usePortfolio(workspaceId, portfolioId);
  const toggleStarred = usePortfolioStore((state) => state.toggleStarred);
  const deletePortfolio = usePortfolioStore((state) => state.deletePortfolio);

  const { projectsById } = usePortfolioProjectIndex(workspaceId);

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (workspaceLoading) return <PortfolioDetailSkeleton />;

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

  if (!portfolio) {
    // The URL is bookmarkable but the data is not: portfolios live in this
    // browser's storage, so an id from elsewhere has nothing to resolve against.
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          icon={Briefcase}
          title="Portfolio not found"
          description="It may have been deleted — or created in another browser. Portfolios are stored locally for now."
          action={
            <Button variant="outline" asChild>
              <Link to="/portfolios">Back to portfolios</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const rollup = rollupPortfolio(portfolio, projectsById);
  const leads = projectLeads(rollup.projects);

  const confirmDelete = () => {
    deletePortfolio(workspace.id, portfolio.id);
    toast.success(`Portfolio "${portfolio.name}" deleted`);
    void navigate({ to: '/portfolios' });
  };

  return (
    /*
     * Full-bleed, like Asana: the shell pins itself to the whole main area and
     * splits it — a fixed header strip on top, and a body the tabs fill edge
     * to edge. Scrolling happens inside each region, never on the page.
     */
    <div className="absolute inset-0 flex flex-col">
      <div className="shrink-0 space-y-2 border-b px-4 pt-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/portfolios"
            aria-label="Back to portfolios"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <Folder
            aria-hidden="true"
            className="size-6 shrink-0"
            style={{ color: portfolio.color }}
            fill="currentColor"
          />
          <h1 className="text-xl font-semibold tracking-tight">{portfolio.name}</h1>
          <StarButton
            portfolio={portfolio}
            onToggleStar={() => toggleStarred(workspace.id, portfolio.id)}
          />

          <div className="ml-auto flex items-center gap-2">
            {leads.length > 0 && (
              <div className="flex -space-x-1.5">
                {leads.map((lead) => (
                  <Avatar key={lead.id} className="size-6 ring-2 ring-background" title={lead.name}>
                    {lead.avatarUrl && <AvatarImage src={lead.avatarUrl} alt="" />}
                    <AvatarFallback className="text-[9px]">{initials(lead.name)}</AvatarFallback>
                  </Avatar>
                ))}
              </div>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Actions for ${portfolio.name}`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil />
                  Edit portfolio
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
                  <Trash2 />
                  Delete portfolio
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <PortfolioViewTabs portfolioId={portfolio.id} />
      </div>

      {/* Each tab renders here — the list is one representation of the
          portfolio, not the portfolio itself. Tabs own their scrolling. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>

      <PortfolioFormDialog
        open={editing}
        onOpenChange={setEditing}
        workspaceId={workspace.id}
        portfolio={portfolio}
      />

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {portfolio.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its projects are untouched — a portfolio is only a grouping of references. This cannot
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

function BackLink() {
  return (
    <Link
      to="/portfolios"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Portfolios
    </Link>
  );
}

function PortfolioDetailSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading portfolio</span>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-9 w-96" />
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
