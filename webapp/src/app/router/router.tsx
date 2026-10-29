import type { AutomationDraft } from '@coretask/types';
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useLocation,
} from '@tanstack/react-router';

import { AppLayout } from '@/app/layouts/app-layout';
import { AuthLayout } from '@/app/layouts/auth-layout';
import { RootLayout } from '@/app/layouts/root-layout';
import { ForgotPasswordPage } from '@/features/auth/pages/forgot-password-page';
import { LoginPage } from '@/features/auth/pages/login-page';
import { RegisterPage } from '@/features/auth/pages/register-page';
import { ResetPasswordPage } from '@/features/auth/pages/reset-password-page';
import { SsoCompletePage } from '@/features/auth/pages/sso-complete-page';
import { SsoPage } from '@/features/auth/pages/sso-page';
import { ConfirmEmailChangePage } from '@/features/auth/pages/confirm-email-change-page';
import { VerifyEmailPage } from '@/features/auth/pages/verify-email-page';
import { CalendarPage } from '@/features/calendar/pages/calendar-page';
import { GoalsPage } from '@/features/goals/pages/goals-page';
import { DashboardPage } from '@/features/dashboard/pages/dashboard-page';
import { InboxPage } from '@/features/inbox/pages/inbox-page';
import { ApiKeysPage } from '@/features/integrations/pages/api-keys-page';
import { AppDirectoryPage } from '@/features/integrations/pages/app-directory-page';
import { ConnectedAppsPage } from '@/features/integrations/pages/connected-apps-page';
import {
  IntegrationsIndex,
  IntegrationsPage,
} from '@/features/integrations/pages/integrations-page';
import { OAuthAppsPage } from '@/features/integrations/pages/oauth-apps-page';
import { OAuthConsentPage } from '@/features/integrations/pages/oauth-consent-page';
import { PlaygroundPage } from '@/features/integrations/pages/playground-page';
import { AsanaPage } from '@/features/integrations/pages/asana-page';
import { SlackPage } from '@/features/integrations/pages/slack-page';
import { SlackCallbackPage, SlackLinkPage } from '@/features/integrations/pages/slack-return-pages';
import { WebhooksPage } from '@/features/integrations/pages/webhooks-page';
import { AcceptInvitationPage } from '@/features/members/pages/accept-invitation-page';
import { MembersPage } from '@/features/members/pages/members-page';
import { AutomationsPage } from '@/features/automations/pages/automations-page';
import { AutomationBuilderDialog } from '@/features/automations/builder/components/automation-builder-dialog';
import { AddAutomationDialog } from '@/features/automations/components/add-automation-dialog';
import { readDraft } from '@/features/automations/lib/drafted-rule';
import { ProjectBoardPage } from '@/features/projects/pages/project-board-page';
import { ProjectActivityPage } from '@/features/projects/pages/project-activity-page';
import { ProjectFilesPage } from '@/features/projects/pages/project-files-page';
import { ProjectMessagesPage } from '@/features/projects/pages/project-messages-page';
import { ProjectCalendarPage } from '@/features/projects/pages/project-calendar-page';
import { ProjectDashboardPage } from '@/features/projects/pages/project-dashboard-page';
import { ProjectTimelinePage } from '@/features/projects/pages/project-timeline-page';
import { ProjectDetailPage } from '@/features/projects/pages/project-detail-page';
import { ProjectListPage } from '@/features/projects/pages/project-list-page';
import { ProjectOverviewPage } from '@/features/projects/pages/project-overview-page';
import { ProjectsPage } from '@/features/projects/pages/projects-page';
import { PublicFormPage } from '@/features/projects/pages/public-form-page';
import { PortfolioDashboardPage } from '@/features/portfolios/pages/portfolio-dashboard-page';
import { PortfolioDetailPage } from '@/features/portfolios/pages/portfolio-detail-page';
import { PortfolioListPage } from '@/features/portfolios/pages/portfolio-list-page';
import { PortfolioMessagesPage } from '@/features/portfolios/pages/portfolio-messages-page';
import { PortfolioProgressPage } from '@/features/portfolios/pages/portfolio-progress-page';
import { PortfolioTimelinePage } from '@/features/portfolios/pages/portfolio-timeline-page';
import { PortfolioWorkloadPage } from '@/features/portfolios/pages/portfolio-workload-page';
import { PortfoliosPage } from '@/features/portfolios/pages/portfolios-page';
import { ProjectNotePage } from '@/features/projects/pages/project-note-page';
import { ProjectSettingsPage } from '@/features/projects/pages/project-settings-page';
import { ProjectWorkloadPage } from '@/features/projects/pages/project-workload-page';
import { ReportsPage } from '@/features/reports/pages/reports-page';
import { validateSearchParams } from '@/features/search/lib/search-url';
import { AdvancedSearchPage } from '@/features/search/pages/advanced-search-page';
import { SettingsPage } from '@/features/settings/pages/settings-page';
import { MyTasksPage } from '@/features/tasks/pages/my-tasks-page';
import { TeamDetailPage } from '@/features/teams/pages/team-detail-page';
import { TeamsPage } from '@/features/teams/pages/teams-page';
import { TicketsPage } from '@/features/tickets/pages/tickets-page';
import { WorkspaceLinkPage } from '@/features/workspaces/pages/workspace-link-page';
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

/** An error code single sign-on sent the browser back with; the page says what it means. */
const validateErrorCode = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Z_]{1,64}$/.test(value) ? value : undefined;

const loginRoute = createRoute({
  getParentRoute: () => guestRoute,
  path: '/login',
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string; ssoError?: string } => {
    const ssoError = validateErrorCode(search['ssoError']);
    return { ...validateRedirect(search), ...(ssoError ? { ssoError } : {}) };
  },
});

/** "Sign in with SSO": a workspace's own identity provider, found by work address or workspace. */
const ssoRoute = createRoute({
  getParentRoute: () => guestRoute,
  path: '/sso',
  component: SsoPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string; error?: string } => {
    const error = validateErrorCode(search['error']);
    return { ...validateRedirect(search), ...(error ? { error } : {}) };
  },
});

/**
 * Where single sign-on comes back to. Off the root, behind neither gate: the
 * person is not signed in until the page has finished — see `SsoCompletePage`.
 */
const ssoCompleteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sso/complete',
  component: SsoCompletePage,
  validateSearch: validateRedirect,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => guestRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
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

/** A workspace's own address, `/w/<slug>`: switches to it and opens its Home. */
const workspaceLinkRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/w/$slug',
  component: function WorkspaceLinkRoute() {
    const { slug } = workspaceLinkRoute.useParams();
    return <WorkspaceLinkPage slug={slug} />;
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
 * shell above. The page guards against an id the workspace does not hold
 * rather than trusting the URL.
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

const portfolioDashboardRoute = createRoute({
  getParentRoute: () => portfolioDetailRoute,
  path: '/dashboard',
  component: function PortfolioDashboardRoute() {
    const { portfolioId } = portfolioDetailRoute.useParams();
    return <PortfolioDashboardPage portfolioId={portfolioId} />;
  },
});

const portfolioProgressRoute = createRoute({
  getParentRoute: () => portfolioDetailRoute,
  path: '/progress',
  component: function PortfolioProgressRoute() {
    const { portfolioId } = portfolioDetailRoute.useParams();
    return <PortfolioProgressPage portfolioId={portfolioId} />;
  },
});

const portfolioWorkloadRoute = createRoute({
  getParentRoute: () => portfolioDetailRoute,
  path: '/workload',
  component: function PortfolioWorkloadRoute() {
    const { portfolioId } = portfolioDetailRoute.useParams();
    return <PortfolioWorkloadPage portfolioId={portfolioId} />;
  },
});

const portfolioMessagesRoute = createRoute({
  getParentRoute: () => portfolioDetailRoute,
  path: '/messages',
  component: function PortfolioMessagesRoute() {
    const { portfolioId } = portfolioDetailRoute.useParams();
    return <PortfolioMessagesPage portfolioId={portfolioId} />;
  },
});

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

const teamDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/teams/$teamId',
  // `?tab=messages` opens the conversations; anything else is the overview.
  validateSearch: (search: Record<string, unknown>): { tab?: 'messages' } =>
    search['tab'] === 'messages' ? { tab: 'messages' } : {},
  component: function TeamDetailRoute() {
    const { teamId } = teamDetailRoute.useParams();
    const { tab } = teamDetailRoute.useSearch();
    return <TeamDetailPage teamId={teamId} tab={tab ?? 'overview'} />;
  },
});

/**
 * Integrations is a shell with tabs, like a project: the shell owns the header
 * and the admin gate for the workspace's tabs, the tabs are routes so a URL
 * names one of them. OAuth apps and Connected apps are a person's own, and the
 * App directory is every member's to read, so those three are open to everyone.
 */
const integrationsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/integrations',
  component: IntegrationsPage,
});

/** Bare `/integrations` opens the first tab this person may use. */
const integrationsIndexRoute = createRoute({
  getParentRoute: () => integrationsRoute,
  path: '/',
  component: IntegrationsIndex,
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

const integrationsPlaygroundRoute = createRoute({
  getParentRoute: () => integrationsRoute,
  path: '/playground',
  component: PlaygroundPage,
});

const integrationsAppDirectoryRoute = createRoute({
  getParentRoute: () => integrationsRoute,
  path: '/app-directory',
  component: AppDirectoryPage,
});

const integrationsOAuthAppsRoute = createRoute({
  getParentRoute: () => integrationsRoute,
  path: '/oauth-apps',
  component: OAuthAppsPage,
});

const integrationsConnectedAppsRoute = createRoute({
  getParentRoute: () => integrationsRoute,
  path: '/connected-apps',
  component: ConnectedAppsPage,
});

const integrationsSlackRoute = createRoute({
  getParentRoute: () => integrationsRoute,
  path: '/slack',
  component: SlackPage,
});

const integrationsAsanaRoute = createRoute({
  getParentRoute: () => integrationsRoute,
  path: '/asana',
  component: AsanaPage,
});

/**
 * Where a reset link lands. Off the root rather than the guest gate: someone
 * still signed in on this device may be the one who forgot, and the guest gate
 * would bounce them to the dashboard instead.
 */
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
});

/** The gate the pages outside the app's shell share: signed in, or off to sign in and back. */
const requireSignIn = ({ location }: { location: { href: string } }) => {
  if (useAuthStore.getState().status !== 'authenticated') {
    throw redirect({ to: '/login', search: { redirect: location.href } });
  }
};

/**
 * Where Slack sends an admin back after they allow the app, and where a
 * "Link your account" button in Slack lands. Signed in and outside the shell,
 * like the OAuth consent page: each is one step and nothing else.
 */
const slackCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/integrations/slack/callback',
  component: SlackCallbackPage,
  beforeLoad: requireSignIn,
});

const slackLinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/integrations/slack/link',
  component: SlackLinkPage,
  beforeLoad: requireSignIn,
});

/**
 * Where a confirmation link lands. Off the root too: it works signed in or
 * not, since the link may be opened on another device.
 */
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify-email',
  component: VerifyEmailPage,
});

/** Where the link sent to a new address lands; off the root for the same reason. */
const confirmEmailChangeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/confirm-email-change',
  component: ConfirmEmailChangePage,
});

/**
 * Where a tool sends a person to ask for access. Signed in, like the app, but
 * outside its shell: the page is a single decision and nothing else.
 */
const oauthAuthorizeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/oauth/authorize',
  component: OAuthConsentPage,
  beforeLoad: ({ location }) => {
    if (useAuthStore.getState().status !== 'authenticated') {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
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
 * A form, filled in by link. Off the root for the same reason the invitation
 * is: whoever submits it rarely has an account, and one who does should not be
 * bounced away from it.
 */
const publicFormRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forms/$token',
  component: function PublicFormRoute() {
    const { token } = publicFormRoute.useParams();
    return <PublicFormPage token={token} />;
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

const projectTimelineRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/timeline',
  component: function ProjectTimelineRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectTimelinePage projectId={projectId} />;
  },
});

const projectDashboardRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/dashboard',
  component: function ProjectDashboardRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectDashboardPage projectId={projectId} />;
  },
});

const projectCalendarRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/calendar',
  component: function ProjectCalendarRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectCalendarPage projectId={projectId} />;
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
  validateSearch: (
    search: Record<string, unknown>,
  ): { sectionId?: string; fieldId?: string; starter?: string } => ({
    ...(typeof search['sectionId'] === 'string' && UUID_PATTERN.test(search['sectionId'])
      ? { sectionId: search['sectionId'] }
      : {}),
    // From a field column's "Add automation to field": "when it changes".
    ...(typeof search['fieldId'] === 'string' && UUID_PATTERN.test(search['fieldId'])
      ? { fieldId: search['fieldId'] }
      : {}),
    // Only the shape is checked here; the builder opens blank on a key it does
    // not know, so an old link cannot break the page.
    ...(typeof search['starter'] === 'string' && /^[a-z0-9-]{1,40}$/.test(search['starter'])
      ? { starter: search['starter'] }
      : {}),
  }),
  component: function AutomationNewRoute() {
    const { projectId } = projectAutomationNewRoute.useParams();
    const { sectionId, fieldId, starter } = projectAutomationNewRoute.useSearch();
    // A rule drafted from a sentence on the Add automation page, which rides
    // in the history entry rather than the address — see `drafted-rule.ts`.
    const drafted = useLocation({
      select: (location) => readDraft(location.state.automationDraft),
    });

    /*
     * Keyed on what shapes the canvas. A starter chosen from inside the
     * builder changes only the search, and a page that kept its state would
     * keep drawing the rule it opened with rather than the one just picked.
     */
    return (
      <AutomationBuilderDialog
        key={`${starter ?? ''}:${sectionId ?? ''}:${fieldId ?? ''}:${drafted ? 'drafted' : ''}`}
        projectId={projectId}
        ruleId={null}
        {...(sectionId ? { sectionId } : {})}
        {...(fieldId ? { fieldId } : {})}
        {...(starter ? { starter } : {})}
        {...(drafted ? { drafted } : {})}
      />
    );
  },
});

/**
 * Adding a rule: the prompt, Start from scratch and the gallery, as Asana's
 * "Add automation" page. A static segment, so it wins over `$ruleId`.
 */
const projectAutomationAddRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/automations/add',
  component: function AutomationAddRoute() {
    const { projectId } = projectAutomationAddRoute.useParams();
    return <AddAutomationDialog projectId={projectId} />;
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

const projectActivityRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/activity',
  component: function ProjectActivityRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectActivityPage projectId={projectId} />;
  },
});

const projectMessagesRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/messages',
  component: function ProjectMessagesRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectMessagesPage projectId={projectId} />;
  },
});

const projectFilesRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/files',
  component: function ProjectFilesRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectFilesPage projectId={projectId} />;
  },
});

const projectNoteRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/note',
  component: function ProjectNoteRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectNotePage projectId={projectId} />;
  },
});

const projectWorkloadRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/workload',
  component: function ProjectWorkloadRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectWorkloadPage projectId={projectId} />;
  },
});

const projectSettingsRoute = createRoute({
  getParentRoute: () => projectDetailRoute,
  path: '/settings',
  component: function ProjectSettingsRoute() {
    const { projectId } = projectDetailRoute.useParams();
    return <ProjectSettingsPage projectId={projectId} />;
  },
});

const goalsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/goals',
  // `?goal=` opens one goal's sheet; notifications about a goal link there.
  validateSearch: (search: Record<string, unknown>): { goal?: string } => {
    const goal = search['goal'];
    return typeof goal === 'string' && UUID_PATTERN.test(goal) ? { goal } : {};
  },
  component: function GoalsRoute() {
    const { goal } = goalsRoute.useSearch();
    return <GoalsPage goalId={goal ?? null} />;
  },
});

const calendarRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/calendar',
  component: CalendarPage,
});

const reportsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/reports',
  // `?dashboard=` names the open dashboard; anything else is the overview.
  validateSearch: (search: Record<string, unknown>): { dashboard?: string } => {
    const dashboard = search['dashboard'];
    return typeof dashboard === 'string' && UUID_PATTERN.test(dashboard) ? { dashboard } : {};
  },
  component: function ReportsRoute() {
    const { dashboard } = reportsRoute.useSearch();
    return <ReportsPage dashboardId={dashboard} />;
  },
});

const searchRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/search',
  // The whole search lives here, so a search is a link; see search-url.ts.
  validateSearch: validateSearchParams,
  component: function SearchRoute() {
    const params = searchRoute.useSearch();
    return <AdvancedSearchPage params={params} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  guestRoute.addChildren([loginRoute, registerRoute, forgotPasswordRoute, ssoRoute]),
  resetPasswordRoute,
  verifyEmailRoute,
  ssoCompleteRoute,
  confirmEmailChangeRoute,
  acceptInvitationRoute,
  publicFormRoute,
  oauthAuthorizeRoute,
  slackCallbackRoute,
  slackLinkRoute,
  protectedRoute.addChildren([
    dashboardRoute,
    workspaceLinkRoute,
    projectsRoute,
    projectDetailRoute.addChildren([
      projectIndexRoute,
      projectOverviewRoute,
      projectListRoute,
      projectBoardRoute,
      projectTimelineRoute,
      projectCalendarRoute,
      projectDashboardRoute,
      projectActivityRoute,
      projectMessagesRoute,
      projectFilesRoute,
      projectAutomationsRoute,
      projectAutomationAddRoute,
      projectAutomationNewRoute,
      projectAutomationBuilderRoute,
      projectNoteRoute,
      projectWorkloadRoute,
      projectSettingsRoute,
    ]),
    portfoliosRoute,
    portfolioDetailRoute.addChildren([
      portfolioIndexRoute,
      portfolioListRoute,
      portfolioTimelineRoute,
      portfolioDashboardRoute,
      portfolioProgressRoute,
      portfolioWorkloadRoute,
      portfolioMessagesRoute,
    ]),
    myTasksRoute,
    ticketsRoute,
    inboxRoute,
    membersRoute,
    teamsRoute,
    teamDetailRoute,
    integrationsRoute.addChildren([
      integrationsIndexRoute,
      integrationsApiKeysRoute,
      integrationsWebhooksRoute,
      integrationsPlaygroundRoute,
      integrationsAppDirectoryRoute,
      integrationsOAuthAppsRoute,
      integrationsConnectedAppsRoute,
      integrationsSlackRoute,
      integrationsAsanaRoute,
    ]),
    goalsRoute,
    calendarRoute,
    reportsRoute,
    searchRoute,
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

  interface HistoryState {
    /** A rule drafted on the Add automation page, for the new-rule builder to open. */
    automationDraft?: AutomationDraft;
  }
}
