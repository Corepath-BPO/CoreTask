import { Link, useRouterState } from '@tanstack/react-router';
import { ListFilter, Star } from 'lucide-react';
import { Fragment } from 'react';

import { NAV_SECTIONS, type NavItem } from '@/app/config/navigation';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStarredProjects } from '@/features/projects/hooks/use-project-stars';
import { useSavedSearches } from '@/features/search/hooks/use-advanced-search';
import { paramsFromFilters } from '@/features/search/lib/search-url';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';

interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav aria-label="Primary" className="flex flex-col gap-6">
      {NAV_SECTIONS.map((section) => (
        <Fragment key={section.id}>
          <div className="space-y-1">
            {section.label && !collapsed && (
              <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
                {section.label}
              </p>
            )}

            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    item={item}
                    active={isActive(pathname, item.to)}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
          {/* Asana keeps favourites right under Home, My tasks and Inbox. */}
          {section.id === 'workspace' && (
            <StarredProjects pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
          )}
          {/* Saved searches sit with the other ways of looking across work. */}
          {section.id === 'insights' && (
            <SavedSearchLinks pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
          )}
        </Fragment>
      ))}
    </nav>
  );
}

/**
 * The reader's starred projects. Nothing at all until something is starred —
 * an empty "Starred" heading is a box asking to be filled.
 */
function StarredProjects({
  pathname,
  collapsed,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const { workspace } = useActiveWorkspace();
  const { data: starred } = useStarredProjects(workspace?.id);

  if (!starred || starred.length === 0) return null;

  return (
    <div className="space-y-1">
      {!collapsed && (
        <p className="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
          <Star className="size-3" aria-hidden="true" />
          Starred
        </p>
      )}
      <ul className="space-y-0.5" aria-label="Starred projects">
        {starred.map((project) => {
          const active = pathname.startsWith(`/projects/${project.id}`);
          const link = (
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                active
                  ? 'bg-sidebar-accent text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
                collapsed && 'justify-center px-0',
              )}
            >
              <span
                className="size-3 shrink-0 rounded-[4px]"
                style={{ backgroundColor: project.color }}
                aria-hidden="true"
              />
              {!collapsed && <span className="flex-1 truncate">{project.name}</span>}
            </Link>
          );

          return (
            <li key={project.id}>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{project.name}</TooltipContent>
                </Tooltip>
              ) : (
                link
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The reader's saved searches, each a link to its filters. Like Starred,
 * nothing at all until there is something to list.
 */
function SavedSearchLinks({
  pathname,
  collapsed,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const { workspace } = useActiveWorkspace();
  const { data: saved } = useSavedSearches(workspace?.id);
  const openId = useRouterState({
    select: (state): string | undefined => {
      const value = (state.location.search as { saved?: unknown }).saved;
      return typeof value === 'string' ? value : undefined;
    },
  });

  if (!saved || saved.length === 0) return null;

  return (
    <div className="space-y-1">
      {!collapsed && (
        <p className="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
          <ListFilter className="size-3" aria-hidden="true" />
          Saved searches
        </p>
      )}
      <ul className="space-y-0.5" aria-label="Saved searches">
        {saved.map((search) => {
          const active = pathname === '/search' && openId === search.id;
          const link = (
            <Link
              to="/search"
              search={{ ...paramsFromFilters(search.filters), saved: search.id }}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                active
                  ? 'bg-sidebar-accent text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
                collapsed && 'justify-center px-0',
              )}
            >
              <ListFilter className="size-3.5 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="flex-1 truncate">{search.name}</span>}
            </Link>
          );

          return (
            <li key={search.id}>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{search.name}</TooltipContent>
                </Tooltip>
              ) : (
                link
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-[color,background-color,transform]',
        'focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
        active
          ? 'bg-primary text-primary-foreground shadow-[0_8px_24px_oklch(0.763_0.164_134/14%)]'
          : 'text-muted-foreground hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {item.comingSoon && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Soon
            </span>
          )}
        </>
      )}
    </Link>
  );

  // Collapsed rail hides the label, so the tooltip becomes the only affordance.
  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {item.comingSoon && ' · Soon'}
      </TooltipContent>
    </Tooltip>
  );
}

/** `/` matches only itself; every other route also matches its children. */
function isActive(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}
