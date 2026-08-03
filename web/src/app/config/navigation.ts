import {
  BarChart3,
  CalendarDays,
  CircleCheckBig,
  FolderKanban,
  Home,
  Inbox,
  Settings,
  Ticket,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Rendered as a "Soon" chip; the route resolves to a placeholder page. */
  comingSoon?: boolean;
}

export interface NavSection {
  id: string;
  label?: string;
  items: NavItem[];
}

/**
 * Single source of truth for the sidebar. The router builds its routes from
 * this list, so a nav entry can never point at a route that does not exist.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'workspace',
    items: [
      { label: 'Home', to: '/', icon: Home },
      { label: 'My Tasks', to: '/my-tasks', icon: CircleCheckBig },
      { label: 'Inbox', to: '/inbox', icon: Inbox, comingSoon: true },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    items: [
      { label: 'Projects', to: '/projects', icon: FolderKanban },
      { label: 'Tickets', to: '/tickets', icon: Ticket },
      { label: 'Members', to: '/members', icon: Users },
      { label: 'Teams', to: '/teams', icon: UsersRound, comingSoon: true },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { label: 'Calendar', to: '/calendar', icon: CalendarDays, comingSoon: true },
      { label: 'Reports', to: '/reports', icon: BarChart3, comingSoon: true },
    ],
  },
  {
    id: 'account',
    items: [{ label: 'Settings', to: '/settings', icon: Settings, comingSoon: true }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
