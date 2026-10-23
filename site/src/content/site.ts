/*
 * Every word the page says, in one place, so copy changes never mean hunting
 * through components — and so the FAQ's structured data cannot drift from the
 * questions on the page.
 *
 * Claims here are things CoreTask does today (see the README's Project status).
 * There are no customers, numbers or quotes yet, so the page invents none.
 */

// Placeholders until the domain is chosen. Canonical URLs, the sitemap, share
// cards and the early-access button all read these; set both at build time.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://coretask.example';
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@coretask.example';

export const site = {
  name: 'CoreTask',
  url: SITE_URL.replace(/\/$/, ''),
  contactEmail: CONTACT_EMAIL,
  earlyAccessHref: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('CoreTask early access')}`,
  title: 'CoreTask — Project Management & Ticketing Software for Teams',
  description:
    'Project management and ticketing software in one workspace. Turn emails, Slack messages and forms into tracked work, plan it in any view, and automate the rest.',
  ogImageAlt: 'CoreTask — where every request becomes finished work.',
} as const;

export const nav = [
  { label: 'Capture', href: '#capture' },
  { label: 'Plan', href: '#plan' },
  { label: 'Automate', href: '#automate' },
  { label: 'Integrations', href: '#integrations' },
  { label: 'Security', href: '#security' },
  { label: 'FAQ', href: '#faq' },
] as const;

export const hero = {
  eyebrow: 'Project management & ticketing software',
  title: 'Where every request becomes finished work.',
  // The word the headline paints green.
  accent: 'finished',
  lede: 'CoreTask brings your projects and tickets into one workspace. Capture requests from email, Slack and forms, plan them in any view, and let rules — and AI — handle the busywork.',
  primary: 'Request early access',
  secondary: 'See how it works',
  note: 'Now in early access',
} as const;

export const problem = {
  eyebrow: 'The problem',
  title: 'Your team’s work lives in five places. None of them talk to each other.',
  lede: 'Requests arrive by email. Updates hide in chat threads. The plan sits in a spreadsheet, and the IT queue is somewhere else again. Every hand-off is a chance for something to slip.',
  resolve: 'CoreTask gives all of it one home.',
} as const;

export const capture = {
  eyebrow: '01 · Capture',
  title: 'Turn emails, Slack messages and form submissions into tracked tickets.',
  lede: 'Every request lands in one queue with its own key, so nothing goes missing between the inbox and the people doing the work.',
  points: [
    {
      title: 'Email to project',
      body: 'Each project has its own address. Mail becomes a task, and replies stay on the thread.',
    },
    {
      title: 'Slack, both ways',
      body: 'Use /coretask or a message shortcut to make a task without leaving the conversation.',
    },
    {
      title: 'Intake forms',
      body: 'Share a public form. Anyone can fill it in, no account needed, and each response becomes a task.',
    },
    {
      title: 'A real ticket queue',
      body: 'Keys like CORE-1042, triage from the ticket itself, and filters by person, status, type and priority.',
    },
  ],
} as const;

export const plan = {
  eyebrow: '02 · Plan',
  title: 'One project, four views: List, Board, Timeline and Calendar.',
  lede: 'Switch views without rebuilding anything. It is the same work, seen the way you need it today.',
  views: ['List', 'Board', 'Timeline', 'Calendar'] as const,
  points: [
    { title: '11 custom field types', body: 'Including ratings, currency and formulas.' },
    { title: 'Saved views', body: 'Filters, sorts and grouping, shared or just yours.' },
    {
      title: 'Dependencies & milestones',
      body: 'Blocked-by links, approvals and repeating tasks.',
    },
    { title: 'Keyboard first', body: 'Shortcuts for everything you do every day.' },
  ],
} as const;

export const automate = {
  eyebrow: '03 · Automate',
  title: 'Automate the busywork with rules — and AI that knows your project.',
  lede: 'Build rules visually. When a ticket arrives, check it, triage it, assign it and tell the right people — without anyone lifting a finger.',
  points: [
    {
      title: 'Triggers for real life',
      body: 'A ticket is reported, a status changes, a due date nears, a file is added — or run it on a schedule.',
    },
    {
      title: 'AI steps',
      body: '“Check with AI” lets a yes-or-no question choose the path. “Use AI” fills in fields from your project’s own options.',
    },
    {
      title: 'Rules that wait',
      body: 'Pause for minutes, hours or days, then carry on with the task as it is by then.',
    },
    {
      title: 'Loop protection',
      body: 'Rules that trigger each other stop safely instead of running forever.',
    },
  ],
} as const;

export const collaborate = {
  eyebrow: '04 · Collaborate',
  title: 'Real-time comments, mentions and approvals, right on the task.',
  lede: 'Conversations stay attached to the work. Mention a teammate, attach a screenshot, ask for an approval — and everyone sees the change the moment it happens.',
  points: [
    { title: '@mentions that notify', body: 'The right person hears about it, in their inbox.' },
    { title: 'Approvals', body: 'Approve, request changes or reject, with the reason on record.' },
    { title: 'Every change, on the record', body: 'Each task keeps its full history.' },
    { title: 'Live everywhere', body: 'Boards, lists and comments update without a refresh.' },
  ],
} as const;

export const track = {
  eyebrow: '05 · Track',
  title: 'See progress at every level: goals, portfolios and team workload.',
  lede: 'Connect projects to goals, roll projects up into portfolios, and spot who has too much on their plate before a deadline slips.',
  points: [
    {
      title: 'Goals that roll up',
      body: 'Progress from sub-goals, projects or a number you track.',
    },
    { title: 'Portfolios', body: 'Every project’s status and progress on one page.' },
    { title: 'Workload', body: 'Each person’s load against their capacity, by week.' },
    { title: 'Report dashboards', body: 'Shared charts that respect what each viewer can see.' },
  ],
} as const;

export const connect = {
  eyebrow: '06 · Connect',
  title: 'Works with Slack, Microsoft Teams, Google Chat, email and your calendar.',
  lede: 'Post project updates where your team already talks, sync due dates to any calendar, and build your own integrations with the REST API, webhooks and OAuth apps. Moving from Asana? Bring your projects with you.',
  apps: [
    'Slack',
    'Microsoft Teams',
    'Google Chat',
    'Discord',
    'Email',
    'Calendar feeds',
    'REST API',
    'Webhooks',
    'OAuth apps',
    'Asana import',
    'CSV export',
  ],
} as const;

export const security = {
  eyebrow: '07 · Trust',
  title: 'Secure by design: private projects, rotating sessions and a full audit trail.',
  lede: 'CoreTask is built the careful way from the first line — so your team’s work stays with your team.',
  items: [
    {
      title: 'Private when it matters',
      body: 'A private project is visible only to its members, and search keeps it that way.',
    },
    {
      title: 'Sessions that rotate',
      body: 'Short-lived access tokens and refresh tokens that rotate on every use, with replay detection.',
    },
    {
      title: 'Strong password hashing',
      body: 'Passwords are hashed with Argon2id, the current industry recommendation.',
    },
    {
      title: 'Roles with real limits',
      body: 'Every action is checked against the person’s workspace role, and API keys can never act as an owner or admin.',
    },
    {
      title: 'A complete activity trail',
      body: 'Every change to a task or ticket is recorded: who, what and when.',
    },
    {
      title: 'Signed webhooks',
      body: 'Every webhook carries an HMAC signature, so your systems can trust what arrives.',
    },
  ],
} as const;

export const faq = {
  eyebrow: 'FAQ',
  title: 'Questions, answered.',
  items: [
    {
      q: 'What is CoreTask?',
      a: 'CoreTask is project management and ticketing software for teams. It puts projects, tasks and a ticket queue in one workspace, with List, Board, Timeline and Calendar views, automation rules, goals, portfolios and integrations.',
    },
    {
      q: 'Can I manage tickets and projects in the same tool?',
      a: 'Yes. Requests from email, Slack and intake forms arrive as tickets with their own keys, and they live beside your project work — the same people, views, rules and reports apply to both.',
    },
    {
      q: 'Is CoreTask an Asana alternative?',
      a: 'Yes. CoreTask covers the way teams already work in tools like Asana — lists, boards, timelines, custom fields, rules, goals and portfolios — and adds a built-in ticket queue. You can import existing Asana projects or CSV files.',
    },
    {
      q: 'Does CoreTask integrate with Slack and Microsoft Teams?',
      a: 'Yes. Slack works both ways: create tasks with /coretask or a message shortcut, and complete or take tasks from the buttons on CoreTask’s posts. Project updates can also go to Microsoft Teams, Google Chat and Discord.',
    },
    {
      q: 'How does CoreTask use AI?',
      a: 'AI is an optional step inside automation rules. “Check with AI” answers a yes-or-no question to choose a path, and “Use AI” makes the changes its instructions call for, using only the options you allow. Rules work without it.',
    },
    {
      q: 'How is my data kept secure?',
      a: 'Passwords are hashed with Argon2id, sessions use rotating refresh tokens with replay detection, private projects are visible only to their members, and every change is recorded in an activity trail.',
    },
    {
      q: 'How do I get access?',
      a: 'CoreTask is in early access. Request access and we will be in touch to set up your workspace.',
    },
  ],
} as const;

export const finalCta = {
  title: 'Bring your team’s work into one place.',
  lede: 'CoreTask is in early access. Tell us about your team and we’ll help you set up your first workspace.',
  primary: 'Request early access',
} as const;
