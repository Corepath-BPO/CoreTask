import { Link, useRouterState } from '@tanstack/react-router';

import { NAV_SECTIONS, type NavItem } from '@/app/config/navigation';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
        <div key={section.id} className="space-y-1">
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
      ))}
    </nav>
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
