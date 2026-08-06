import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { BarChart3, CalendarDays, Settings } from 'lucide-react';

import { AppLayout } from '@/app/layouts/app-layout';
import { AuthLayout } from '@/app/layouts/auth-layout';
import { RootLayout } from '@/app/layouts/root-layout';
import { PlaceholderPage } from '@/components/common/placeholder-page';
import { LoginPage } from '@/features/auth/pages/login-page';
import { RegisterPage } from '@/features/auth/pages/register-page';
import { DashboardPage } from '@/features/dashboard/pages/dashboard-page';
import { InboxPage } from '@/features/inbox/pages/inbox-page';
import { AcceptInvitationPage } from '@/features/members/pages/accept-invitation-page';
import { MembersPage } from '@/features/members/pages/members-page';
import { AutomationsPage } from '@/features/automations/pages/automations-page';
import { AutomationBuilderPage } from '@/features/automations/builder/components/automation-builder-page';
import { ProjectBoardPage } from '@/features/projects/pages/project-board-page';
import { ProjectDetailPage } from '@/features/projects/pages/project-detail-page';
import { ProjectListPage } from '@/features/projects/pages/project-list-page';
import { ProjectOverviewPage } from '@/features/projects/pages/project-overview-page';
import { ProjectsPage } from '@/features/projects/pages/projects-page';
import { MyTasksPage } from '@/features/tasks/pages/my-tasks-page';
import { TeamsPage } from '@/features/teams/pages/teams-page';
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
  // and still land them back on the invitation afterwards. `email` additionally
  // carries the invited address, because an invitation can only be accepted by
  // the account it was addressed to — registering a different one is a dead end.
  validateSearch: (search: Record<string, unknown>): { redirect?: string; email?: string } => {
    const email = search['email'];
    return {
      ...validateRedirect(search),
      ...(typeof email === 'string' && email.includes('@') ? { email } : {}),
    };
  },
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

/** UUID-shaped only, so a hand-edited URL cannot push junk into a query key. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const projectsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/projects',
  component: ProjectsPage,
  // In the URL rather than component state so "3 projects" on a team card is a
  // link people can share and go back to.
  validateSearch: (search: Record<string, unknown>): { teamId?: string } => {
    const teamId = search['teamId'];
    return typeof teamId === 'string' && UUID_PATTERN.test(teamId) ? { teamId } : {};
  },
});

const myTasksRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/my-tasks',
  component: MyTasksPage,
  // Notifications link here with `?task=`, so the entry opens the thing it is
  // about rather than dropping the reader on a list to find it themselves.
  validateSearch: (search: Record<string, unknown>): { task?: string } => {
    const task = search['task'];
    return typeof task === 'string' && UUID_PATTERN.test(task) ? { task } : {};
  },
});

const ticketsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/tickets',
  component: TicketsPage,
  // Same as My Tasks, but keyed by the human ticket key — that is what appears
  // in the notification and what somebody would paste to a colleague.
  validateSearch: (search: Record<string, unknown>): { ticket?: string } => {
    const ticket = search['ticket'];
    return typeof ticket === 'string' && /^[A-Z]{2,8}-\d+$/i.test(ticket) ? { ticket } : {};
  },
});

const inboxRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/inbox',
  component: InboxPage,
});

const membersRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/members',
  component: MembersPage,
});

const teamsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/teams',
  component: TeamsPage,
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

/**
 * The project shell: header, tabs and an outlet.
 *
 * A project is not a board. The board is one representation of it, which is why
 * each view is a route rather than a piece of component state — the choice then
 * survives a refresh, works with back and forward, and can be shared.
 */
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

/**
 * Bare `/projects/:id` sends the reader to the board.
 *
 * A redirect rather than rendering the board here, so there is one canonical
 * URL per view and an existing bookmark still lands somewhere real.
 */
const projectIndexRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/projects/$projectId/board',
      params: params as { projectId: string },
    });
  },
});

const projectBoardRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/board',
  component: function ProjectBoardRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectBoardPage projectId={projectId} />;
  },
});

const projectListRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/list',
  component: function ProjectListRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectListPage projectId={projectId} />;
  },
});

const projectOverviewRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/overview',
  component: ProjectOverviewPage,
});

/** Tabs whose implementation lands in a later milestone. */
const projectAutomationsRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/automations',
  component: AutomationsPage,
  // `sectionId` arrives from a section's lightning popover so the builder opens
  // already scoped, rather than asking again for what the click already said.
  validateSearch: (search: Record<string, unknown>): { sectionId?: string; new?: boolean } => ({
    ...(typeof search['sectionId'] === 'string' && UUID_PATTERN.test(search['sectionId'])
      ? { sectionId: search['sectionId'] }
      : {}),
    ...(search['new'] === true || search['new'] === 'true' ? { new: true } : {}),
  }),
});

/**
 * The visual builder, on its own address.
 *
 * A rule now has a URL that can be pasted to a colleague, and Back is the rule
 * list rather than whatever the list happened to be showing. The old builder
 * lived behind `?new=true` on the list route, so neither was true.
 */
const projectAutomationBuilderRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/automations/$ruleId',
  component: function AutomationBuilderRoute() {
    const { projectId, ruleId } = projectAutomationBuilderRoute.useParams();

    return <AutomationBuilderPage projectId={projectId} ruleId={ruleId} />;
  },
});

const projectPlaceholderRoutes = [
  {
    segment: 'activity',
    title: 'Activity',
    plannedFor: 'This project’s slice of the activity feed.',
  },
  {
    segment: 'settings',
    title: 'Settings',
    plannedFor: 'Statuses, fields and project preferences.',
  },
].map((tab) =>
  createRoute({
    getParentRoute: () => projectDetailRoute,
    path: `/${tab.segment}`,
    component: () => (
      <PlaceholderPage
        title={tab.title}
        description="Not built yet."
        icon={Settings}
        plannedFor={tab.plannedFor}
      />
    ),
  }),
);

/** Sidebar destinations whose API arrives in the next phase. */
const placeholders = [
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
    projectDetailRoute.addChildren([
      projectIndexRoute,
      projectOverviewRoute,
      projectListRoute,
      projectBoardRoute,
      projectAutomationsRoute,
      projectAutomationBuilderRoute,
      ...projectPlaceholderRoutes,
    ]),
    myTasksRoute,
    ticketsRoute,
    inboxRoute,
    membersRoute,
    teamsRoute,
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
