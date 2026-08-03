import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { BarChart3, CalendarDays, Inbox, Settings, Users } from 'lucide-react';

import { AppLayout } from '@/app/layouts/app-layout';
import { AuthLayout } from '@/app/layouts/auth-layout';
import { RootLayout } from '@/app/layouts/root-layout';
import { PlaceholderPage } from '@/components/common/placeholder-page';
import { LoginPage } from '@/features/auth/pages/login-page';
import { RegisterPage } from '@/features/auth/pages/register-page';
import { DashboardPage } from '@/features/dashboard/pages/dashboard-page';
import { AcceptInvitationPage } from '@/features/members/pages/accept-invitation-page';
import { MembersPage } from '@/features/members/pages/members-page';
import { ProjectDetailPage } from '@/features/projects/pages/project-detail-page';
import { ProjectsPage } from '@/features/projects/pages/projects-page';
import { MyTasksPage } from '@/features/tasks/pages/my-tasks-page';
import { TicketsPage } from '@/features/tickets/pages/tickets-page';
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

/** Only same-site paths: an absolute URL here would be an open redirect. */
const validateRedirect = (search: Record<string, unknown>): { redirect?: string } => {
  const target = search['redirect'];
  return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')
    ? { redirect: target }
    : {};
};

const loginRoute = createRoute({
  getParentRoute: () => guestRoute,
  path: '/login',
  component: LoginPage,
  validateSearch: validateRedirect,
});

const registerRoute = createRoute({
  getParentRoute: () => guestRoute,
  path: '/register',
  component: RegisterPage,
  // Shares the login rule so an invitation can send someone straight to signup
  // and still land them back on the invitation afterwards.
  validateSearch: validateRedirect,
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

const projectsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/projects',
  component: ProjectsPage,
});

const myTasksRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/my-tasks',
  component: MyTasksPage,
});

const ticketsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/tickets',
  component: TicketsPage,
});

const membersRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/members',
  component: MembersPage,
});

/**
 * Hangs off the root rather than either gate: `guestRoute` would bounce a
 * signed-in user away from the invitation they were sent, and `protectedRoute`
 * would bounce the far more common case — someone with no account at all.
 */
const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invitations/$token',
  component: function AcceptInvitationRoute() {
    const { token } = acceptInvitationRoute.useParams();
    return <AcceptInvitationPage token={token} />;
  },
});

const projectDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/projects/$projectId',
  // Params are read from the route object rather than by route-id string, so
  // the page stays a plain prop-driven component and cannot address a route
  // path that does not exist.
  component: function ProjectDetailRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectDetailPage projectId={projectId} />;
  },
});

/** Sidebar destinations whose API arrives in the next phase. */
const placeholders = [
  {
    path: '/inbox',
    title: 'Inbox',
    description: 'Mentions, assignments and comment replies.',
    icon: Inbox,
    plannedFor: 'Notification centre backed by the notifications module and Socket.IO.',
  },
  {
    path: '/teams',
    title: 'Teams',
    description: 'Groups of people inside this workspace.',
    icon: Users,
    plannedFor: 'Team membership, per-team projects and default assignees.',
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
  acceptInvitationRoute,
  protectedRoute.addChildren([
    dashboardRoute,
    projectsRoute,
    projectDetailRoute,
    myTasksRoute,
    ticketsRoute,
    membersRoute,
    ...placeholderRoutes,
  ]),
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
