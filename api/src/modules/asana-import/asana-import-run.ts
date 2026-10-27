import {
  ActivityAction,
  ActivityEntity,
  AttachmentStatus,
  CustomFieldType,
  POSITION_STEP,
  ProjectMemberRole,
  ProjectStatus,
  ProjectVisibility,
  TaskStatus,
  WorkspaceRole,
  tagNameKey,
} from '@coretask/contracts';
import { deriveProjectKey } from '@coretask/validation';
import type { Logger } from '@nestjs/common';
import { ImportRunStatus, ImportSource, Prisma } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import {
  AsanaApiError,
  type AsanaApiClient,
  type AsanaParams,
} from '../../integrations/asana/asana-api.client';
import type {
  AsanaAttachment,
  AsanaCustomField,
  AsanaCustomFieldSetting,
  AsanaCustomFieldValue,
  AsanaMembership,
  AsanaPortfolio,
  AsanaProject,
  AsanaRef,
  AsanaSection,
  AsanaStatusUpdate,
  AsanaStory,
  AsanaTask,
  AsanaTeam,
  AsanaUser,
  AsanaWorkspaceMembership,
} from '../../integrations/asana/asana.types';
import type { StorageService } from '../../integrations/storage/storage.service';
import { normalizeRichText } from '../../common/utils/rich-text.util';

import {
  LIMITS,
  approvalStatus,
  calendarDate,
  clip,
  colorToken,
  commentBody,
  description,
  fieldDefinition,
  instant,
  linkedFilesHtml,
  projectColor,
  projectRole,
  projectVisibility,
  schedule,
  statusValue,
  taskKind,
  uniqueKey,
  uniqueName,
  workspaceRole,
  type PersonLookup,
} from './asana-mapping';

/** What the importer asks Asana for on every task and subtask. */
export const TASK_FIELDS = [
  'name',
  'resource_subtype',
  'html_notes',
  'completed',
  'completed_at',
  'assignee',
  'due_on',
  'due_at',
  'start_on',
  'start_at',
  'created_at',
  'created_by',
  'approval_status',
  'num_subtasks',
  'parent',
  'memberships.project',
  'memberships.section',
  'tags',
  'followers',
  'likes.user',
  'dependencies',
  'custom_type.name',
  'actual_time_minutes',
  'custom_fields.resource_subtype',
  'custom_fields.text_value',
  'custom_fields.number_value',
  'custom_fields.enum_value',
  'custom_fields.multi_enum_values',
  'custom_fields.date_value',
  'custom_fields.people_value',
  'custom_fields.display_value',
].join(',');

const FIELD_FIELDS =
  'name,resource_subtype,description,precision,format,currency_code,custom_label,custom_label_position,enum_options.name,enum_options.color,enum_options.enabled';
const PROJECT_FIELDS =
  'name,archived,color,html_notes,owner,team,privacy_setting,start_on,due_on,completed,completed_at,created_at';
const STORY_FIELDS =
  'resource_subtype,text,html_text,created_at,created_by.name,created_by.email,is_pinned,likes.user';
const ATTACHMENT_FIELDS = 'name,host,size,download_url,view_url,permanent_url,created_at';

/** Search's page size, which is also its ceiling. */
const SEARCH_PAGE_SIZE = 100;
/** A bound on one search's pages: 100,000 tasks. */
const MAX_SEARCH_PAGES = 1_000;
/** People per "commented on by" search, to keep the query string short. */
const SEARCH_PEOPLE_PER_QUERY = 10;

/** How many failures the run row keeps; `errorCount` keeps counting past it. */
export const MAX_RECORDED_ERRORS = 200;
/** The run row is rewritten at most this often while the counters move. */
const PROGRESS_INTERVAL_MS = 2_000;

export interface Counter {
  done: number;
  total?: number;
  skipped?: number;
}

export interface ImportError {
  kind: string;
  externalId: string | null;
  name: string | null;
  message: string;
}

export interface AsanaImportDeps {
  prisma: PrismaService;
  asana: AsanaApiClient;
  storage: StorageService;
  logger: Logger;
  concurrency: number;
}

interface Person {
  id: string;
  name: string;
}

interface FieldRef {
  id: string;
  type: CustomFieldType;
  /** Asana option gid → CoreTask option id. */
  options: Map<string, string>;
  /** Asana's own type: a TEXT field may stand in for a reference or formula field. */
  asanaType: string;
}

/** A top-level task as listed, with where it sits in each project it is in. */
interface ListedTask {
  task: AsanaTask;
  /** Project gid → index in that project's list. */
  order: Map<string, number>;
  /** The project it was first listed in, the home when its memberships say nothing. */
  firstProject: string;
}

/** A task already in CoreTask, waiting for its comments and files. */
interface DetailItem {
  gid: string;
  taskId: string;
  name: string;
  /** Asana's count of its subtasks; none means no call to list them. */
  subtasks: number;
  /** A subtask's history is read only when search says it has some. */
  isSubtask: boolean;
}

/**
 * One run of the Asana import: every phase, and the state the phases share.
 *
 * Re-runnable by design. Each record Asana has is looked up in `ExternalRef`
 * by its gid before anything is written; found, the CoreTask row is updated in
 * place, and missing, it is created and the ref recorded. A second run over the
 * same Asana therefore converges on the same rows instead of doubling them,
 * and a run stopped half way is finished by starting another.
 *
 * Writes go straight to the database, not through the services the API uses.
 * That is deliberate: a service write announces itself — automations, webhooks,
 * notifications, e-mails — and an import of a hundred thousand tasks must not
 * fire a rule per task or tell twenty people about work that is years old.
 */
export class AsanaImportRun {
  private readonly refs = new Map<string, string>();
  private readonly people = new Map<string, Person>();
  private readonly pendingPeople = new Map<string, Promise<Person | undefined>>();
  private readonly fields = new Map<string, FieldRef>();
  private readonly pendingFields = new Map<string, Promise<FieldRef | undefined>>();
  /** Tags by name key, so concurrent tasks naming one tag create it once. */
  private readonly pendingTags = new Map<string, Promise<string>>();
  /** Tasks written this run, so one reached twice is written once. */
  private readonly writtenTasks = new Map<string, Promise<string>>();
  private readonly tags = new Map<string, string>();
  private readonly projectGids = new Set<string>();
  private readonly privateProjects = new Set<string>();
  private readonly dependencies = new Map<string, string[]>();
  private readonly counts: Record<string, Counter | number> = {};
  private readonly errors: ImportError[] = [];
  private errorCount = 0;
  private phase = 'starting';
  private lastProgressAt = 0;
  private readonly person: PersonLookup = (gid) => this.people.get(gid);

  constructor(
    private readonly deps: AsanaImportDeps,
    private readonly runId: string,
    private readonly workspaceId: string,
    private readonly asanaWorkspaceGid: string,
    /** Who started it: the owner of what nobody else can be credited with. */
    private readonly starterId: string,
  ) {}

  private get prisma(): PrismaService {
    return this.deps.prisma;
  }

  private get asana(): AsanaApiClient {
    return this.deps.asana;
  }

  // -------------------------------------------------------------------------
  // The run
  // -------------------------------------------------------------------------

  async execute(): Promise<ImportRunStatus> {
    await this.loadRefs();

    await this.step('people', () => this.importPeople());
    await this.step('teams', () => this.importTeams());
    await this.step('fields', () => this.importFields());
    await this.step('tags', () => this.importTags());
    const projects = await this.step('projects', () => this.importProjects());
    await this.step('portfolios', () => this.importPortfolios());
    const listed = await this.step('tasks', () => this.listTasks(projects ?? []));
    const topLevel = await this.step('tasks', () => this.importTopLevel(listed ?? new Map()));
    const items = await this.step('subtasks', () => this.importSubtasks(topLevel ?? []));
    await this.step('history', () => this.importHistory(items ?? []));
    await this.step('dependencies', () => this.importDependencies());
    await this.step('access', () => this.grantAssigneesAccess());

    this.phase = 'done';
    const status = this.errorCount > 0 ? ImportRunStatus.PARTIAL : ImportRunStatus.SUCCEEDED;
    await this.recordActivity();
    await this.progress(true);
    return status;
  }

  /**
   * One phase. A phase that throws outright — Asana refusing the token, say —
   * ends the run; record-level failures never get here, they are recorded and
   * the phase goes on.
   */
  private async step<T>(phase: string, work: () => Promise<T>): Promise<T> {
    this.phase = phase;
    await this.progress(true);
    return work();
  }

  /** Counters and failures as the run row shows them. */
  snapshot(): {
    phase: string;
    counts: Record<string, Counter | number>;
    errors: ImportError[];
    errorCount: number;
  } {
    return {
      phase: this.phase,
      counts: { ...this.counts, requests: this.asana.requestCount },
      errors: this.errors,
      errorCount: this.errorCount,
    };
  }

  private async progress(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    this.lastProgressAt = now;

    const snapshot = this.snapshot();
    await this.prisma.importRun.update({
      where: { id: this.runId },
      data: {
        phase: snapshot.phase,
        counts: snapshot.counts as Prisma.InputJsonValue,
        errors: snapshot.errors as unknown as Prisma.InputJsonValue,
        errorCount: snapshot.errorCount,
      },
    });
  }

  private counter(kind: string): Counter {
    const existing = this.counts[kind];
    if (typeof existing === 'object') return existing;
    const created: Counter = { done: 0 };
    this.counts[kind] = created;
    return created;
  }

  private fail(kind: string, ref: AsanaRef | null, error: unknown): void {
    this.errorCount += 1;
    const message = readableError(error);
    if (this.errors.length < MAX_RECORDED_ERRORS) {
      this.errors.push({
        kind,
        externalId: ref?.gid ?? null,
        name: ref?.name ? clip(ref.name, 120) : null,
        message: clip(message, 500),
      });
    }
    this.deps.logger.warn(
      { runId: this.runId, kind, gid: ref?.gid, err: message },
      'Asana record not imported',
    );
  }

  // -------------------------------------------------------------------------
  // External refs
  // -------------------------------------------------------------------------

  private async loadRefs(): Promise<void> {
    const rows = await this.prisma.externalRef.findMany({
      where: { workspaceId: this.workspaceId, source: ImportSource.ASANA },
      select: { entityType: true, externalId: true, entityId: true },
    });
    for (const row of rows) this.refs.set(`${row.entityType}:${row.externalId}`, row.entityId);
  }

  private ref(type: string, gid: string): string | undefined {
    return this.refs.get(`${type}:${gid}`);
  }

  /**
   * Records which CoreTask row an Asana record became, with the record itself
   * when given — refreshed on every run, so it is always Asana's latest.
   */
  private async remember(
    type: string,
    gid: string,
    entityId: string,
    snapshot?: unknown,
  ): Promise<void> {
    if (snapshot === undefined && this.refs.get(`${type}:${gid}`) === entityId) return;
    const data = snapshot === undefined ? {} : { snapshot: snapshot as Prisma.InputJsonValue };
    await this.prisma.externalRef.upsert({
      where: {
        workspaceId_source_entityType_externalId: {
          workspaceId: this.workspaceId,
          source: ImportSource.ASANA,
          entityType: type,
          externalId: gid,
        },
      },
      create: {
        workspaceId: this.workspaceId,
        source: ImportSource.ASANA,
        entityType: type,
        externalId: gid,
        entityId,
        ...data,
      },
      update: { entityId, ...data },
    });
    this.refs.set(`${type}:${gid}`, entityId);
  }

  /**
   * Updates the row a ref points at, or creates it when there is no ref or
   * the row has since been deleted in CoreTask.
   */
  private async upsert(
    type: string,
    gid: string,
    update: (id: string) => Promise<unknown>,
    create: () => Promise<{ id: string }>,
    snapshot?: unknown,
  ): Promise<string> {
    const existing = this.ref(type, gid);
    if (existing) {
      try {
        await update(existing);
        if (snapshot !== undefined) await this.remember(type, gid, existing, snapshot);
        return existing;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }

    const created = await create();
    await this.remember(type, gid, created.id, snapshot);
    return created.id;
  }

  // -------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------

  /**
   * Everyone in the Asana workspace, matched to a CoreTask account by e-mail.
   *
   * Someone with no account gets a placeholder: an account with no password,
   * no sign-in and an unconfirmed address, which they take over with "Forgot
   * password" (that link is what confirms the address). That keeps assignees, comment authors and
   * followers true to Asana from the first day, rather than pinning a
   * colleague's history on whoever ran the import.
   */
  private async importPeople(): Promise<void> {
    const memberships = await this.asana.list<AsanaWorkspaceMembership>(
      `/workspaces/${this.asanaWorkspaceGid}/workspace_memberships`,
      { opt_fields: 'user.name,user.email,is_admin,is_guest,is_active' },
    );
    const counter = this.counter('people');
    counter.total = memberships.length;

    for (const membership of memberships) {
      const user = membership.user;
      if (!user) continue;
      try {
        const person = await this.ensurePerson(user, workspaceRole(membership));
        if (person) counter.done += 1;
        else counter.skipped = (counter.skipped ?? 0) + 1;
      } catch (error) {
        this.fail('person', user, error);
      }
      await this.progress();
    }
  }

  private async ensurePerson(user: AsanaUser, role: WorkspaceRole): Promise<Person | undefined> {
    const email = user.email?.trim().toLowerCase();
    if (!email) return undefined;

    const name = clip(user.name, LIMITS.userName, email);
    const account =
      (await this.prisma.user.findUnique({ where: { email }, select: { id: true, name: true } })) ??
      (await this.createPlaceholder(email, name));

    await this.prisma.workspaceMember.createMany({
      data: [
        { workspaceId: this.workspaceId, userId: account.id, role, invitedById: this.starterId },
      ],
      skipDuplicates: true,
    });

    const person = { id: account.id, name: account.name };
    this.people.set(user.gid, person);
    await this.remember('user', user.gid, account.id, user);
    if (account.id !== this.starterId) {
      const placeholders = this.counter('placeholders');
      if (this.isPlaceholder(account)) placeholders.done += 1;
    }
    return person;
  }

  private readonly createdPlaceholders = new Set<string>();

  private isPlaceholder(account: { id: string }): boolean {
    return this.createdPlaceholders.has(account.id);
  }

  private async createPlaceholder(
    email: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    try {
      const created = await this.prisma.user.create({
        data: { email, name, passwordHash: null },
        select: { id: true, name: true },
      });
      this.createdPlaceholders.add(created.id);
      return created;
    } catch (error) {
      // Someone signed up with the address between the lookup and the insert.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.user.findUniqueOrThrow({
          where: { email },
          select: { id: true, name: true },
        });
      }
      throw error;
    }
  }

  /**
   * A person a task names who was not in the workspace list — a former
   * member, or someone from outside the organisation. Asked for once.
   */
  private async personOf(ref: AsanaRef | null | undefined): Promise<Person | undefined> {
    if (!ref?.gid) return undefined;
    const known = this.people.get(ref.gid);
    if (known) return known;

    let pending = this.pendingPeople.get(ref.gid);
    if (!pending) {
      pending = this.asana
        .get<AsanaUser>(`/users/${ref.gid}`, { opt_fields: 'name,email' })
        .then((user) => this.ensurePerson(user, WorkspaceRole.GUEST))
        .catch(() => undefined);
      this.pendingPeople.set(ref.gid, pending);
    }
    return pending;
  }

  // -------------------------------------------------------------------------
  // Teams
  // -------------------------------------------------------------------------

  private async importTeams(): Promise<void> {
    let teams: AsanaTeam[];
    try {
      teams = await this.asana.list<AsanaTeam>(`/workspaces/${this.asanaWorkspaceGid}/teams`, {
        opt_fields: 'name,description',
      });
    } catch (error) {
      // A plain workspace, rather than an organisation, has no teams.
      this.fail('teams', null, error);
      return;
    }

    const taken = new Set(
      (
        await this.prisma.team.findMany({
          where: { workspaceId: this.workspaceId },
          select: { id: true, name: true },
        })
      )
        .filter((team) => !teams.some((t) => this.ref('team', t.gid) === team.id))
        .map((team) => team.name.toLowerCase()),
    );
    const counter = this.counter('teams');
    counter.total = teams.length;

    for (const team of teams) {
      try {
        const name = uniqueName(team.name ?? 'Team', taken, LIMITS.teamName);
        const teamId = await this.upsert(
          'team',
          team.gid,
          (id) => this.prisma.team.update({ where: { id }, data: { name } }),
          () =>
            this.prisma.team.create({
              data: { workspaceId: this.workspaceId, name, description: team.description ?? null },
              select: { id: true },
            }),
          team,
        );

        const users = await this.asana.list<AsanaUser>(`/teams/${team.gid}/users`, {
          opt_fields: 'name,email',
        });
        const members: string[] = [];
        for (const user of users) {
          const person = await this.personOf(user);
          if (person) members.push(person.id);
        }
        await this.prisma.teamMember.createMany({
          data: members.map((userId) => ({ teamId, userId })),
          skipDuplicates: true,
        });
        counter.done += 1;
      } catch (error) {
        this.fail('team', team, error);
      }
      await this.progress();
    }
  }

  // -------------------------------------------------------------------------
  // Custom fields and tags
  // -------------------------------------------------------------------------

  private async importFields(): Promise<void> {
    const fields = await this.asana.list<AsanaCustomField>(
      `/workspaces/${this.asanaWorkspaceGid}/custom_fields`,
      { opt_fields: FIELD_FIELDS },
    );
    const counter = this.counter('customFields');
    counter.total = fields.length;

    for (const field of fields) {
      try {
        const saved = await this.saveField(field);
        if (saved) counter.done += 1;
        else counter.skipped = (counter.skipped ?? 0) + 1;
      } catch (error) {
        this.fail('custom_field', field, error);
      }
    }
  }

  /** A field a project or task names that the workspace list did not include. */
  private async fieldOf(gid: string): Promise<FieldRef | undefined> {
    const known = this.fields.get(gid);
    if (known) return known;

    let pending = this.pendingFields.get(gid);
    if (!pending) {
      pending = this.asana
        .get<AsanaCustomField>(`/custom_fields/${gid}`, { opt_fields: FIELD_FIELDS })
        .then(async (field) => {
          const saved = await this.saveField(field);
          // Counted beside the workspace's own: a project-local field the list left out.
          const counter = this.counter('customFields');
          counter.total = (counter.total ?? 0) + 1;
          if (saved) counter.done += 1;
          else counter.skipped = (counter.skipped ?? 0) + 1;
          return saved;
        })
        .catch((error: unknown) => {
          this.fail('custom_field', { gid }, error);
          return undefined;
        });
      this.pendingFields.set(gid, pending);
    }
    return pending;
  }

  private async saveField(field: AsanaCustomField): Promise<FieldRef | undefined> {
    const definition = fieldDefinition(field);
    if (!definition) {
      // Remembered as unsupported so a task's value for it is skipped quietly.
      this.pendingFields.set(field.gid, Promise.resolve(undefined));
      return undefined;
    }

    const name = clip(field.name, LIMITS.fieldName, 'Field');
    const data = {
      name,
      description: field.description || null,
      settings: definition.settings as Prisma.InputJsonValue,
    };
    const fieldId = await this.upsert(
      'custom_field',
      field.gid,
      (id) => this.prisma.customField.update({ where: { id }, data }),
      () =>
        this.prisma.customField.create({
          data: {
            ...data,
            workspaceId: this.workspaceId,
            type: definition.type,
            createdById: this.starterId,
          },
          select: { id: true },
        }),
      field,
    );

    const options = new Map<string, string>();
    for (const [index, option] of (field.enum_options ?? []).entries()) {
      const optionData = {
        label: clip(option.name, LIMITS.optionLabel, 'Option'),
        colorToken: colorToken(option.color),
        position: (index + 1) * POSITION_STEP,
        isArchived: option.enabled === false,
      };
      const optionId = await this.upsert(
        'enum_option',
        option.gid,
        (id) => this.prisma.customFieldOption.update({ where: { id }, data: optionData }),
        () =>
          this.prisma.customFieldOption.create({
            data: { ...optionData, customFieldId: fieldId },
            select: { id: true },
          }),
      );
      options.set(option.gid, optionId);
    }

    const saved = {
      id: fieldId,
      type: definition.type,
      options,
      asanaType: field.resource_subtype ?? '',
    };
    this.fields.set(field.gid, saved);
    return saved;
  }

  private async importTags(): Promise<void> {
    const tags = await this.asana.list<AsanaRef & { color?: string | null }>(
      `/workspaces/${this.asanaWorkspaceGid}/tags`,
      { opt_fields: 'name,color' },
    );
    for (const tag of tags) {
      try {
        this.tags.set(tag.gid, await this.ensureTag(tag.name ?? 'Tag', tag.color ?? null));
      } catch (error) {
        this.fail('tag', tag, error);
      }
    }
    this.counter('tags').done = tags.length;
  }

  /**
   * A tag by name: Asana's tags, and one per custom task type ("Ticket").
   * Tasks are written several at a time, so the first to name a tag creates
   * it and the rest wait for that; two upserts racing would both insert.
   */
  private ensureTag(rawName: string, color: string | null): Promise<string> {
    const name = clip(rawName, LIMITS.tagName, 'Tag');
    const nameKey = tagNameKey(name);

    let pending = this.pendingTags.get(nameKey);
    if (!pending) {
      pending = this.saveTag(name, nameKey, color);
      this.pendingTags.set(nameKey, pending);
      // A failure is not remembered: the next task to name the tag tries again.
      pending.catch(() => this.pendingTags.delete(nameKey));
    }
    return pending;
  }

  private async saveTag(name: string, nameKey: string, color: string | null): Promise<string> {
    const tag = await this.prisma.tag.upsert({
      where: { workspaceId_nameKey: { workspaceId: this.workspaceId, nameKey } },
      create: {
        workspaceId: this.workspaceId,
        name,
        nameKey,
        color: colorToken(color),
        createdById: this.starterId,
      },
      update: {},
      select: { id: true },
    });
    return tag.id;
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  private async importProjects(): Promise<AsanaProject[]> {
    const projects = [
      ...(await this.asana.list<AsanaProject>('/projects', {
        workspace: this.asanaWorkspaceGid,
        archived: false,
        opt_fields: PROJECT_FIELDS,
      })),
      ...(await this.asana.list<AsanaProject>('/projects', {
        workspace: this.asanaWorkspaceGid,
        archived: true,
        opt_fields: PROJECT_FIELDS,
      })),
    ];
    const counter = this.counter('projects');
    counter.total = projects.length;

    const keys = new Set(
      (
        await this.prisma.project.findMany({
          where: { workspaceId: this.workspaceId },
          select: { key: true },
        })
      ).map((project) => project.key),
    );

    const imported: AsanaProject[] = [];
    for (const project of projects) {
      try {
        await this.importProject(project, keys);
        imported.push(project);
        counter.done += 1;
      } catch (error) {
        this.fail('project', project, error);
      }
      await this.progress();
    }
    return imported;
  }

  private async importProject(project: AsanaProject, keys: Set<string>): Promise<void> {
    const lead = await this.personOf(project.owner);
    const teamId = project.team ? (this.ref('team', project.team.gid) ?? null) : null;
    const visibility = projectVisibility(project.privacy_setting);
    const archivedAt = project.archived ? new Date() : null;
    const status = project.archived
      ? ProjectStatus.ARCHIVED
      : project.completed
        ? ProjectStatus.COMPLETED
        : ProjectStatus.ACTIVE;

    const data = {
      name: clip(project.name, LIMITS.projectName, 'Untitled project'),
      description: description(project.html_notes, this.person),
      color: projectColor(project.color),
      status,
      visibility,
      leadId: lead?.id ?? null,
      teamId,
      startDate: calendarDate(project.start_on),
      dueDate: calendarDate(project.due_on),
      completedAt: project.completed ? (instant(project.completed_at) ?? new Date()) : null,
    };

    const projectId = await this.upsert(
      'project',
      project.gid,
      async (id) => {
        const current = await this.prisma.project.findUniqueOrThrow({
          where: { id },
          select: { archivedAt: true },
        });
        await this.prisma.project.update({
          where: { id },
          // An archive date already set is kept; Asana does not say when.
          data: {
            ...data,
            archivedAt: project.archived ? (current.archivedAt ?? archivedAt) : null,
          },
        });
      },
      () =>
        this.prisma.project.create({
          data: {
            ...data,
            workspaceId: this.workspaceId,
            key: uniqueKey(deriveProjectKey(project.name ?? 'Project'), keys),
            archivedAt,
            createdAt: instant(project.created_at) ?? undefined,
          },
          select: { id: true },
        }),
      project,
    );

    this.projectGids.add(project.gid);
    if (visibility === ProjectVisibility.PRIVATE) this.privateProjects.add(projectId);

    await this.importProjectMembers(project, projectId, lead);
    await this.importSections(project, projectId);
    await this.importProjectFields(project, projectId);
    await this.importStatusUpdates(project, projectId);
  }

  private async importProjectMembers(
    project: AsanaProject,
    projectId: string,
    lead: Person | undefined,
  ): Promise<void> {
    const memberships = await this.asana.list<AsanaMembership>('/memberships', {
      parent: project.gid,
      opt_fields: 'member.name,member.resource_type,access_level',
    });

    const roles = new Map<string, ProjectMemberRole>();
    for (const membership of memberships) {
      // A team can be a member of an Asana project; its people are covered by
      // the team, and CoreTask's projects hold people only.
      if (membership.member?.resource_type !== 'user') continue;
      const person = await this.personOf(membership.member);
      if (person) roles.set(person.id, projectRole(membership.access_level));
    }
    if (lead) roles.set(lead.id, ProjectMemberRole.ADMIN);

    for (const [userId, role] of roles) {
      await this.prisma.projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: {
          projectId,
          userId,
          workspaceId: this.workspaceId,
          role,
          addedById: this.starterId,
        },
        update: { role },
      });
    }
  }

  private async importSections(project: AsanaProject, projectId: string): Promise<void> {
    const sections = await this.asana.list<AsanaSection>(`/projects/${project.gid}/sections`, {
      opt_fields: 'name',
    });
    const counter = this.counter('sections');

    for (const [index, section] of sections.entries()) {
      const data = {
        name: clip(section.name, LIMITS.sectionName, 'Untitled section'),
        position: (index + 1) * POSITION_STEP,
      };
      await this.upsert(
        'section',
        section.gid,
        (id) => this.prisma.section.update({ where: { id }, data: { ...data, projectId } }),
        () =>
          this.prisma.section.create({
            data: { ...data, workspaceId: this.workspaceId, projectId },
            select: { id: true },
          }),
        { ...section, project: { gid: project.gid } },
      );
      counter.done += 1;
    }
  }

  private async importProjectFields(project: AsanaProject, projectId: string): Promise<void> {
    const settings = await this.asana.list<AsanaCustomFieldSetting>(
      `/projects/${project.gid}/custom_field_settings`,
      { opt_fields: 'custom_field.name,is_important' },
    );

    for (const [index, setting] of settings.entries()) {
      const gid = setting.custom_field?.gid;
      if (!gid) continue;
      const field = await this.fieldOf(gid);
      if (!field) continue;

      await this.prisma.projectCustomField.upsert({
        where: { projectId_customFieldId: { projectId, customFieldId: field.id } },
        create: { projectId, customFieldId: field.id, position: (index + 1) * POSITION_STEP },
        update: { position: (index + 1) * POSITION_STEP },
      });
    }
  }

  private async importStatusUpdates(project: AsanaProject, projectId: string): Promise<void> {
    const updates = await this.asana.list<AsanaStatusUpdate>('/status_updates', {
      parent: project.gid,
      opt_fields: 'status_type,title,text,created_at,author.name,author.email',
    });

    for (const update of updates) {
      if (this.ref('status_update', update.gid)) continue;
      const author = await this.personOf(update.author);
      const created = await this.prisma.projectStatusUpdate.create({
        data: {
          workspaceId: this.workspaceId,
          projectId,
          authorId: author?.id ?? null,
          status: statusValue(update.status_type),
          title: clip(update.title, LIMITS.statusTitle, 'Status update'),
          summary: update.text?.trim() || null,
          createdAt: instant(update.created_at) ?? undefined,
        },
        select: { id: true },
      });
      await this.remember('status_update', update.gid, created.id, update);
      this.counter('statusUpdates').done += 1;
    }
  }

  private async importPortfolios(): Promise<void> {
    let portfolios: AsanaPortfolio[];
    try {
      // Asana lists only the portfolios the token's owner owns.
      portfolios = await this.asana.list<AsanaPortfolio>('/portfolios', {
        workspace: this.asanaWorkspaceGid,
        owner: 'me',
        opt_fields: 'name,color,owner',
      });
    } catch (error) {
      this.fail('portfolios', null, error);
      return;
    }

    for (const portfolio of portfolios) {
      try {
        const owner = await this.personOf(portfolio.owner);
        const data = {
          name: clip(portfolio.name, LIMITS.portfolioName, 'Portfolio'),
          color: projectColor(portfolio.color),
          ownerId: owner?.id ?? this.starterId,
        };
        const portfolioId = await this.upsert(
          'portfolio',
          portfolio.gid,
          (id) => this.prisma.portfolio.update({ where: { id }, data }),
          () =>
            this.prisma.portfolio.create({
              data: { ...data, workspaceId: this.workspaceId },
              select: { id: true },
            }),
          portfolio,
        );

        const items = await this.asana.list<AsanaRef>(`/portfolios/${portfolio.gid}/items`, {
          opt_fields: 'name,resource_type',
        });
        const projectIds = items
          .filter((item) => item.resource_type === 'project')
          .map((item) => this.ref('project', item.gid))
          .filter((id): id is string => Boolean(id));
        await this.prisma.portfolioProject.createMany({
          data: projectIds.map((projectId, index) => ({
            portfolioId,
            projectId,
            position: (index + 1) * POSITION_STEP,
          })),
          skipDuplicates: true,
        });
        this.counter('portfolios').done += 1;
      } catch (error) {
        this.fail('portfolio', portfolio, error);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  /**
   * Every project's top-level tasks, listed before any is written, so the
   * totals are known up front and a task in several projects is written once.
   */
  private async listTasks(projects: AsanaProject[]): Promise<Map<string, ListedTask>> {
    const listed = new Map<string, ListedTask>();
    const counter = this.counter('tasks');
    const subtasks = this.counter('subtasks');

    for (const project of projects) {
      try {
        const tasks = await this.asana.list<AsanaTask>('/tasks', {
          project: project.gid,
          opt_fields: TASK_FIELDS,
        });
        for (const [index, task] of tasks.entries()) {
          const entry = listed.get(task.gid);
          if (entry) {
            entry.order.set(project.gid, index);
            continue;
          }
          listed.set(task.gid, {
            task,
            order: new Map([[project.gid, index]]),
            firstProject: project.gid,
          });
          subtasks.total = (subtasks.total ?? 0) + (task.num_subtasks ?? 0);
        }
      } catch (error) {
        this.fail('project_tasks', project, error);
      }
      counter.total = listed.size;
      await this.progress();
    }

    // A subtask added to a project shows in that project's list too. It is
    // imported once, under its parent, which keeps the project as one of the
    // subtask's own projects; only a subtask whose parent nobody lists stays
    // top-level, since nothing else would reach it.
    for (const [gid, entry] of listed) {
      if (entry.task.parent && listed.has(entry.task.parent.gid)) {
        listed.delete(gid);
        this.counter('subtasksInProjects').done += 1;
      }
    }
    counter.total = listed.size;
    subtasks.total = [...listed.values()].reduce(
      (sum, entry) => sum + (entry.task.num_subtasks ?? 0),
      0,
    );
    return listed;
  }

  private async importTopLevel(listed: Map<string, ListedTask>): Promise<DetailItem[]> {
    const counter = this.counter('tasks');
    const items: DetailItem[] = [];
    const entries = [...listed.values()];

    await pool(entries, this.deps.concurrency, async (entry) => {
      try {
        const taskId = await this.importTask(entry.task, null, entry);
        items.push({
          gid: entry.task.gid,
          taskId,
          name: entry.task.name ?? '',
          subtasks: entry.task.num_subtasks ?? 0,
          isSubtask: false,
        });
        counter.done += 1;
      } catch (error) {
        this.fail('task', entry.task, error);
      }
      await this.progress();
    });
    return items;
  }

  /**
   * One task or subtask, with everything it carries inline: tags, followers,
   * likes, custom field values, other projects and time spent.
   */
  private importTask(
    task: AsanaTask,
    parent: { taskId: string; projectId: string | null; position: number } | null,
    listed: ListedTask | null,
  ): Promise<string> {
    let written = this.writtenTasks.get(task.gid);
    if (!written) {
      written = this.writeTask(task, parent, listed);
      this.writtenTasks.set(task.gid, written);
    }
    return written;
  }

  private async writeTask(
    task: AsanaTask,
    parent: { taskId: string; projectId: string | null; position: number } | null,
    listed: ListedTask | null,
  ): Promise<string> {
    const placement = parent
      ? { projectId: parent.projectId, sectionId: null as string | null, position: parent.position }
      : this.homeOf(task, listed!);

    const [assignee, creator] = await Promise.all([
      this.personOf(task.assignee),
      this.personOf(task.created_by),
    ]);
    const kind = taskKind(task.resource_subtype);
    const start = schedule(task.start_on, task.start_at);
    const due = schedule(task.due_on, task.due_at);
    const done = Boolean(task.completed);

    const data = {
      projectId: placement.projectId,
      sectionId: placement.sectionId,
      parentTaskId: parent?.taskId ?? null,
      title: clip(task.name, LIMITS.taskTitle, 'Untitled task'),
      description: description(task.html_notes, this.person),
      status: done ? TaskStatus.DONE : TaskStatus.TODO,
      completedAt: done ? (instant(task.completed_at) ?? new Date()) : null,
      position: placement.position,
      assigneeId: assignee?.id ?? null,
      startDate: start.date,
      startAt: start.at,
      dueDate: due.date,
      dueAt: due.at,
      kind,
      approvalStatus: approvalStatus(kind, task.approval_status),
    };

    const taskId = await this.upsert(
      'task',
      task.gid,
      (id) => this.prisma.task.update({ where: { id }, data }),
      () =>
        this.prisma.task.create({
          data: {
            ...data,
            workspaceId: this.workspaceId,
            createdById: creator?.id ?? this.starterId,
            createdAt: instant(task.created_at) ?? undefined,
          },
          select: { id: true },
        }),
      task,
    );

    await this.importOtherProjects(
      task,
      (projectGid) => listed?.order.get(projectGid) ?? 0,
      taskId,
      placement.projectId,
    );
    await this.importTaskTags(task, taskId);
    await this.importFollowersAndLikes(task, taskId);
    await this.importFieldValues(task, taskId);
    await this.importTime(task, taskId, assignee, due.date ?? instant(task.created_at));

    if (task.dependencies?.length) {
      this.dependencies.set(
        task.gid,
        task.dependencies.map((dependency) => dependency.gid),
      );
    }
    return taskId;
  }

  /**
   * Where a top-level task lives: its first Asana membership in a project that
   * came across, at its place in that project's list.
   */
  private homeOf(
    task: AsanaTask,
    listed: ListedTask,
  ): { projectId: string | null; sectionId: string | null; position: number } {
    const membership =
      (task.memberships ?? []).find(
        (m) => m.project && this.projectGids.has(m.project.gid) && listed.order.has(m.project.gid),
      ) ?? null;
    const projectGid = membership?.project?.gid ?? listed.firstProject;

    return {
      projectId: this.ref('project', projectGid) ?? null,
      sectionId: membership?.section ? (this.ref('section', membership.section.gid) ?? null) : null,
      position: ((listed.order.get(projectGid) ?? 0) + 1) * POSITION_STEP,
    };
  }

  /** Asana's multi-homing: each further project keeps its own section and place. */
  private async importOtherProjects(
    task: AsanaTask,
    orderIn: (projectGid: string) => number,
    taskId: string,
    homeProjectId: string | null,
  ): Promise<void> {
    for (const membership of task.memberships ?? []) {
      const projectGid = membership.project?.gid;
      if (!projectGid) continue;
      const projectId = this.ref('project', projectGid);
      if (!projectId || projectId === homeProjectId) continue;

      const sectionId = membership.section
        ? (this.ref('section', membership.section.gid) ?? null)
        : null;
      const position = (orderIn(projectGid) + 1) * POSITION_STEP;
      await this.prisma.taskProject.upsert({
        where: { taskId_projectId: { taskId, projectId } },
        create: { taskId, projectId, sectionId, position, addedById: this.starterId },
        update: { sectionId, position },
      });
      this.counter('multiHomed').done += 1;
    }
  }

  private async importTaskTags(task: AsanaTask, taskId: string): Promise<void> {
    const tagIds = (task.tags ?? [])
      .map((tag) => this.tags.get(tag.gid))
      .filter((id): id is string => Boolean(id));

    // A custom task type ("Ticket") becomes a tag of that name, so the tasks
    // stay findable as one kind without losing their custom fields.
    if (task.custom_type?.name) tagIds.push(await this.ensureTag(task.custom_type.name, null));

    if (tagIds.length) {
      await this.prisma.taskTag.createMany({
        data: tagIds.map((tagId) => ({ taskId, tagId })),
        skipDuplicates: true,
      });
    }
  }

  private async importFollowersAndLikes(task: AsanaTask, taskId: string): Promise<void> {
    const followers: string[] = [];
    for (const follower of task.followers ?? []) {
      const person = await this.personOf(follower);
      if (person) followers.push(person.id);
    }
    if (followers.length) {
      await this.prisma.follower.createMany({
        data: followers.map((userId) => ({ workspaceId: this.workspaceId, userId, taskId })),
        skipDuplicates: true,
      });
    }

    const likers: string[] = [];
    for (const like of task.likes ?? []) {
      const person = await this.personOf(like.user);
      if (person) likers.push(person.id);
    }
    if (likers.length) {
      await this.prisma.taskLike.createMany({
        data: likers.map((userId) => ({ taskId, userId })),
        skipDuplicates: true,
      });
    }
  }

  /**
   * Each field's value in the typed column its type reads. A field Asana
   * shows as empty clears a value an earlier run wrote.
   */
  private async importFieldValues(task: AsanaTask, taskId: string): Promise<void> {
    const cleared: string[] = [];

    for (const value of task.custom_fields ?? []) {
      const field = await this.fieldOf(value.gid);
      if (!field) continue;

      const columns = await this.valueColumns(field, value);
      if (!columns) {
        cleared.push(field.id);
        continue;
      }
      await this.prisma.taskCustomFieldValue.upsert({
        where: { taskId_customFieldId: { taskId, customFieldId: field.id } },
        create: { taskId, customFieldId: field.id, ...columns },
        update: columns,
      });
    }

    if (cleared.length) {
      await this.prisma.taskCustomFieldValue.deleteMany({
        where: { taskId, customFieldId: { in: cleared } },
      });
    }
  }

  private async valueColumns(field: FieldRef, value: AsanaCustomFieldValue) {
    const empty = {
      textValue: null as string | null,
      numberValue: null as Prisma.Decimal | null,
      dateValue: null as Date | null,
      booleanValue: null as boolean | null,
      optionIds: [] as string[],
      userIds: [] as string[],
    };

    switch (field.type) {
      case CustomFieldType.TEXT: {
        // A reference, formula or ID field has no value of its own type here,
        // so what Asana shows for it is what is kept.
        const text = (field.asanaType === 'text' ? value.text_value : value.display_value)?.trim();
        if (!text) return null;
        if (text.length <= LIMITS.fieldText) return { ...empty, textValue: text };
        // The whole value stays in the task's snapshot.
        this.counter('textShortened').done += 1;
        return { ...empty, textValue: text.slice(0, LIMITS.fieldText) };
      }
      case CustomFieldType.NUMBER:
        return typeof value.number_value === 'number' && Number.isFinite(value.number_value)
          ? { ...empty, numberValue: new Prisma.Decimal(value.number_value) }
          : null;
      case CustomFieldType.DATE: {
        const date = calendarDate(value.date_value?.date ?? value.date_value?.date_time);
        return date ? { ...empty, dateValue: date } : null;
      }
      case CustomFieldType.SINGLE_SELECT: {
        const optionId = value.enum_value ? field.options.get(value.enum_value.gid) : undefined;
        return optionId ? { ...empty, optionIds: [optionId] } : null;
      }
      case CustomFieldType.MULTI_SELECT: {
        const optionIds = (value.multi_enum_values ?? [])
          .map((option) => field.options.get(option.gid))
          .filter((id): id is string => Boolean(id));
        return optionIds.length ? { ...empty, optionIds } : null;
      }
      case CustomFieldType.PEOPLE: {
        const userIds: string[] = [];
        for (const user of value.people_value ?? []) {
          const person = await this.personOf(user);
          if (person) userIds.push(person.id);
        }
        return userIds.length ? { ...empty, userIds } : null;
      }
      default:
        return null;
    }
  }

  /** Asana's actual time, as one entry; a later run corrects it in place. */
  private async importTime(
    task: AsanaTask,
    taskId: string,
    assignee: Person | undefined,
    day: Date | null,
  ): Promise<void> {
    const minutes = Math.round(task.actual_time_minutes ?? 0);
    if (minutes <= 0) return;

    const data = { minutes, userId: assignee?.id ?? null, note: 'Imported from Asana' };
    await this.upsert(
      'time_entry',
      task.gid,
      (id) => this.prisma.timeEntry.update({ where: { id }, data }),
      () =>
        this.prisma.timeEntry.create({
          data: { ...data, workspaceId: this.workspaceId, taskId, date: day ?? new Date() },
          select: { id: true },
        }),
    );
  }

  // -------------------------------------------------------------------------
  // Subtasks
  // -------------------------------------------------------------------------

  /**
   * Every top-level task's subtasks. CoreTask nests one level, so a subtask's
   * own subtasks are placed under the top-level task too and counted as
   * flattened.
   */
  private async importSubtasks(topLevel: DetailItem[]): Promise<DetailItem[]> {
    const items: DetailItem[] = [...topLevel];
    const parents = await this.prisma.task.findMany({
      where: { id: { in: topLevel.map((item) => item.taskId) } },
      select: { id: true, projectId: true },
    });
    const projectOf = new Map(parents.map((task) => [task.id, task.projectId]));

    const parentsWithSubtasks = topLevel.filter((item) => item.subtasks > 0);
    await pool(parentsWithSubtasks, this.deps.concurrency, async (item) => {
      try {
        await this.importChildren(
          item.gid,
          item.taskId,
          projectOf.get(item.taskId) ?? null,
          items,
          0,
        );
      } catch (error) {
        this.fail('subtasks', { gid: item.gid, name: item.name }, error);
      }
    });
    return items;
  }

  private async importChildren(
    asanaParentGid: string,
    parentTaskId: string,
    projectId: string | null,
    items: DetailItem[],
    depth: number,
  ): Promise<void> {
    const children = await this.asana.list<AsanaTask>(`/tasks/${asanaParentGid}/subtasks`, {
      opt_fields: TASK_FIELDS,
    });
    const counter = this.counter('subtasks');

    for (const [index, child] of children.entries()) {
      try {
        const taskId = await this.importTask(
          child,
          { taskId: parentTaskId, projectId, position: (index + 1) * POSITION_STEP },
          null,
        );
        items.push({
          gid: child.gid,
          taskId,
          name: child.name ?? '',
          subtasks: 0,
          isSubtask: true,
        });
        counter.done += 1;
        if (depth > 0) this.counter('flattened').done += 1;

        if ((child.num_subtasks ?? 0) > 0) {
          counter.total = (counter.total ?? 0) + (child.num_subtasks ?? 0);
          await this.importChildren(child.gid, parentTaskId, projectId, items, depth + 1);
        }
      } catch (error) {
        this.fail('subtask', child, error);
      }
      await this.progress();
    }
  }

  // -------------------------------------------------------------------------
  // Comments and files
  // -------------------------------------------------------------------------

  /**
   * Each task's comments, and its files when its history says it has any.
   * Asana has no count of either, so every task's stories are read; system
   * stories ("assigned", "marked complete") are not kept.
   */
  private async importHistory(items: DetailItem[]): Promise<void> {
    const withHistory = await this.subtasksWithHistory();
    const todo = withHistory
      ? items.filter((item) => !item.isSubtask || withHistory.has(item.gid))
      : items;
    const counter = this.counter('history');
    counter.total = todo.length;
    this.counter('historySkipped').done = items.length - todo.length;

    await pool(todo, this.deps.concurrency, async (item) => {
      try {
        const stories = await this.asana.list<AsanaStory>(`/tasks/${item.gid}/stories`, {
          opt_fields: STORY_FIELDS,
        });
        for (const story of stories) {
          if (story.resource_subtype !== 'comment_added') continue;
          try {
            await this.importComment(story, item.taskId);
          } catch (error) {
            this.fail('comment', { gid: story.gid, name: item.name }, error);
          }
        }
        if (stories.some((story) => story.resource_subtype === 'attachment_added')) {
          await this.importAttachments(item);
        }
        counter.done += 1;
      } catch (error) {
        this.fail('history', { gid: item.gid, name: item.name }, error);
      }
      await this.progress();
    });
  }

  /**
   * The subtasks that have a file or a comment, by Asana's search, or null to
   * read every subtask's history.
   *
   * Asana has no count of either on a task, so the plain way is one call per
   * task — and the stories endpoint is the one Asana's cost limit bites on:
   * an organisation of a hundred thousand rule-made checklist subtasks, few
   * of them ever commented on, takes most of a day to read that way. Search
   * answers "which have files" and "which has anyone commented on" a hundred
   * at a time. It needs a paid Asana plan; without it, every subtask is read.
   *
   * A comment from someone no longer in the Asana workspace is the one thing
   * the commenter search cannot see; a subtask whose only comment is theirs
   * keeps it in Asana and not here.
   */
  private async subtasksWithHistory(): Promise<Set<string> | null> {
    const found = new Set<string>();
    const people = [...this.people.keys()];
    const filters: AsanaParams[] = [{ has_attachment: true }];
    for (let index = 0; index < people.length; index += SEARCH_PEOPLE_PER_QUERY) {
      filters.push({
        'commented_on_by.any': people.slice(index, index + SEARCH_PEOPLE_PER_QUERY).join(','),
      });
    }

    try {
      for (const filter of filters) {
        for (const gid of await this.searchSubtasks(filter)) found.add(gid);
      }
    } catch (error) {
      /*
       * Only Asana saying no means this organisation has no search. Anything
       * else — a connection that stayed down through every retry, a 5xx — is
       * not a reason to spend the rest of the day reading every subtask: the
       * run ends, saying why, and syncing again finishes it.
       */
      if (!searchRefused(error)) {
        throw new Error(`Asana search did not answer: ${readableError(error)}`);
      }
      this.deps.logger.warn(
        { runId: this.runId, err: readableError(error) },
        'Asana search unavailable; reading every subtask’s history',
      );
      this.counter('historySearch').skipped = 1;
      return null;
    }

    this.counter('historySearch').done = found.size;
    return found;
  }

  /**
   * Every subtask matching `filter`. Search has no page token; results come
   * oldest first and the next page starts just before the last one's
   * creation time, with the overlap dropped by gid.
   */
  private async searchSubtasks(filter: AsanaParams): Promise<Set<string>> {
    const gids = new Set<string>();
    let after: string | undefined;

    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const rows = await this.asana.get<AsanaTask[]>(
        `/workspaces/${this.asanaWorkspaceGid}/tasks/search`,
        {
          ...filter,
          is_subtask: true,
          sort_by: 'created_at',
          sort_ascending: true,
          limit: SEARCH_PAGE_SIZE,
          opt_fields: 'created_at',
          'created_at.after': after,
        },
      );
      const before = gids.size;
      for (const row of rows) gids.add(row.gid);

      const last = instant(rows.at(-1)?.created_at);
      if (rows.length < SEARCH_PAGE_SIZE || gids.size === before || !last) break;
      after = new Date(last.getTime() - 1).toISOString();
    }
    return gids;
  }

  private async importComment(story: AsanaStory, taskId: string): Promise<void> {
    const author = await this.personOf(story.created_by);
    let body = commentBody(story, this.person);
    if (!body) return;
    if (!author) {
      // Nobody to credit: the starter posts it, saying whose words they are.
      const name = clip(story.created_by?.name, 120, 'someone');
      body = `<p><em>${escapeText(name)} wrote in Asana:</em></p>${body}`;
    }

    const createdAt = instant(story.created_at) ?? new Date();
    const data = {
      body,
      pinnedAt: story.is_pinned ? createdAt : null,
      pinnedById: story.is_pinned ? (author?.id ?? this.starterId) : null,
    };
    const commentId = await this.upsert(
      'story',
      story.gid,
      (id) => this.prisma.comment.update({ where: { id }, data }),
      () =>
        this.prisma.comment.create({
          data: {
            ...data,
            workspaceId: this.workspaceId,
            authorId: author?.id ?? this.starterId,
            taskId,
            createdAt,
          },
          select: { id: true },
        }),
      story,
    );

    const mentioned = [...body.matchAll(/data-mention="([0-9a-f-]{36})"/g)].map(
      (m) => m[1] as string,
    );
    if (mentioned.length) {
      await this.prisma.commentMention.createMany({
        data: [...new Set(mentioned)].map((userId) => ({ commentId, userId, createdAt })),
        skipDuplicates: true,
      });
    }

    const likers: string[] = [];
    for (const like of story.likes ?? []) {
      const person = await this.personOf(like.user);
      if (person) likers.push(person.id);
    }
    if (likers.length) {
      await this.prisma.commentLike.createMany({
        data: likers.map((userId) => ({ commentId, userId })),
        skipDuplicates: true,
      });
    }
    this.counter('comments').done += 1;
  }

  /**
   * Files Asana holds are copied into CoreTask's storage; files that live
   * elsewhere (Drive, Dropbox, a link) are listed at the end of the
   * description, since there are no bytes to copy.
   */
  private async importAttachments(item: DetailItem): Promise<void> {
    const attachments = await this.asana.list<AsanaAttachment>('/attachments', {
      parent: item.gid,
      opt_fields: ATTACHMENT_FIELDS,
    });
    const links: { name: string; url: string }[] = [];
    const counter = this.counter('attachments');

    for (const attachment of attachments) {
      if (attachment.host !== 'asana') {
        const url = attachment.view_url ?? attachment.permanent_url;
        if (url) links.push({ name: clip(attachment.name, LIMITS.filename, 'File'), url });
        continue;
      }
      if (this.ref('attachment', attachment.gid)) continue;
      // An empty file has nothing to copy, and a link to it opens nothing:
      // counted, not reported as a file left behind.
      if (attachment.size === 0) {
        this.counter('emptyFiles').done += 1;
        continue;
      }

      try {
        await this.copyAttachment(attachment, item.taskId);
        counter.done += 1;
      } catch (error) {
        counter.skipped = (counter.skipped ?? 0) + 1;
        this.fail('attachment', { gid: attachment.gid, name: attachment.name ?? item.name }, error);
        // Too large, or a type CoreTask refuses: the task still points at it in Asana.
        const url = attachment.permanent_url ?? attachment.view_url;
        if (url) links.push({ name: clip(attachment.name, LIMITS.filename, 'File'), url });
      }
    }

    if (links.length) {
      const task = await this.prisma.task.findUniqueOrThrow({
        where: { id: item.taskId },
        select: { description: true },
      });
      // Sanitised again: an "external" attachment's address is whatever
      // someone typed into Asana, `javascript:` included.
      await this.prisma.task.update({
        where: { id: item.taskId },
        data: {
          description:
            normalizeRichText(`${task.description ?? ''}${linkedFilesHtml(links)}`) ?? null,
        },
      });
      this.counter('links').done += links.length;
    }
  }

  private async copyAttachment(attachment: AsanaAttachment, taskId: string): Promise<void> {
    const { storage } = this.deps;
    const filename = clip(attachment.name?.replace(/[\\/]/g, '_'), LIMITS.filename, 'attachment');
    if ((attachment.size ?? 0) > storage.maxFileSizeBytes) {
      throw new Error(`Larger than the ${storage.maxFileSizeBytes / 1024 / 1024} MB file limit.`);
    }
    if (!attachment.download_url) throw new Error('Asana gave no download address.');

    const file = await this.asana.download(attachment.download_url, storage.maxFileSizeBytes);
    const mimeType =
      file.contentType.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';
    // Throws for a type CoreTask does not accept, as an upload would be refused.
    storage.assertUploadAllowed({ filename, mimeType, sizeBytes: file.body.length });

    const objectKey = storage.buildObjectKey(this.workspaceId, filename);
    await storage.putObject(objectKey, file.body, mimeType);
    const created = await this.prisma.attachment.create({
      data: {
        workspaceId: this.workspaceId,
        uploaderId: null,
        taskId,
        filename,
        mimeType,
        sizeBytes: file.body.length,
        objectKey,
        status: AttachmentStatus.READY,
        createdAt: instant(attachment.created_at) ?? undefined,
      },
      select: { id: true },
    });
    const { download_url: _signed, ...kept } = attachment;
    await this.remember('attachment', attachment.gid, created.id, kept);
  }

  // -------------------------------------------------------------------------
  // Finishing
  // -------------------------------------------------------------------------

  private async importDependencies(): Promise<void> {
    const rows: { blockedTaskId: string; blockingTaskId: string }[] = [];
    for (const [gid, blockers] of this.dependencies) {
      const blockedTaskId = this.ref('task', gid);
      if (!blockedTaskId) continue;
      for (const blocker of blockers) {
        const blockingTaskId = this.ref('task', blocker);
        if (blockingTaskId && blockingTaskId !== blockedTaskId)
          rows.push({ blockedTaskId, blockingTaskId });
      }
    }
    if (rows.length) {
      await this.prisma.taskDependency.createMany({
        data: rows.map((row) => ({
          ...row,
          workspaceId: this.workspaceId,
          createdById: this.starterId,
        })),
        skipDuplicates: true,
      });
    }
    this.counter('dependencies').done = rows.length;
  }

  /**
   * Asana lets an assignee see their task in a project they are not a member
   * of; CoreTask grants access by project. So whoever is assigned work in a
   * private project joins it as an editor, rather than owning a task they
   * cannot open.
   */
  private async grantAssigneesAccess(): Promise<void> {
    if (this.privateProjects.size === 0) return;

    const assignments = await this.prisma.task.findMany({
      where: {
        workspaceId: this.workspaceId,
        projectId: { in: [...this.privateProjects] },
        assigneeId: { not: null },
      },
      select: { projectId: true, assigneeId: true },
      distinct: ['projectId', 'assigneeId'],
    });
    const result = await this.prisma.projectMember.createMany({
      data: assignments.map((row) => ({
        projectId: row.projectId as string,
        userId: row.assigneeId as string,
        workspaceId: this.workspaceId,
        role: ProjectMemberRole.EDITOR,
        addedById: this.starterId,
      })),
      skipDuplicates: true,
    });
    this.counter('assigneesAddedToProjects').done = result.count;
  }

  private async recordActivity(): Promise<void> {
    const projects = this.counter('projects').done;
    const tasks = this.counter('tasks').done + this.counter('subtasks').done;
    await this.prisma.activityLog.create({
      data: {
        workspaceId: this.workspaceId,
        actorId: this.starterId,
        action: ActivityAction.UPDATED,
        entity: ActivityEntity.WORKSPACE,
        entityId: this.workspaceId,
        summary: `Imported ${projects} projects and ${tasks} tasks from Asana`,
        metadata: { source: 'asana', runId: this.runId, errors: this.errorCount },
      },
    });
  }
}

/** Runs `worker` over `items`, at most `size` at a time. `worker` handles its own errors. */
export async function pool<T>(
  items: readonly T[],
  size: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(size, 1), items.length) }, async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Asana answered the search and refused it: 402 on a plan without search, or
 * another 4xx. A 429 that outlasted its retries is load, not a refusal.
 */
function searchRefused(error: unknown): boolean {
  return (
    error instanceof AsanaApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

/**
 * What went wrong, for the run's list. Prisma's own message opens with the
 * call site and a code frame from the build; the part worth reading is the
 * database's message at the end.
 */
export function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes('invocation in')) return message.trim();

  const database = /message: "([^"]+)"/.exec(message)?.[1];
  if (database) return database;
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? 'The database refused the write.';
}

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
