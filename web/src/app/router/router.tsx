import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { Gauge, LayoutDashboard, MessageSquare, Settings, TrendingUp } from 'lucide-react';

import { AppLayout } from '@/app/layouts/app-layout';
import { AuthLayout } from '@/app/layouts/auth-layout';
import { RootLayout } from '@/app/layouts/root-layout';
import { PlaceholderPage } from '@/components/common/placeholder-page';
import { LoginPage } from '@/features/auth/pages/login-page';
import { RegisterPage } from '@/features/auth/pages/register-page';
import { CalendarPage } from '@/features/calendar/pages/calendar-page';
import { DashboardPage } from '@/features/dashboard/pages/dashboard-page';
import { InboxPage } from '@/features/inbox/pages/inbox-page';
import { ApiKeysPage } from '@/features/integrations/pages/api-keys-page';
import { IntegrationsPage } from '@/features/integrations/pages/integrations-page';
import { WebhooksPage } from '@/features/integrations/pages/webhooks-page';
import { AcceptInvitationPage } from '@/features/members/pages/accept-invitation-page';
import { MembersPage } from '@/features/members/pages/members-page';
import { AutomationsPage } from '@/features/automations/pages/automations-page';
import { AutomationBuilderDialog } from '@/features/automations/builder/components/automation-builder-dialog';
import { ProjectBoardPage } from '@/features/projects/pages/project-board-page';
import { ProjectDetailPage } from '@/features/projects/pages/project-detail-page';
import { ProjectListPage } from '@/features/projects/pages/project-list-page';
import { ProjectOverviewPage } from '@/features/projects/pages/project-overview-page';
import { ProjectsPage } from '@/features/projects/pages/projects-page';
import { PortfolioDetailPage } from '@/features/portfolios/pages/portfolio-detail-page';
import { PortfolioListPage } from '@/features/portfolios/pages/portfolio-list-page';
import { PortfolioTimelinePage } from '@/features/portfolios/pages/portfolio-timeline-page';
import { PortfoliosPage } from '@/features/portfolios/pages/portfolios-page';
import { ReportsPage } from '@/features/reports/pages/reports-page';
import { SettingsPage } from '@/features/settings/pages/settings-page';
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

const portfoliosRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/portfolios',
  component: PortfoliosPage,
});

/**
 * The portfolio shell: header, tabs and an outlet, same shape as the project
 * shell above. Portfolios are client-side state (there is no portfolio API
 * yet), so the id here is whatever the store minted — the page guards against
 * ids the store does not know rather than trusting the URL.
 */
const portfolioDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/portfolios/$portfolioId',
  component: function PortfolioDetailRoute() {
    const { portfolioId } = portfolioDetailRoute.useParams();
    return <PortfolioDetailPage portfolioId={portfolioId} />;
  },
});

/** Bare `/portfolios/:id` sends the reader to the list, the one built view. */
const portfolioIndexRoute = createRoute({
  getParentRoute: () => portfolioDetailRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/portfolios/$portfolioId/list',
      params: params as { portfolioId: string },
    });
  },
});

const portfolioListRoute = createRoute({
  getParentRoute: () => portfolioDetailRoute,
  path: '/list',
  component: function PortfolioListRoute() {
    const { portfolioId } = portfolioDetailRoute.useParams();
    return <PortfolioListPage portfolioId={portfolioId} />;
  },
});

const portfolioTimelineRoute = createRoute({
  getParentRoute: () => portfolioDetailRoute,
  path: '/timeline',
  component: function PortfolioTimelineRoute() {
    const { portfolioId } = portfolioDetailRoute.useParams();
    return <PortfolioTimelinePage portfolioId={portfolioId} />;
  },
});

/** Portfolio tabs whose implementation lands in a later milestone. */
const portfolioPlaceholderRoutes = [
  {
    segment: 'dashboard',
    title: 'Dashboard',
    icon: LayoutDashboard,
    plannedFor: 'Completion, status breakdown and throughput across member projects.',
  },
  {
    segment: 'progress',
    title: 'Progress',
    icon: TrendingUp,
    plannedFor: 'A history of status updates for this portfolio.',
  },
  {
    segment: 'workload',
    title: 'Workload',
    icon: Gauge,
    plannedFor: 'Task load per person across the member projects.',
  },
  {
    segment: 'messages',
    title: 'Messages',
    icon: MessageSquare,
    plannedFor: 'Conversations that span more than one project.',
  },
].map((tab) =>
  createRoute({
    getParentRoute: () => portfolioDetailRoute,
    path: `/${tab.segment}`,
    // The portfolio shell's outlet area manages no scrolling of its own, so
    // each tab brings its own — same contract the List tab follows.
    component: () => (
      <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
        <PlaceholderPage
          title={tab.title}
          description="Not built yet."
          icon={tab.icon}
          plannedFor={tab.plannedFor}
        />
      </div>
    ),
  }),
);

const myTasksRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/my-tasks',
  component: MyTasksPage,
  // Notifications link here with `?task=`, so the entry opens the thing it is
  // about rather than dropping the reader on a list to find it themselves —
  // and with `&comment=` when it is about one comment, which the thread then
  // scrolls to.
  validateSearch: (search: Record<string, unknown>): { task?: string; comment?: string } => {
    const task = search['task'];
    if (typeof task !== 'string' || !UUID_PATTERN.test(task)) return {};
    return { task, ...commentSearch(search) };
  },
});

/** `?comment=<uuid>`, only ever beside the item it belongs to. */
function commentSearch(search: Record<string, unknown>): { comment?: string } {
  const comment = search['comment'];
  return typeof comment === 'string' && UUID_PATTERN.test(comment) ? { comment } : {};
}

const ticketsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/tickets',
  component: TicketsPage,
  // Same as My Tasks, but keyed by the human ticket key — that is what appears
  // in the notification and what somebody would paste to a colleague.
  validateSearch: (search: Record<string, unknown>): { ticket?: string; comment?: string } => {
    const ticket = search['ticket'];
    if (typeof ticket !== 'string' || !/^[A-Z]{2,8}-\d+$/i.test(ticket)) return {};
    return { ticket, ...commentSearch(search) };
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
 * Integrations is a shell with tabs, like a project: the shell owns the header
 * and the admin gate, the tabs are routes so a URL names one of them.
 */
const integrationsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/integrations',
  component: IntegrationsPage,
});

/** Bare `/integrations` opens the first tab. */
const integrationsIndexRoute = createRoute({
  getParentRoute: () => integrationsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/integrations/api-keys' });
  },
});

const integrationsApiKeysRoute = createRoute({
  getParentRoute: () => integrationsRoute,
  path: '/api-keys',
  component: ApiKeysPage,
});

const integrationsWebhooksRoute = createRoute({
  getParentRoute: () => integrationsRoute,
  path: '/webhooks',
  component: WebhooksPage,
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
/**
 * `?task=` names the work item open in the List/Board side panel;
 * `?customize=true` opens the Customize panel. Declared on the parent route so
 * every project view shares one schema and the tab links can carry both across
 * List↔Board.
 *
 * Never both at once: the two panels share the right edge of the window, and a
 * task link is the more specific intent — so in a hand-built URL naming both,
 * the task wins and `customize` is dropped.
 */
export function validateProjectDetailSearch(search: Record<string, unknown>): {
  task?: string;
  comment?: string;
  customize?: boolean;
  view?: string;
  section?: string;
} {
  const task = search['task'];
  const validTask = typeof task === 'string' && UUID_PATTERN.test(task) ? task : undefined;
  const customize = search['customize'] === true || search['customize'] === 'true';
  // Which saved view is open — a personal view lands here after "Save as my
  // view", and the link keeps it. Independent of the panel and the drawer.
  const view = search['view'];
  const validView = typeof view === 'string' && UUID_PATTERN.test(view) ? view : undefined;
  // The selected section. Clicking a header puts its id here so it can be read
  // off the address bar the way a task's can — what an n8n flow needs to file
  // work into it — and a link carrying it lands on that section.
  const section = search['section'];
  const validSection =
    typeof section === 'string' && UUID_PATTERN.test(section) ? section : undefined;
  return {
    ...(validTask ? { task: validTask, ...commentSearch(search) } : {}),
    ...(customize && !validTask ? { customize: true } : {}),
    ...(validView ? { view: validView } : {}),
    ...(validSection ? { section: validSection } : {}),
  };
}

const projectDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/projects/$projectId',
  validateSearch: validateProjectDetailSearch,
  // Params are read from the route object rather than by route-id string, so
  // the page stays a plain prop-driven component and cannot address a route
  // path that does not exist.
  component: function ProjectDetailRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectDetailPage projectId={projectId} />;
  },
});

/**
 * Bare `/projects/:id` sends the reader to the list, as Asana does.
 *
 * A redirect rather than rendering the list here, so there is one canonical
 * URL per view and an existing bookmark still lands somewhere real.
 */
const projectIndexRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/projects/$projectId/list',
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
 * A rule that does not exist yet.
 *
 * Declared before the `$ruleId` route below so the literal wins the match —
 * rule ids are uuids, so nothing real can collide with it.
 *
 * `?sectionId=` is what makes this different from an empty canvas: it arrives
 * from a section's lightning menu and the builder opens with "when a task moves
 * here" already answered, because the click said so. `?starter=` is the other
 * way in — a starter chosen in the rule library, which the builder opens
 * already shaped, with its blanks left to fill.
 */
const projectAutomationNewRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/automations/new',
  validateSearch: (search: Record<string, unknown>): { sectionId?: string; starter?: string } => ({
    ...(typeof search['sectionId'] === 'string' && UUID_PATTERN.test(search['sectionId'])
      ? { sectionId: search['sectionId'] }
      : {}),
    // Only the shape is checked here; the builder opens blank on a key it does
    // not know, so an old link cannot break the page.
    ...(typeof search['starter'] === 'string' && /^[a-z0-9-]{1,40}$/.test(search['starter'])
      ? { starter: search['starter'] }
      : {}),
  }),
  component: function AutomationNewRoute() {
    const { projectId } = projectAutomationNewRoute.useParams();
    const { sectionId, starter } = projectAutomationNewRoute.useSearch();

    /*
     * Keyed on what shapes the canvas. A starter chosen from inside the
     * builder changes only the search, and a page that kept its state would
     * keep drawing the rule it opened with rather than the one just picked.
     */
    return (
      <AutomationBuilderDialog
        key={`${starter ?? ''}:${sectionId ?? ''}`}
        projectId={projectId}
        ruleId={null}
        {...(sectionId ? { sectionId } : {})}
        {...(starter ? { starter } : {})}
      />
    );
  },
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

    return <AutomationBuilderDialog projectId={projectId} ruleId={ruleId} />;
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

const calendarRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/calendar',
  component: CalendarPage,
});

const reportsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/reports',
  component: ReportsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/settings',
  component: SettingsPage,
});

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
      projectAutomationNewRoute,
      projectAutomationBuilderRoute,
      ...projectPlaceholderRoutes,
    ]),
    portfoliosRoute,
    portfolioDetailRoute.addChildren([
      portfolioIndexRoute,
      portfolioListRoute,
      portfolioTimelineRoute,
      ...portfolioPlaceholderRoutes,
    ]),
    myTasksRoute,
    ticketsRoute,
    inboxRoute,
    membersRoute,
    teamsRoute,
    integrationsRoute.addChildren([
      integrationsIndexRoute,
      integrationsApiKeysRoute,
      integrationsWebhooksRoute,
    ]),
    calendarRoute,
    reportsRoute,
    settingsRoute,
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
