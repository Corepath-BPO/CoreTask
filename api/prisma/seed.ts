/**
 * Development seed.
 *
 * Idempotent by design: every write is an upsert keyed on a natural key, so the
 * dev container can run this on every boot without duplicating anything.
 *
 *   pnpm db:seed          (from the repo root)
 *   pnpm --filter @coretask/api db:seed
 *
 * Refuses to run against NODE_ENV=production.
 */
import { formatMention, stripMentionTokens, TICKET_NUMBER_START } from '@coretask/contracts';
import { hash } from '@node-rs/argon2';
import {
  ActivityAction,
  ActivityEntity,
  NotificationType,
  PrismaClient,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  TicketPriority,
  TicketSeverity,
  TicketStatus,
  TicketType,
  WorkspaceRole,
} from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.SEED_USER_EMAIL ?? 'demo@coretask.dev';
const DEMO_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'CoreTask!2024';
const WORKSPACE_SLUG = 'coretask-demo';
const PROJECT_KEY = 'PLAT';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The development seed must never run against production.');
  }

  const passwordHash = await hash(DEMO_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  // ---------------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------------
  const owner = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { name: 'Demo Owner', passwordHash },
    create: {
      email: DEMO_EMAIL,
      name: 'Demo Owner',
      passwordHash,
      timezone: 'America/Chicago',
      emailVerifiedAt: new Date(),
    },
  });

  const teammates = await Promise.all(
    [
      { email: 'maya@coretask.dev', name: 'Maya Okafor', role: WorkspaceRole.ADMIN },
      { email: 'jonas@coretask.dev', name: 'Jonas Feld', role: WorkspaceRole.MEMBER },
      { email: 'priya@coretask.dev', name: 'Priya Raman', role: WorkspaceRole.MEMBER },
    ].map(async (person) => ({
      role: person.role,
      user: await prisma.user.upsert({
        where: { email: person.email },
        update: { name: person.name },
        create: {
          email: person.email,
          name: person.name,
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      }),
    })),
  );

  // ---------------------------------------------------------------------------
  // Workspace + membership
  // ---------------------------------------------------------------------------
  const workspace = await prisma.workspace.upsert({
    where: { slug: WORKSPACE_SLUG },
    update: { name: 'CoreTask Demo' },
    create: {
      name: 'CoreTask Demo',
      slug: WORKSPACE_SLUG,
      description: 'Sample workspace created by the development seed.',
      ticketPrefix: 'CORE',
      createdById: owner.id,
    },
  });

  await upsertMembership(workspace.id, owner.id, WorkspaceRole.OWNER);
  for (const teammate of teammates) {
    await upsertMembership(workspace.id, teammate.user.id, teammate.role, owner.id);
  }

  // ---------------------------------------------------------------------------
  // Teams
  // ---------------------------------------------------------------------------
  const [admin, engineer, supporter] = teammates.map((teammate) => teammate.user);

  const platformTeam = await upsertTeam(workspace.id, {
    name: 'Platform',
    description: 'Authentication, workspaces and the shared shell.',
    color: '#6366F1',
    leadId: admin?.id ?? owner.id,
    memberIds: [owner.id, admin?.id, engineer?.id],
  });

  await upsertTeam(workspace.id, {
    name: 'Support',
    description: 'Triages incoming tickets and keeps customers unblocked.',
    color: '#0EA5E9',
    leadId: supporter?.id ?? owner.id,
    memberIds: [supporter?.id],
  });

  // ---------------------------------------------------------------------------
  // Project + sections
  // ---------------------------------------------------------------------------
  const project = await prisma.project.upsert({
    where: { workspaceId_key: { workspaceId: workspace.id, key: PROJECT_KEY } },
    // `teamId` is re-applied on update so an existing demo database picks the
    // association up too, rather than only fresh installs showing it.
    update: { name: 'Platform Foundation', teamId: platformTeam.id },
    create: {
      workspaceId: workspace.id,
      name: 'Platform Foundation',
      key: PROJECT_KEY,
      description: 'Authentication, workspaces and the shared application shell.',
      status: ProjectStatus.ACTIVE,
      color: '#6366F1',
      leadId: owner.id,
      teamId: platformTeam.id,
      startDate: daysFromNow(-21),
      dueDate: daysFromNow(30),
    },
  });

  const sectionNames = ['Backlog', 'In Progress', 'In Review', 'Done'];
  const sections = [];

  for (const [index, name] of sectionNames.entries()) {
    sections.push(await upsertSection(workspace.id, project.id, name, index * 1000));
  }

  const [backlog, inProgress, inReview, done] = sections;
  if (!backlog || !inProgress || !inReview || !done) {
    throw new Error('Seed failed to create the default sections.');
  }

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------
  const taskSeeds = [
    {
      title: 'Design the workspace switcher',
      section: backlog,
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      assignee: teammates[0]?.user.id ?? owner.id,
      dueInDays: 6,
    },
    {
      title: 'Add refresh-token rotation to the auth service',
      section: done,
      status: TaskStatus.DONE,
      priority: TaskPriority.HIGH,
      assignee: owner.id,
      dueInDays: -3,
      completed: true,
    },
    {
      title: 'Wire the dashboard summary endpoints',
      section: inProgress,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
      assignee: owner.id,
      dueInDays: 2,
    },
    {
      title: 'Board view drag-and-drop with dnd-kit',
      section: inProgress,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.MEDIUM,
      assignee: teammates[1]?.user.id ?? owner.id,
      dueInDays: 9,
    },
    {
      title: 'Audit-log viewer for workspace admins',
      section: inReview,
      status: TaskStatus.IN_REVIEW,
      priority: TaskPriority.LOW,
      assignee: teammates[2]?.user.id ?? owner.id,
      dueInDays: 4,
    },
    {
      title: 'Document the Docker development workflow',
      section: backlog,
      status: TaskStatus.BACKLOG,
      priority: TaskPriority.LOW,
      assignee: null,
      dueInDays: 14,
    },
  ];

  const createdTasks = new Map<string, string>();

  for (const [index, seed] of taskSeeds.entries()) {
    const task = await upsertTask({
      workspaceId: workspace.id,
      projectId: project.id,
      sectionId: seed.section.id,
      title: seed.title,
      status: seed.status,
      priority: seed.priority,
      position: index * 1000,
      assigneeId: seed.assignee,
      createdById: owner.id,
      dueDate: daysFromNow(seed.dueInDays),
      completedAt: seed.completed ? daysFromNow(-2) : null,
    });

    createdTasks.set(seed.title, task.id);
  }

  // A couple of subtasks so the board shows a real progress rollup rather than
  // every card reading 0/0.
  const subtaskSeeds = [
    {
      parent: 'Wire the dashboard summary endpoints',
      title: 'Design the response shape',
      done: true,
    },
    { parent: 'Wire the dashboard summary endpoints', title: 'Add the rollup query', done: true },
    { parent: 'Wire the dashboard summary endpoints', title: 'Swap the fixtures out', done: false },
    { parent: 'Board view drag-and-drop with dnd-kit', title: 'Resolve drop targets', done: true },
    {
      parent: 'Board view drag-and-drop with dnd-kit',
      title: 'Optimistic reordering',
      done: false,
    },
  ];

  for (const [index, seed] of subtaskSeeds.entries()) {
    const parentId = createdTasks.get(seed.parent);
    if (!parentId) continue;

    await upsertTask({
      workspaceId: workspace.id,
      projectId: project.id,
      sectionId: null,
      parentTaskId: parentId,
      title: seed.title,
      status: seed.done ? TaskStatus.DONE : TaskStatus.TODO,
      priority: TaskPriority.NONE,
      position: index * 1000,
      assigneeId: owner.id,
      createdById: owner.id,
      dueDate: daysFromNow(3 + index),
      completedAt: seed.done ? daysFromNow(-1) : null,
    });
  }

  // ---------------------------------------------------------------------------
  // Tickets — keys come from the workspace counter, e.g. CORE-1001
  // ---------------------------------------------------------------------------
  const ticketSeeds = [
    {
      title: 'Login fails with a 500 when the e-mail contains a plus sign',
      type: TicketType.BUG,
      status: TicketStatus.TRIAGED,
      priority: TicketPriority.HIGH,
      severity: TicketSeverity.MAJOR,
      assignee: owner.id,
    },
    {
      title: 'Add keyboard shortcuts for creating a task',
      type: TicketType.FEATURE,
      status: TicketStatus.OPEN,
      priority: TicketPriority.MEDIUM,
      severity: TicketSeverity.MINOR,
      assignee: null,
    },
    {
      title: 'Attachment upload times out on files above 10 MB',
      type: TicketType.BUG,
      status: TicketStatus.IN_PROGRESS,
      priority: TicketPriority.URGENT,
      severity: TicketSeverity.CRITICAL,
      assignee: teammates[0]?.user.id ?? owner.id,
    },
    {
      title: 'How do I move a project between workspaces?',
      type: TicketType.QUESTION,
      status: TicketStatus.RESOLVED,
      priority: TicketPriority.LOW,
      severity: TicketSeverity.MINOR,
      assignee: teammates[1]?.user.id ?? owner.id,
      resolved: true,
    },
    {
      title: 'Scheduled maintenance: PostgreSQL 17 upgrade',
      type: TicketType.MAINTENANCE,
      status: TicketStatus.OPEN,
      priority: TicketPriority.LOW,
      severity: TicketSeverity.MINOR,
      assignee: owner.id,
    },
  ];

  for (const [index, seed] of ticketSeeds.entries()) {
    const number = 1001 + index;

    await prisma.ticket.upsert({
      where: { workspaceId_number: { workspaceId: workspace.id, number } },
      update: { title: seed.title, status: seed.status },
      create: {
        workspaceId: workspace.id,
        projectId: project.id,
        number,
        key: `${workspace.ticketPrefix}-${number}`,
        title: seed.title,
        description: 'Created by the development seed.',
        type: seed.type,
        status: seed.status,
        priority: seed.priority,
        severity: seed.severity,
        reporterId: owner.id,
        assigneeId: seed.assignee,
        dueDate: daysFromNow(7 + index),
        resolvedAt: seed.resolved ? daysFromNow(-1) : null,
      },
    });
  }

  /*
   * Keep the counter ahead of every existing key, not just the seeded ones.
   *
   * The seed re-runs on each container start, and it only upserts its own five
   * tickets — anything reported since is left alone. Setting the counter to a
   * fixed 1005 therefore walked it *backwards* past those rows, and the next
   * report collided with a key that already existed.
   */
  const highest = await prisma.ticket.aggregate({
    where: { workspaceId: workspace.id },
    _max: { number: true },
  });

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      ticketCounter: Math.max(highest._max.number ?? 0, TICKET_NUMBER_START + ticketSeeds.length),
    },
  });

  // ---------------------------------------------------------------------------
  // A comment thread, including a mention
  // ---------------------------------------------------------------------------
  const firstTicket = await prisma.ticket.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { number: 'asc' },
  });
  const maya = teammates[0]?.user ?? owner;

  // Guarded rather than upserted: a comment has no natural key, so re-running
  // the seed must not stack up copies of the same conversation.
  if (firstTicket && (await prisma.comment.count({ where: { workspaceId: workspace.id } })) === 0) {
    const opening = await prisma.comment.create({
      data: {
        workspaceId: workspace.id,
        authorId: maya.id,
        ticketId: firstTicket.id,
        body: `Reproduced on staging — it only fails when the address contains a plus sign. ${formatMention(owner.id, owner.name)} could you confirm the encoding on the login form?`,
        mentions: { create: [{ userId: owner.id }] },
      },
    });

    await prisma.comment.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        ticketId: firstTicket.id,
        body: 'Confirmed — the address is being decoded twice. Fix is in review.',
      },
    });

    await prisma.notification.create({
      data: {
        userId: owner.id,
        workspaceId: workspace.id,
        type: NotificationType.MENTIONED,
        title: `${maya.name} mentioned you on ${firstTicket.key}`,
        body: stripMentionTokens(opening.body),
        entity: ActivityEntity.COMMENT,
        entityId: opening.id,
        actionUrl: `/tickets?ticket=${firstTicket.key}`,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Activity + notifications
  // ---------------------------------------------------------------------------
  if ((await prisma.activityLog.count({ where: { workspaceId: workspace.id } })) === 0) {
    await prisma.activityLog.createMany({
      data: [
        {
          workspaceId: workspace.id,
          actorId: owner.id,
          action: ActivityAction.CREATED,
          entity: ActivityEntity.WORKSPACE,
          entityId: workspace.id,
          summary: 'Created workspace "CoreTask Demo"',
        },
        {
          workspaceId: workspace.id,
          actorId: owner.id,
          action: ActivityAction.CREATED,
          entity: ActivityEntity.PROJECT,
          entityId: project.id,
          summary: 'Created project "Platform Foundation"',
        },
        {
          workspaceId: workspace.id,
          actorId: teammates[0]?.user.id ?? owner.id,
          action: ActivityAction.STATUS_CHANGED,
          entity: ActivityEntity.TICKET,
          entityId: workspace.id,
          summary: 'Moved CORE-1001 to Triaged',
        },
      ],
    });
  }

  if ((await prisma.notification.count({ where: { userId: owner.id } })) === 0) {
    await prisma.notification.create({
      data: {
        userId: owner.id,
        workspaceId: workspace.id,
        type: NotificationType.WORKSPACE_INVITE,
        title: 'CoreTask Demo is ready',
        body: 'You are the owner of this workspace. Invite your team to get started.',
        entity: ActivityEntity.WORKSPACE,
        entityId: workspace.id,
        actionUrl: `/w/${workspace.slug}`,
      },
    });
  }

  console.warn(
    [
      '',
      'Seed complete.',
      `  Workspace   CoreTask Demo (${workspace.slug})`,
      `  Project     Platform Foundation (${PROJECT_KEY})`,
      `  Tickets     ${workspace.ticketPrefix}-1001 .. ${workspace.ticketPrefix}-${1000 + ticketSeeds.length}`,
      '',
      '  Demo login  ' + DEMO_EMAIL,
      '  Password    ' + DEMO_PASSWORD,
      '',
      '  Development credentials only — never seed a shared environment.',
      '',
    ].join('\n'),
  );
}

function upsertMembership(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  invitedById?: string,
) {
  return prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    update: { role },
    create: { workspaceId, userId, role, invitedById: invitedById ?? null },
  });
}

/**
 * Creates or refreshes a demo team and its roster.
 *
 * Membership is added, never pruned: the seed is re-run against databases people
 * have been clicking around in, and silently ejecting someone they added would
 * be a surprising thing for a seed to do.
 */
async function upsertTeam(
  workspaceId: string,
  team: {
    name: string;
    description: string;
    color: string;
    leadId: string;
    memberIds: (string | undefined)[];
  },
) {
  const record = await prisma.team.upsert({
    where: { workspaceId_name: { workspaceId, name: team.name } },
    update: { description: team.description, color: team.color, leadId: team.leadId },
    create: {
      workspaceId,
      name: team.name,
      description: team.description,
      color: team.color,
      leadId: team.leadId,
    },
  });

  const userIds = [...new Set([team.leadId, ...team.memberIds].filter(Boolean))] as string[];

  await prisma.teamMember.createMany({
    data: userIds.map((userId) => ({ teamId: record.id, userId })),
    skipDuplicates: true,
  });

  return record;
}

/**
 * Sections have no natural unique key in the schema (two projects may both have
 * a "Backlog"), so idempotency is a find-then-create on name within the project.
 */
async function upsertSection(
  workspaceId: string,
  projectId: string,
  name: string,
  position: number,
) {
  const existing = await prisma.section.findFirst({ where: { projectId, name } });

  return existing
    ? prisma.section.update({ where: { id: existing.id }, data: { position } })
    : prisma.section.create({ data: { workspaceId, projectId, name, position } });
}

async function upsertTask(input: {
  workspaceId: string;
  projectId: string;
  sectionId: string | null;
  parentTaskId?: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  assigneeId: string | null;
  createdById: string;
  dueDate: Date;
  completedAt: Date | null;
}) {
  const existing = await prisma.task.findFirst({
    where: { projectId: input.projectId, title: input.title },
  });

  return existing
    ? prisma.task.update({
        where: { id: existing.id },
        data: {
          sectionId: input.sectionId,
          status: input.status,
          priority: input.priority,
          position: input.position,
          assigneeId: input.assigneeId,
          dueDate: input.dueDate,
          completedAt: input.completedAt,
        },
      })
    : prisma.task.create({ data: input });
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(17, 0, 0, 0);
  return date;
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
