import {
  BarChart3,
  CalendarDays,
  CircleCheckBig,
  Folder,
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
  /**
   * Rendered as a "Soon" chip. Must agree with the router: the route for a
   * `comingSoon` item resolves to a placeholder, and one without it must
   * resolve to a real page. `navigation.test.ts` asserts the two stay in step,
   * because they drifted once already — Teams and Inbox both shipped while the
   * sidebar went on advertising them as unbuilt.
   */
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
      { label: 'Inbox', to: '/inbox', icon: Inbox },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    items: [
      { label: 'Projects', to: '/projects', icon: FolderKanban },
      { label: 'Portfolios', to: '/portfolios', icon: Folder },
      { label: 'Tickets', to: '/tickets', icon: Ticket },
      { label: 'Members', to: '/members', icon: Users },
      { label: 'Teams', to: '/teams', icon: UsersRound },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { label: 'Calendar', to: '/calendar', icon: CalendarDays },
      { label: 'Reports', to: '/reports', icon: BarChart3 },
    ],
  },
  {
    id: 'account',
    items: [{ label: 'Settings', to: '/settings', icon: Settings }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
