import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import {
  BarChart3,
  CalendarDays,
  CircleCheckBig,
  FolderKanban,
  Inbox,
  Settings,
  Ticket,
  Users,
} from 'lucide-react';

import { AppLayout } from '@/app/layouts/app-layout';
import { AuthLayout } from '@/app/layouts/auth-layout';
import { RootLayout } from '@/app/layouts/root-layout';
import { PlaceholderPage } from '@/components/common/placeholder-page';
import { LoginPage } from '@/features/auth/pages/login-page';
import { RegisterPage } from '@/features/auth/pages/register-page';
import { DashboardPage } from '@/features/dashboard/pages/dashboard-page';
import { useAuthStore } from '@/stores/auth.store';

import { NotFoundPage } from './not-found-page';

/**
 * Code-based route tree.
 *
 * Chosen over file-based routing so there is no generated `routeTree.gen.ts` to
 * keep in sync — the Docker build and CI compile exactly what is committed.
 */
const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

/** Guests only: a signed-in user hitting /login goes to the dashboard. */
const guestRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'guest',
  component: AuthLayout,
  beforeLoad: () => {
    if (useAuthStore.getState().status === 'authenticated') {
      throw redirect({ to: '/' });
    }
  },
});

const loginRoute = createRoute({
  getParentRoute: () => guestRoute,
  path: '/login',
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const target = search['redirect'];
    // Only same-site paths: an absolute URL here would be an open redirect.
    return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')
      ? { redirect: target }
      : {};
  },
});

const registerRoute = createRoute({
  getParentRoute: () => guestRoute,
  path: '/register',
  component: RegisterPage,
});

/**
 * Authenticated area.
 *
 * This is a convenience gate, not a security boundary — the API authorises every
 * request independently. It exists so an expired session lands on /login instead
 * of an empty dashboard.
 */
const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  component: AppLayout,
  beforeLoad: ({ location }) => {
    if (useAuthStore.getState().status !== 'authenticated') {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      });
    }
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/',
  component: DashboardPage,
});

/** Sidebar destinations whose API arrives in the next phase. */
const placeholders = [
  {
    path: '/my-tasks',
    title: 'My Tasks',
    description: 'Everything assigned to you across every project.',
    icon: CircleCheckBig,
    plannedFor: 'Personal task list with filters, grouping and inline editing.',
  },
  {
    path: '/inbox',
    title: 'Inbox',
    description: 'Mentions, assignments and comment replies.',
    icon: Inbox,
    plannedFor: 'Notification centre backed by the notifications module and Socket.IO.',
  },
  {
    path: '/projects',
    title: 'Projects',
    description: 'Board, list and timeline views for every project.',
    icon: FolderKanban,
    plannedFor: 'Project CRUD with sections, drag-and-drop ordering and progress rollups.',
  },
  {
    path: '/teams',
    title: 'Teams',
    description: 'Groups of people inside this workspace.',
    icon: Users,
    plannedFor: 'Team membership, per-team projects and default assignees.',
  },
  {
    path: '/tickets',
    title: 'Tickets',
    description: 'Bug reports, requests and incidents.',
    icon: Ticket,
    plannedFor: 'Ticket queue with CORE-#### keys, triage workflow and SLA tracking.',
  },
  {
    path: '/calendar',
    title: 'Calendar',
    description: 'Due dates and milestones on a calendar.',
    icon: CalendarDays,
    plannedFor: 'Month and week views fed by task and ticket due dates.',
  },
  {
    path: '/reports',
    title: 'Reports',
    description: 'Throughput, cycle time and workload.',
    icon: BarChart3,
    plannedFor: 'Dashboards over the activity log and completion history.',
  },
  {
    path: '/settings',
    title: 'Settings',
    description: 'Workspace, members and personal preferences.',
    icon: Settings,
    plannedFor: 'Workspace settings, member roles and invitations.',
  },
] as const;

const placeholderRoutes = placeholders.map((page) =>
  createRoute({
    getParentRoute: () => protectedRoute,
    path: page.path,
    component: () => (
      <PlaceholderPage
        title={page.title}
        description={page.description}
        icon={page.icon}
        plannedFor={page.plannedFor}
      />
    ),
  }),
);

const routeTree = rootRoute.addChildren([
  guestRoute.addChildren([loginRoute, registerRoute]),
  protectedRoute.addChildren([dashboardRoute, ...placeholderRoutes]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
