import { createHash } from 'node:crypto';

import {
  ActivityAction,
  ActivityEntity,
  AttachmentStatus,
  AutomationRuleStatus,
  CustomFieldType,
  POSITION_STEP,
  ProjectMemberRole,
  ProjectStatus,
  TaskStatus,
  WorkspaceRole,
  tagNameKey,
} from '@coretask/contracts';
import { deriveProjectKey } from '@coretask/validation';
import type { Logger } from '@nestjs/common';
import {
  ImportRunStatus,
  ImportSource,
  Prisma,
  ProjectViewScope,
  ProjectViewType,
} from '@prisma/client';

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
  AsanaTag,
  AsanaTask,
  AsanaTaskTemplate,
  AsanaTeam,
  AsanaUser,
  AsanaWorkspaceMembership,
} from '../../integrations/asana/asana.types';
import type { StorageService } from '../../integrations/storage/storage.service';
import { normalizeRichText } from '../../common/utils/rich-text.util';
import { readSnapshot, ruleAssignees } from '../automations/versions/rule-snapshot';
import { descendantIds } from '../tasks/task-tree';

import {
  LIMITS,
  approvalStatus,
  calendarDate,
  clip,
  colorToken,
  commentBody,
  description,
  fieldDefinition,
  inlineImageGids,
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
  type ImageLookup,
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
  // Named, so a task's snapshot can still find a tag Asana has since deleted.
  'tags.name',
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
const TAG_FIELDS = 'name,color';
const TASK_TEMPLATE_FIELDS = 'name,template,created_by';
const STORY_FIELDS =
  'resource_subtype,text,html_text,created_at,created_by.name,created_by.email,is_pinned,likes.user';
const ATTACHMENT_FIELDS = 'name,host,size,download_url,view_url,permanent_url,created_at';

/** Search's page size, which is also its ceiling. */
const SEARCH_PAGE_SIZE = 100;
/** A bound on one search's pages: 100,000 tasks. */
const MAX_SEARCH_PAGES = 1_000;
/** A List view column as its settings store it. */
interface ViewColumn {
  field: string;
  width?: number;
  isPinned?: boolean;
}

const TITLE = 'title';
const ASSIGNEE = 'assigneeId';
const DUE_DATE = 'dueDate';
const TAGS = 'tags';
/** CoreTask's own fields Asana has no counterpart for: always empty on its tasks. */
const NOT_IN_ASANA = new Set(['priority', 'status', 'startDate', 'estimatedMinutes']);
/** The view settings' own ceiling (`viewSettingsSchema`). */
const MAX_VIEW_COLUMNS = 50;

/** How far live sync walks up to a subtask's parent that is not here yet. */
const MAX_LIVE_DEPTH = 5;
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

/** Where a task goes. */
interface Placement {
  projectId: string | null;
  sectionId: string | null;
  parentTaskId: string | null;
  /** Its place; null keeps a task that is already here where it is, and puts a new one last. */
  position: number | null;
}

/** A task live sync changed, for the caller to announce. */
/** What live sync's look at the workspace's fields, tags and projects changed. */
export interface DefinitionChanges {
  /** Fields whose definition changed: every project using one is told. */
  fieldIds: string[];
  createdProjectIds: string[];
  updatedProjectIds: string[];
}

/** What a project's events were about. */
export type ProjectPart = 'details' | 'fields' | 'members';

export interface LiveChange {
  taskId: string;
  /** Every project the task shows in: home and linked. */
  projectIds: string[];
}

/** A task already in CoreTask, waiting for its comments and files. */
/** Which of a task's stories a history read writes; its changes always. */
interface HistoryParts {
  comments: boolean;
  files: boolean;
}

const WHOLE_HISTORY: HistoryParts = { comments: true, files: true };
/** A task live sync read because it changed, not because of a comment or a file. */
const CHANGES_ONLY: HistoryParts = { comments: false, files: false };

/** The activity line an Asana story about a change becomes, where one says more than "updated". */
const HISTORY_ACTIONS: Record<string, ActivityAction> = {
  assigned: ActivityAction.ASSIGNED,
  unassigned: ActivityAction.UNASSIGNED,
  marked_complete: ActivityAction.STATUS_CHANGED,
  marked_incomplete: ActivityAction.STATUS_CHANGED,
};

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
  /** Projects whose task list Asana refused this run: their tasks were not looked for. */
  private readonly unlistedProjects = new Set<string>();
  /** Refs (`type:gid`) of records an earlier run found deleted in Asana. */
  private readonly sourceDeleted = new Set<string>();
  private readonly tags = new Map<string, string>();
  /** Tags asked for by gid, once each. */
  private readonly pendingTagGids = new Map<string, Promise<string | undefined>>();
  private readonly projectGids = new Set<string>();
  private readonly dependencies = new Map<string, string[]>();
  private readonly counts: Record<string, Counter | number> = {};
  private readonly errors: ImportError[] = [];
  private errorCount = 0;
  private phase = 'starting';
  private lastProgressAt = 0;
  private readonly person: PersonLookup = (gid) => this.people.get(gid);
  private readonly image: ImageLookup = (gid) => this.ref('attachment', gid);
  /** Tasks whose text embeds a file not copied yet: written again once it is. */
  private readonly waitingImages = new Map<string, string>();
  /** Fields read again this run because a value named an option they lacked. */
  private readonly refreshedFields = new Map<string, Promise<FieldRef>>();

  constructor(
    private readonly deps: AsanaImportDeps,
    /** The run row progress is written to; null for live sync, which has none. */
    private readonly runId: string | null,
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
    await this.step('deleted', () => this.archiveDeleted());
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
    if (!this.runId) return;
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
      select: { entityType: true, externalId: true, entityId: true, sourceDeletedAt: true },
    });
    for (const row of rows) {
      const key = `${row.entityType}:${row.externalId}`;
      this.refs.set(key, row.entityId);
      if (row.sourceDeletedAt) this.sourceDeleted.add(key);
    }
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
    const key = `${type}:${gid}`;
    // Asana has it again, so it is no longer deleted there.
    const returned = this.sourceDeleted.delete(key);
    if (snapshot === undefined && !returned && this.refs.get(key) === entityId) return;
    const data = {
      ...(snapshot === undefined ? {} : { snapshot: snapshot as Prisma.InputJsonValue }),
      ...(returned ? { sourceDeletedAt: null } : {}),
    };
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
    this.refs.set(key, entityId);
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
    const tags = await this.asana.list<AsanaTag>(`/workspaces/${this.asanaWorkspaceGid}/tags`, {
      opt_fields: TAG_FIELDS,
    });
    for (const tag of tags) {
      try {
        await this.saveAsanaTag(tag);
      } catch (error) {
        this.fail('tag', tag, error);
      }
    }
    this.counter('tags').done = tags.length;
  }

  /**
   * One of Asana's tags, kept by its ref, so a tag renamed or recoloured
   * there is renamed or recoloured here rather than made again under its new
   * name. One from before refs were kept is found by its name. A new name
   * another tag here already has is left alone: the two are not merged.
   */
  private async saveAsanaTag(tag: AsanaTag): Promise<string> {
    const name = clip(tag.name, LIMITS.tagName, 'Tag');
    const nameKey = tagNameKey(name);
    const color = colorToken(tag.color ?? null);

    const known = this.ref('tag', tag.gid);
    const current = known
      ? await this.prisma.tag.findUnique({
          where: { id: known },
          select: { id: true, name: true, nameKey: true, color: true },
        })
      : null;
    let id: string;
    if (current) {
      id = current.id;
      const taken =
        current.nameKey !== nameKey &&
        (await this.prisma.tag.findUnique({
          where: { workspaceId_nameKey: { workspaceId: this.workspaceId, nameKey } },
          select: { id: true },
        })) !== null;
      const rename = !taken && current.name !== name;
      if (rename || current.color !== color) {
        await this.prisma.tag.update({
          where: { id },
          data: { ...(rename ? { name, nameKey } : {}), color },
        });
      }
    } else {
      id = await this.ensureTag(name, tag.color ?? null);
    }

    await this.remember('tag', tag.gid, id, tag);
    this.tags.set(tag.gid, id);
    return id;
  }

  /** A tag a task names that this run has not seen: made since it started. */
  private tagOf(gid: string): Promise<string | undefined> {
    let pending = this.pendingTagGids.get(gid);
    if (!pending) {
      pending = this.asana
        .get<AsanaTag>(`/tags/${gid}`, { opt_fields: TAG_FIELDS })
        .then((tag) => this.saveAsanaTag(tag))
        .catch((error: unknown) => {
          this.fail('tag', { gid }, error);
          return undefined;
        });
      this.pendingTagGids.set(gid, pending);
    }
    return pending;
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
    const projects = await this.listProjects();
    const counter = this.counter('projects');
    counter.total = projects.length;
    const keys = await this.projectKeys();

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

  /** Every project the token can see, archived ones after the rest. */
  private async listProjects(): Promise<AsanaProject[]> {
    return [
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
  }

  /** The keys projects here already have, which a new one must not repeat. */
  private async projectKeys(): Promise<Set<string>> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId: this.workspaceId },
      select: { key: true },
    });
    return new Set(projects.map((project) => project.key));
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

    await this.importProjectMembers(project, projectId, lead);
    await this.importSections(project, projectId);
    await this.importProjectFields(project, projectId);
    await this.layoutListView(project, projectId);
    await this.importStatusUpdates(project, projectId);
    await this.importTaskTemplates(project, projectId);
  }

  /**
   * The project's task templates, offered in its Add menu. Asana's give the
   * task's name, description, kind, due date (days after it is made) and
   * subtasks' names, which is what a CoreTask template holds. One deleted in
   * Asana goes; one made in CoreTask has no ref and stays.
   */
  private async importTaskTemplates(project: AsanaProject, projectId: string): Promise<void> {
    let templates: AsanaTaskTemplate[];
    try {
      templates = await this.asana.list<AsanaTaskTemplate>('/task_templates', {
        project: project.gid,
        opt_fields: TASK_TEMPLATE_FIELDS,
      });
    } catch (error) {
      // A plan or a project without task templates: nothing to bring.
      if (error instanceof AsanaApiError && [402, 403, 404].includes(error.status)) return;
      this.fail('task_templates', project, error);
      return;
    }

    const kept = new Set<string>();
    for (const template of templates) {
      try {
        kept.add(await this.saveTaskTemplate(template, projectId));
      } catch (error) {
        this.fail('task_template', template, error);
      }
    }

    const known = [...this.refs]
      .filter(([key]) => key.startsWith('task_template:'))
      .map(([, id]) => id)
      .filter((id) => !kept.has(id));
    if (known.length > 0) {
      await this.prisma.taskTemplate.deleteMany({ where: { projectId, id: { in: known } } });
    }
  }

  private async saveTaskTemplate(template: AsanaTaskTemplate, projectId: string): Promise<string> {
    const task = template.template ?? {};
    const creator = await this.personOf(template.created_by);
    const name = clip(template.name, LIMITS.templateName, 'Template');
    const data = {
      name,
      title: clip(task.name, LIMITS.taskTitle, name),
      description: description(task.html_description ?? null, this.person),
      kind: taskKind(task.task_resource_subtype ?? undefined),
      dueInDays: typeof task.relative_due_on === 'number' ? task.relative_due_on : null,
      subtasks: (task.subtasks ?? [])
        .map((subtask) => clip(subtask.name, LIMITS.taskTitle, ''))
        .filter(Boolean)
        .map((title) => ({ title })),
    };
    this.counter('taskTemplates').done += 1;
    return this.upsert(
      'task_template',
      template.gid,
      (id) => this.prisma.taskTemplate.update({ where: { id }, data: { ...data, projectId } }),
      () =>
        this.prisma.taskTemplate.create({
          data: {
            ...data,
            workspaceId: this.workspaceId,
            projectId,
            createdById: creator?.id ?? this.starterId,
          },
          select: { id: true },
        }),
      template,
    );
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

  /**
   * The project's List view laid out as Asana lists a project: the task, its
   * assignee and due date, the project's fields in Asana's order, then tags.
   * CoreTask's own Priority, Status, Start date and Estimate are left out:
   * Asana has none of them, so for its tasks they would only ever be empty.
   * Widths and pins already set are kept, and so is any other column someone
   * added here.
   *
   * Once per project. Later runs only add fields Asana has added since, so a
   * column someone hid or moved stays as they left it. The layout's ref keeps
   * which fields it has placed.
   */
  private async layoutListView(project: AsanaProject, projectId: string): Promise<void> {
    const attached = await this.prisma.projectCustomField.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      select: { customFieldId: true },
    });
    const fieldColumns = attached.map((row) => `custom:${row.customFieldId}`);

    const view = await this.prisma.projectView.findFirst({
      where: {
        projectId,
        type: ProjectViewType.LIST,
        scope: ProjectViewScope.PROJECT,
        isDefault: true,
      },
    });
    const layout = await this.prisma.externalRef.findUnique({
      where: {
        workspaceId_source_entityType_externalId: {
          workspaceId: this.workspaceId,
          source: ImportSource.ASANA,
          entityType: 'list_layout',
          externalId: project.gid,
        },
      },
      select: { entityId: true, snapshot: true },
    });
    const settings = (view?.settings ?? {}) as Record<string, unknown>;
    const current = Array.isArray(settings['columns']) ? (settings['columns'] as ViewColumn[]) : [];

    let columns: ViewColumn[];
    if (!view || layout?.entityId !== view.id) {
      const asanaOrder = [TITLE, ASSIGNEE, DUE_DATE, ...fieldColumns, TAGS];
      const set = new Map(current.map((column) => [column.field, column]));
      const extras = current.filter(
        (column) => !asanaOrder.includes(column.field) && !NOT_IN_ASANA.has(column.field),
      );
      columns = [...asanaOrder.map((field) => set.get(field) ?? { field }), ...extras];
    } else {
      const placed = new Set(((layout.snapshot ?? {}) as { fields?: string[] }).fields ?? []);
      const present = new Set(current.map((column) => column.field));
      const added = fieldColumns.filter((field) => !placed.has(field) && !present.has(field));
      if (added.length === 0) {
        await this.remember('list_layout', project.gid, view.id, { fields: fieldColumns });
        return;
      }
      const tags = current.findIndex((column) => column.field === TAGS);
      const at = tags === -1 ? current.length : tags;
      columns = [
        ...current.slice(0, at),
        ...added.map((field) => ({ field })),
        ...current.slice(at),
      ];
    }
    columns = columns.slice(0, MAX_VIEW_COLUMNS);

    const viewId = view
      ? (
          await this.prisma.projectView.update({
            where: { id: view.id },
            data: { settings: { ...settings, columns } as unknown as Prisma.InputJsonValue },
            select: { id: true },
          })
        ).id
      : (
          await this.prisma.projectView.create({
            data: {
              workspaceId: this.workspaceId,
              projectId,
              name: 'List',
              type: ProjectViewType.LIST,
              scope: ProjectViewScope.PROJECT,
              isDefault: true,
              position: 0,
              settings: {
                columns,
                filters: { combinator: 'AND', conditions: [] },
                sorts: [],
                groupBy: null,
                density: 'COMFORTABLE',
                showCompleted: true,
              } as unknown as Prisma.InputJsonValue,
            },
            select: { id: true },
          })
        ).id;
    await this.remember('list_layout', project.gid, viewId, { fields: fieldColumns });
    this.counter('listViewsLaidOut').done += 1;
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
        this.unlistedProjects.add(project.gid);
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
    const home = parent
      ? { projectId: parent.projectId, sectionId: null as string | null, position: parent.position }
      : this.homeOf(task, listed!);
    return this.saveTask(
      task,
      { ...home, parentTaskId: parent?.taskId ?? null },
      (projectGid) => listed?.order.get(projectGid) ?? 0,
    );
  }

  /**
   * One task as Asana has it, with everything it carries inline: tags,
   * followers, likes, custom field values, other projects and time spent.
   * `orderIn` gives its index in another project's list, or null to keep the
   * place it has there.
   */
  private async saveTask(
    task: AsanaTask,
    placement: Placement,
    orderIn: (projectGid: string) => number | null,
  ): Promise<string> {
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
      parentTaskId: placement.parentTaskId,
      title: clip(task.name, LIMITS.taskTitle, 'Untitled task'),
      description: description(task.html_notes, this.person, this.image),
      status: done ? TaskStatus.DONE : TaskStatus.TODO,
      completedAt: done ? (instant(task.completed_at) ?? new Date()) : null,
      assigneeId: assignee?.id ?? null,
      startDate: start.date,
      startAt: start.at,
      dueDate: due.date,
      dueAt: due.at,
      kind,
      approvalStatus: approvalStatus(kind, task.approval_status),
    };

    if (inlineImageGids(task.html_notes).some((gid) => !this.image(gid))) {
      this.waitingImages.set(task.gid, task.html_notes ?? '');
    }

    // Back out of Asana's trash: an earlier run archived it when it was deleted.
    const restored = this.sourceDeleted.has(`task:${task.gid}`);
    // Read before the write below replaces it.
    const before = await this.previousTask(task.gid);
    const taskId = await this.upsert(
      'task',
      task.gid,
      async (id) => {
        await this.prisma.task.update({
          where: { id },
          data: {
            ...data,
            ...(placement.position === null ? {} : { position: placement.position }),
            ...(restored ? { archivedAt: null } : {}),
          },
        });
        if (restored) this.counter('restored').done += 1;
      },
      async () =>
        this.prisma.task.create({
          data: {
            ...data,
            position: placement.position ?? (await this.lastPosition(placement)),
            workspaceId: this.workspaceId,
            createdById: creator?.id ?? this.starterId,
            createdAt: instant(task.created_at) ?? undefined,
          },
          select: { id: true },
        }),
      task,
    );

    await this.importOtherProjects(task, orderIn, taskId, placement.projectId, before);
    await this.importTaskTags(task, taskId, before);
    await this.importFollowersAndLikes(task, taskId, before);
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
   * The task as the last write had it, from its ref's snapshot.
   *
   * Comparing it with Asana's task now says what Asana took off since — a
   * tag, a follower, a project — and that comes off here too. Only what Asana
   * had is ever in question: a tag or a follower added in CoreTask was never
   * in the snapshot, so a sync leaves it alone.
   */
  private async previousTask(gid: string): Promise<Partial<AsanaTask> | null> {
    if (!this.ref('task', gid)) return null;
    const ref = await this.prisma.externalRef.findUnique({
      where: {
        workspaceId_source_entityType_externalId: {
          workspaceId: this.workspaceId,
          source: ImportSource.ASANA,
          entityType: 'task',
          externalId: gid,
        },
      },
      select: { snapshot: true },
    });
    const snapshot = ref?.snapshot;
    return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as Partial<AsanaTask>)
      : null;
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

  /**
   * Asana's multi-homing: each further project keeps its own section and
   * place. A project Asana took the task out of lets it go here too.
   */
  private async importOtherProjects(
    task: AsanaTask,
    orderIn: (projectGid: string) => number | null,
    taskId: string,
    homeProjectId: string | null,
    before: Partial<AsanaTask> | null,
  ): Promise<void> {
    for (const membership of task.memberships ?? []) {
      const projectGid = membership.project?.gid;
      if (!projectGid) continue;
      const projectId = this.ref('project', projectGid);
      if (!projectId || projectId === homeProjectId) continue;

      const sectionId = membership.section
        ? (this.ref('section', membership.section.gid) ?? null)
        : null;
      const order = orderIn(projectGid);
      const position = order === null ? null : (order + 1) * POSITION_STEP;
      await this.prisma.taskProject.upsert({
        where: { taskId_projectId: { taskId, projectId } },
        create: {
          taskId,
          projectId,
          sectionId,
          position:
            position ?? (await this.lastPosition({ projectId, sectionId, parentTaskId: null })),
          addedById: this.starterId,
        },
        update: position === null ? { sectionId } : { sectionId, position },
      });
      this.counter('multiHomed').done += 1;
    }

    // A project this run could not list (made private, deleted) drops out of
    // a task's memberships without the task leaving it: that link stays.
    const taken = droppedGids(
      before?.memberships?.map((membership) => membership.project),
      task.memberships?.map((membership) => membership.project),
    )
      .filter((gid) => this.projectGids.has(gid))
      .map((gid) => this.ref('project', gid))
      .filter((id): id is string => Boolean(id) && id !== homeProjectId);
    if (taken.length) {
      const { count } = await this.prisma.taskProject.deleteMany({
        where: { taskId, projectId: { in: taken } },
      });
      this.counter('unlinked').done += count;
    }
    // Out of its home in Asana, a task moves home to a project it was linked
    // to; that link is now its home and goes.
    if (homeProjectId && (before?.memberships?.length ?? 0) > 1) {
      await this.prisma.taskProject.deleteMany({ where: { taskId, projectId: homeProjectId } });
    }
  }

  private async importTaskTags(
    task: AsanaTask,
    taskId: string,
    before: Partial<AsanaTask> | null,
  ): Promise<void> {
    const tagIds: string[] = [];
    for (const tag of task.tags ?? []) {
      const id = this.tags.get(tag.gid) ?? (await this.tagOf(tag.gid));
      if (id) tagIds.push(id);
    }

    // A custom task type ("Ticket") becomes a tag of that name, so the tasks
    // stay findable as one kind without losing their custom fields.
    if (task.custom_type?.name) tagIds.push(await this.ensureTag(task.custom_type.name, null));

    if (tagIds.length) {
      await this.prisma.taskTag.createMany({
        data: tagIds.map((tagId) => ({ taskId, tagId })),
        skipDuplicates: true,
      });
    }

    // Taken off in Asana, or the tag of a type the task no longer is.
    const taken: string[] = [];
    const now = new Set((task.tags ?? []).map((tag) => tag.gid));
    for (const tag of before?.tags ?? []) {
      if (!tag?.gid || now.has(tag.gid)) continue;
      const id = this.tags.get(tag.gid) ?? (tag.name ? await this.tagNamed(tag.name) : undefined);
      if (id) taken.push(id);
    }
    const type = before?.custom_type?.name;
    if (type && type !== task.custom_type?.name) {
      const id = await this.tagNamed(type);
      if (id) taken.push(id);
    }
    const kept = new Set(tagIds);
    const off = taken.filter((id) => !kept.has(id));
    if (off.length) {
      const { count } = await this.prisma.taskTag.deleteMany({
        where: { taskId, tagId: { in: off } },
      });
      this.counter('untagged').done += count;
    }
  }

  /** A tag's id by name, without making it. */
  private async tagNamed(rawName: string): Promise<string | undefined> {
    const nameKey = tagNameKey(clip(rawName, LIMITS.tagName, 'Tag'));
    const tag = await this.prisma.tag.findUnique({
      where: { workspaceId_nameKey: { workspaceId: this.workspaceId, nameKey } },
      select: { id: true },
    });
    return tag?.id;
  }

  private async importFollowersAndLikes(
    task: AsanaTask,
    taskId: string,
    before: Partial<AsanaTask> | null,
  ): Promise<void> {
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

    // Stopped following, or took a like back, in Asana since the last write.
    const unfollowed = (
      await this.userIdsOf(droppedGids(before?.followers, task.followers))
    ).filter((userId) => !followers.includes(userId));
    if (unfollowed.length) {
      const { count } = await this.prisma.follower.deleteMany({
        where: { taskId, userId: { in: unfollowed } },
      });
      this.counter('unfollowed').done += count;
    }
    const unliked = (
      await this.userIdsOf(
        droppedGids(
          before?.likes?.map((like) => like.user),
          task.likes?.map((like) => like.user),
        ),
      )
    ).filter((userId) => !likers.includes(userId));
    if (unliked.length) {
      await this.prisma.taskLike.deleteMany({ where: { taskId, userId: { in: unliked } } });
    }
  }

  private async userIdsOf(gids: readonly string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const gid of gids) {
      const person = await this.personOf({ gid });
      if (person) ids.push(person.id);
    }
    return ids;
  }

  /**
   * Each field's value in the typed column its type reads. A field Asana
   * shows as empty clears a value an earlier run wrote.
   */
  private async importFieldValues(task: AsanaTask, taskId: string): Promise<void> {
    const cleared: string[] = [];

    for (const value of task.custom_fields ?? []) {
      const known = await this.fieldOf(value.gid);
      if (!known) continue;
      const field = await this.withOptions(value.gid, known, value);

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

  /**
   * The field again from Asana when a value names an option it did not have:
   * someone added one since the field was read. Once per field per run, or
   * per live sync pass, so a value is never cleared for want of its option.
   */
  private withOptions(
    gid: string,
    field: FieldRef,
    value: AsanaCustomFieldValue,
  ): Promise<FieldRef> {
    const named = [
      ...(value.enum_value ? [value.enum_value.gid] : []),
      ...(value.multi_enum_values ?? []).map((option) => option.gid),
    ];
    if (named.every((option) => field.options.has(option))) return Promise.resolve(field);

    let pending = this.refreshedFields.get(gid);
    if (!pending) {
      pending = this.asana
        .get<AsanaCustomField>(`/custom_fields/${gid}`, { opt_fields: FIELD_FIELDS })
        .then(async (fresh) => (await this.saveField(fresh)) ?? field)
        .catch(() => field);
      this.refreshedFields.set(gid, pending);
    }
    return pending;
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
   * Every top-level task's subtasks, at every level: a subtask's own
   * subtasks go under it, as Asana nests them. One that an earlier run laid
   * under the top-level task, when CoreTask nested one level, moves back
   * under its own parent.
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
        if (depth > 0) this.counter('nested').done += 1;

        if ((child.num_subtasks ?? 0) > 0) {
          counter.total = (counter.total ?? 0) + (child.num_subtasks ?? 0);
          await this.importChildren(child.gid, taskId, projectId, items, depth + 1);
        }
      } catch (error) {
        this.fail('subtask', child, error);
      }
      await this.progress();
    }
  }

  // -------------------------------------------------------------------------
  // Deleted in Asana
  // -------------------------------------------------------------------------

  /**
   * Tasks deleted in Asana since an earlier run, archived here.
   *
   * A task this run did not reach is not necessarily gone: it may have moved
   * to a project that did not come across, or to one the token cannot open. So
   * each is asked for by its gid, and archived only when Asana answers that
   * there is no such task (404). A subtask is settled by its parent, as it is
   * in Asana, which answers 403 rather than 404 for a deleted task's subtasks.
   * Tasks in a project whose list Asana refused this run were not looked for,
   * so they are not asked about.
   *
   * Archived, not deleted: comments and history stay, and a person can restore
   * one. A task that comes back out of Asana's trash is restored by the next
   * run (`writeTask`). One a person restores while Asana still has it deleted
   * stays restored: its ref already says Asana deleted it, so it is not asked
   * about again.
   */
  private async archiveDeleted(): Promise<void> {
    const unseen = new Map<string, string>();
    for (const [key, entityId] of this.refs) {
      if (!key.startsWith('task:') || this.sourceDeleted.has(key)) continue;
      const gid = key.slice('task:'.length);
      if (!this.writtenTasks.has(gid)) unseen.set(entityId, gid);
    }
    if (unseen.size === 0) return;

    const unlisted = new Set([...this.unlistedProjects].map((gid) => this.ref('project', gid)));
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: [...unseen.keys()] }, workspaceId: this.workspaceId, archivedAt: null },
      select: { id: true, title: true, projectId: true, parentTaskId: true },
    });
    const inQuestion = new Set(tasks.map((task) => task.id));
    const asked = tasks.filter(
      (task) =>
        !(task.parentTaskId && inQuestion.has(task.parentTaskId)) &&
        !(task.projectId && unlisted.has(task.projectId)),
    );

    const counter = this.counter('archived');
    await pool(asked, this.deps.concurrency, async (task) => {
      const gid = unseen.get(task.id) as string;
      try {
        // Still in Asana, somewhere this run did not look: left as it is.
        await this.asana.get(`/tasks/${gid}`, { opt_fields: 'gid' });
      } catch (error) {
        const status = error instanceof AsanaApiError ? error.status : null;
        try {
          if (status === 404) counter.done += await this.archiveGone(task);
          // 403: there, but not to this token. Anything else is not an answer.
          else if (status !== 403) this.fail('deleted_check', { gid, name: task.title }, error);
        } catch (writeError) {
          this.fail('deleted_check', { gid, name: task.title }, writeError);
        }
      }
      await this.progress();
    });
  }

  /** A task Asana deleted, and its subtasks at every level, archived; their refs say why. */
  private async archiveGone(task: {
    id: string;
    title: string;
    projectId: string | null;
  }): Promise<number> {
    const archivedAt = new Date();
    const ids = [task.id, ...(await descendantIds(this.prisma, [task.id]))];

    const { count } = await this.prisma.task.updateMany({
      where: { id: { in: ids }, archivedAt: null },
      data: { archivedAt },
    });
    await this.prisma.externalRef.updateMany({
      where: {
        workspaceId: this.workspaceId,
        source: ImportSource.ASANA,
        entityType: 'task',
        entityId: { in: ids },
      },
      data: { sourceDeletedAt: archivedAt },
    });
    const gone = await this.prisma.externalRef.findMany({
      where: {
        workspaceId: this.workspaceId,
        source: ImportSource.ASANA,
        entityType: 'task',
        entityId: { in: ids },
      },
      select: { externalId: true },
    });
    for (const ref of gone) this.sourceDeleted.add(`task:${ref.externalId}`);
    await this.prisma.activityLog.create({
      data: {
        workspaceId: this.workspaceId,
        actorId: this.starterId,
        action: ActivityAction.ARCHIVED,
        entity: ActivityEntity.TASK,
        entityId: task.id,
        projectId: task.projectId,
        summary: `Archived task "${clip(task.title, 400)}": deleted in Asana`,
        metadata: { source: 'asana', runId: this.runId },
      },
    });
    return count;
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
    const commented = withHistory ? await this.commentedTasks() : new Set<string>();
    const todo = withHistory
      ? items.filter(
          (item) => !item.isSubtask || withHistory.has(item.gid) || commented.has(item.taskId),
        )
      : items;
    const counter = this.counter('history');
    counter.total = todo.length;
    this.counter('historySkipped').done = items.length - todo.length;

    await pool(todo, this.deps.concurrency, async (item) => {
      try {
        await this.readHistory(item);
        counter.done += 1;
      } catch (error) {
        this.fail('history', { gid: item.gid, name: item.name }, error);
      }
      await this.progress();
    });
  }

  /**
   * The tasks with a comment here. Search finds a subtask by its comments in
   * Asana, so one whose every comment was deleted there drops out of it; its
   * history is read all the same, which is how the deletions come across.
   */
  private async commentedTasks(): Promise<Set<string>> {
    const rows = await this.prisma.comment.findMany({
      where: { workspaceId: this.workspaceId, deletedAt: null, taskId: { not: null } },
      select: { taskId: true },
      distinct: ['taskId'],
    });
    return new Set(rows.map((row) => row.taskId).filter((id): id is string => Boolean(id)));
  }

  /**
   * One task's history as Asana tells it: its comments, its files when its
   * stories say it has some, and what was changed on it ("assigned to Earl",
   * "changed the due date"). A comment Asana no longer lists was deleted
   * there, and is here too. Live sync, reading a task only because it
   * changed, writes its changes alone (`parts`).
   */
  private async readHistory(item: DetailItem, parts: HistoryParts = WHOLE_HISTORY): Promise<void> {
    const stories = await this.asana.list<AsanaStory>(`/tasks/${item.gid}/stories`, {
      opt_fields: STORY_FIELDS,
    });
    if (parts.comments) {
      for (const story of stories) {
        if (story.resource_subtype !== 'comment_added') continue;
        try {
          await this.importComment(story, item.taskId);
        } catch (error) {
          this.fail('comment', { gid: story.gid, name: item.name }, error);
        }
      }
      await this.dropDeletedComments(item.taskId, stories);
    }
    try {
      await this.importChanges(item.taskId, stories);
    } catch (error) {
      this.fail('history_changes', { gid: item.gid, name: item.name }, error);
    }
    // An image pasted into the text is a file Asana tells of in no story.
    if (
      parts.files &&
      (this.waitingImages.has(item.gid) ||
        stories.some((story) => story.resource_subtype === 'attachment_added'))
    ) {
      await this.importAttachments(item);
    }
  }

  /**
   * Asana's record of what changed on a task, as lines in the task's
   * activity, beside CoreTask's own. Each line's id is a UUID v7 made from
   * its story (`historyId`): it sorts at the time the change happened, and
   * writing it again is a duplicate the database skips, so a story costs one
   * write however often the task is read.
   */
  private async importChanges(taskId: string, stories: readonly AsanaStory[]): Promise<void> {
    const changes = stories.filter(
      (story) => story.resource_subtype && story.resource_subtype !== 'comment_added',
    );
    if (changes.length === 0) return;
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });

    const rows: Prisma.ActivityLogCreateManyInput[] = [];
    for (const story of changes) {
      const at = instant(story.created_at);
      const line = changeLine(story);
      if (!at || !line) continue;
      const actor = line.byRule ? undefined : await this.personOf(story.created_by);
      rows.push({
        id: historyId(this.workspaceId, story.gid, at),
        workspaceId: this.workspaceId,
        actorId: actor?.id ?? null,
        action: HISTORY_ACTIONS[story.resource_subtype ?? ''] ?? ActivityAction.UPDATED,
        entity: ActivityEntity.TASK,
        entityId: taskId,
        projectId: task?.projectId ?? null,
        summary: clip(line.text, LIMITS.activitySummary, 'changed this task'),
        metadata: { source: 'asana', story: story.gid, subtype: story.resource_subtype ?? null },
        createdAt: at,
      });
    }
    if (rows.length === 0) return;
    const { count } = await this.prisma.activityLog.createMany({
      data: rows,
      skipDuplicates: true,
    });
    this.counter('changeHistory').done += count;
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
    // Asana lists it again after a run took it for deleted. One deleted in
    // CoreTask stays deleted: only Asana's deletion is undone.
    const restored = this.sourceDeleted.has(`story:${story.gid}`);
    const commentId = await this.upsert(
      'story',
      story.gid,
      (id) =>
        this.prisma.comment.update({
          where: { id },
          data: { ...data, ...(restored ? { deletedAt: null } : {}) },
        }),
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

  /** The task's comments from Asana that Asana's stories no longer list. */
  private async dropDeletedComments(taskId: string, stories: readonly AsanaStory[]): Promise<void> {
    const comments = await this.prisma.comment.findMany({
      where: { taskId, deletedAt: null },
      select: { id: true },
    });
    if (comments.length === 0) return;
    const listed = new Set(stories.map((story) => story.gid));
    const refs = await this.prisma.externalRef.findMany({
      where: {
        workspaceId: this.workspaceId,
        source: ImportSource.ASANA,
        entityType: 'story',
        entityId: { in: comments.map((comment) => comment.id) },
      },
      select: { externalId: true, entityId: true },
    });
    await this.deleteComments(
      refs.filter((ref) => !listed.has(ref.externalId)).map((ref) => ref.entityId),
    );
  }

  /**
   * Comments Asana deleted, marked deleted the way CoreTask deletes one, with
   * their refs saying it was Asana. Returns how many were still showing.
   */
  private async deleteComments(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const deletedAt = new Date();
    const { count } = await this.prisma.comment.updateMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      data: { deletedAt },
    });
    await this.prisma.externalRef.updateMany({
      where: {
        workspaceId: this.workspaceId,
        source: ImportSource.ASANA,
        entityType: 'story',
        entityId: { in: [...ids] },
      },
      data: { sourceDeletedAt: deletedAt },
    });
    this.counter('commentsDeleted').done += count;
    return count;
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

    const waiting = this.waitingImages.get(item.gid);
    if (waiting !== undefined) {
      this.waitingImages.delete(item.gid);
      await this.prisma.task.update({
        where: { id: item.taskId },
        data: { description: description(waiting, this.person, this.image) },
      });
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
  // Live sync
  // -------------------------------------------------------------------------

  /**
   * Readies the run to apply single tasks between full runs: the refs, and the
   * people, fields and tags they point at. Done once, and again after a full
   * run has changed what the refs hold.
   */
  async prepareLive(): Promise<void> {
    await this.loadRefs();

    const userRefs = [...this.refs].filter(([key]) => key.startsWith('user:'));
    const users = await this.prisma.user.findMany({
      where: { id: { in: userRefs.map(([, id]) => id) } },
      select: { id: true, name: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    for (const [key, id] of userRefs) {
      const user = byId.get(id);
      if (user) this.people.set(key.slice('user:'.length), user);
    }
    for (const key of this.refs.keys()) {
      if (key.startsWith('project:')) this.projectGids.add(key.slice('project:'.length));
    }
    await this.importFields();
    await this.importTags();
  }

  /** The imported projects, whose Asana event streams live sync reads. */
  liveProjectGids(): string[] {
    return [...this.projectGids];
  }

  /** The CoreTask project an Asana project became. */
  projectIdOf(projectGid: string): string | null {
    return this.ref('project', projectGid) ?? null;
  }

  /**
   * The tasks Asana's events named, each read again and written the way a
   * full run writes it. `withHistory` names those whose comments or files
   * changed as well. Returns what changed, for the caller to announce.
   */
  async syncTasks(
    gids: readonly string[],
    withHistory: ReadonlySet<string>,
  ): Promise<LiveChange[]> {
    this.refreshedFields.clear();
    const changes: LiveChange[] = [];
    await pool([...new Set(gids)], this.deps.concurrency, async (gid) => {
      try {
        const change = await this.syncTask(gid, withHistory.has(gid), 0);
        if (change) changes.push(change);
      } catch (error) {
        this.fail('live_task', { gid }, error);
      }
    });
    if (this.dependencies.size > 0) {
      await this.importDependencies();
      this.dependencies.clear();
    }
    return changes;
  }

  /** A project's sections as Asana has them now: one was added, renamed or moved. */
  async syncSections(projectGid: string): Promise<void> {
    const projectId = this.ref('project', projectGid);
    if (projectId) await this.importSections({ gid: projectGid } as AsanaProject, projectId);
  }

  /**
   * The workspace's fields, tags and projects, each compared with the record
   * its ref kept. Asana has no event stream for these, so live sync asks
   * every few minutes, and writes again only what changed. A new project
   * comes across with its tasks; `openStream` opens its event stream first,
   * so whatever is done to it meanwhile is read on the next tick.
   *
   * A project-local field the workspace's list leaves out, and a new team,
   * wait for the next full run.
   */
  async syncDefinitions(
    openStream: (projectGid: string) => Promise<void>,
  ): Promise<DefinitionChanges> {
    const kept = await this.keptRecords(['custom_field', 'tag', 'project']);
    const changes: DefinitionChanges = {
      fieldIds: [],
      createdProjectIds: [],
      updatedProjectIds: [],
    };

    const fields = await this.asana.list<AsanaCustomField>(
      `/workspaces/${this.asanaWorkspaceGid}/custom_fields`,
      { opt_fields: FIELD_FIELDS },
    );
    for (const field of fields) {
      if (sameRecord(kept.get(`custom_field:${field.gid}`), field)) continue;
      try {
        const saved = await this.saveField(field);
        if (saved) changes.fieldIds.push(saved.id);
      } catch (error) {
        this.fail('custom_field', field, error);
      }
    }

    const tags = await this.asana.list<AsanaTag>(`/workspaces/${this.asanaWorkspaceGid}/tags`, {
      opt_fields: TAG_FIELDS,
    });
    for (const tag of tags) {
      if (sameRecord(kept.get(`tag:${tag.gid}`), tag)) continue;
      try {
        await this.saveAsanaTag(tag);
      } catch (error) {
        this.fail('tag', tag, error);
      }
    }

    let keys: Set<string> | null = null;
    for (const project of await this.listProjects()) {
      const projectId = this.ref('project', project.gid);
      if (projectId && sameRecord(kept.get(`project:${project.gid}`), project)) continue;
      try {
        keys ??= await this.projectKeys();
        if (projectId) {
          await this.importProject(project, keys);
          changes.updatedProjectIds.push(projectId);
        } else {
          await openStream(project.gid);
          changes.createdProjectIds.push(await this.importNewProject(project, keys));
        }
      } catch (error) {
        this.fail('project', project, error);
      }
    }
    return changes;
  }

  /**
   * A project Asana's events say changed. Its record is read again and
   * written when it differs from the one kept; its fields or its members are
   * read again when the events were about those. Returns the project when
   * anything was written. One deleted in Asana, or out of the token's sight,
   * is left as it is.
   */
  async syncProject(projectGid: string, parts: ReadonlySet<ProjectPart>): Promise<string | null> {
    const projectId = this.ref('project', projectGid);
    if (!projectId) return null;
    try {
      const project = await this.asana.get<AsanaProject>(`/projects/${projectGid}`, {
        opt_fields: PROJECT_FIELDS,
      });
      if (parts.has('details')) {
        const kept = await this.keptRecords(['project'], [projectGid]);
        if (!sameRecord(kept.get(`project:${projectGid}`), project)) {
          // The whole project: its members, fields and status come with it.
          await this.importProject(project, await this.projectKeys());
          return projectId;
        }
      }
      if (parts.has('fields')) {
        await this.importProjectFields(project, projectId);
        await this.layoutListView(project, projectId);
      }
      if (parts.has('members')) {
        await this.importProjectMembers(project, projectId, await this.personOf(project.owner));
      }
      return parts.has('fields') || parts.has('members') ? projectId : null;
    } catch (error) {
      if (error instanceof AsanaApiError && (error.status === 403 || error.status === 404)) {
        return null;
      }
      this.fail('project', { gid: projectGid }, error);
      return null;
    }
  }

  /**
   * A project new in Asana since the last full run, brought across as a full
   * run would: the project, then its tasks, their subtasks, comments and
   * files. A task already here from another project keeps its home there and
   * gains this one as a further project, at its place in this one's list.
   */
  private async importNewProject(project: AsanaProject, keys: Set<string>): Promise<string> {
    await this.importProject(project, keys);
    const projectId = this.ref('project', project.gid) as string;

    // Tasks written by an earlier pass are written again: this list is new.
    this.writtenTasks.clear();
    const listed = await this.listTasks([project]);
    const fresh = new Map<string, ListedTask>();
    for (const [gid, entry] of listed) {
      if (!this.ref('task', gid)) {
        fresh.set(gid, entry);
        continue;
      }
      try {
        const placement = await this.livePlacement(entry.task, 0);
        if (placement) {
          await this.saveTask(entry.task, placement, (other) => entry.order.get(other) ?? null);
        }
      } catch (error) {
        this.fail('task', entry.task, error);
      }
    }

    const items = await this.importSubtasks(await this.importTopLevel(fresh));
    await pool(items, this.deps.concurrency, async (item) => {
      try {
        await this.readHistory(item);
      } catch (error) {
        this.fail('history', { gid: item.gid, name: item.name }, error);
      }
    });
    if (this.dependencies.size > 0) {
      await this.importDependencies();
      this.dependencies.clear();
    }
    await this.grantAssigneesAccess([projectId]);
    this.counter('newProjects').done += 1;
    return projectId;
  }

  /** The records refs of these kinds keep, by `type:gid`; only these gids when given. */
  private async keptRecords(
    types: readonly string[],
    gids?: readonly string[],
  ): Promise<Map<string, unknown>> {
    const rows = await this.prisma.externalRef.findMany({
      where: {
        workspaceId: this.workspaceId,
        source: ImportSource.ASANA,
        entityType: { in: [...types] },
        ...(gids ? { externalId: { in: [...gids] } } : {}),
      },
      select: { entityType: true, externalId: true, snapshot: true },
    });
    return new Map(rows.map((row) => [`${row.entityType}:${row.externalId}`, row.snapshot]));
  }

  /**
   * Comments Asana's events said were deleted, found by their refs: Asana
   * cannot say whose they were once they are gone. Returns their tasks.
   */
  async removeComments(storyGids: readonly string[]): Promise<LiveChange[]> {
    const ids = storyGids
      .map((gid) => this.ref('story', gid))
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];
    const comments = await this.prisma.comment.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, taskId: true },
    });
    if (comments.length === 0) return [];
    await this.deleteComments(comments.map((comment) => comment.id));

    const taskIds = [
      ...new Set(comments.map((comment) => comment.taskId).filter((id): id is string => !!id)),
    ];
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, projectId: true },
    });
    return tasks.map((task) => ({
      taskId: task.id,
      projectIds: task.projectId ? [task.projectId] : [],
    }));
  }

  /** The failures since the last call, for live sync's status. */
  takeFailures(): ImportError[] {
    const failures = this.errors.splice(0);
    this.errorCount = 0;
    return failures;
  }

  private async syncTask(gid: string, history: boolean, depth: number): Promise<LiveChange | null> {
    let task: AsanaTask;
    try {
      task = await this.asana.get<AsanaTask>(`/tasks/${gid}`, { opt_fields: TASK_FIELDS });
    } catch (error) {
      if (!(error instanceof AsanaApiError)) throw error;
      // Deleted in Asana: archived here, as Sync again does.
      if (error.status === 404) return this.archiveIfHere(gid);
      // Moved where the token cannot see: left as it is.
      if (error.status === 403) return null;
      throw error;
    }

    const placement = await this.livePlacement(task, depth);
    if (!placement) return null;

    const taskId = await this.saveTask(task, placement, () => null);
    // Its comments and files when the events were about those; what changed always.
    await this.readHistory(
      { gid, taskId, name: task.name ?? '', subtasks: 0, isSubtask: Boolean(task.parent) },
      history ? WHOLE_HISTORY : CHANGES_ONLY,
    );
    await this.grantAssigneeAccess(taskId);

    const projectIds = new Set<string>();
    if (placement.projectId) projectIds.add(placement.projectId);
    for (const membership of task.memberships ?? []) {
      const projectId = membership.project ? this.ref('project', membership.project.gid) : null;
      if (projectId) projectIds.add(projectId);
    }
    return { taskId, projectIds: [...projectIds] };
  }

  /**
   * Where a task Asana changed belongs here. A subtask goes under its own
   * parent, at whatever level, as a full run nests it. A top-level task stays
   * in the project it is already in while Asana still has it there. Either
   * keeps its place unless it moved, and goes last where it moved to.
   */
  private async livePlacement(task: AsanaTask, depth: number): Promise<Placement | null> {
    const existingId = this.ref('task', task.gid);
    const existing = existingId
      ? await this.prisma.task.findUnique({
          where: { id: existingId },
          select: { projectId: true, sectionId: true, parentTaskId: true },
        })
      : null;

    if (task.parent) {
      let parentId = this.ref('task', task.parent.gid);
      if (!parentId && depth < MAX_LIVE_DEPTH) {
        await this.syncTask(task.parent.gid, false, depth + 1);
        parentId = this.ref('task', task.parent.gid);
      }
      if (!parentId) return null;
      const parent = await this.prisma.task.findUnique({
        where: { id: parentId },
        select: { id: true, projectId: true },
      });
      if (!parent) return null;

      const placement = { projectId: parent.projectId, sectionId: null, parentTaskId: parent.id };
      const stays = existing?.parentTaskId === parent.id;
      return { ...placement, position: stays ? null : await this.lastPosition(placement) };
    }

    const memberships = (task.memberships ?? []).filter(
      (membership) => membership.project && this.projectGids.has(membership.project.gid),
    );
    const membership =
      memberships.find(
        (candidate) =>
          existing !== null &&
          this.ref('project', candidate.project?.gid ?? '') === existing.projectId,
      ) ?? memberships[0];
    if (!membership?.project) {
      // In no project that came across. One already here keeps its place; a
      // new one waits for the next full run, which brings its project too.
      if (!existing || existing.parentTaskId) return null;
      return {
        projectId: existing.projectId,
        sectionId: existing.sectionId,
        parentTaskId: null,
        position: null,
      };
    }

    const projectId = this.ref('project', membership.project.gid) ?? null;
    let sectionId: string | null = null;
    if (membership.section) {
      sectionId = this.ref('section', membership.section.gid) ?? null;
      if (!sectionId) {
        await this.syncSections(membership.project.gid);
        sectionId = this.ref('section', membership.section.gid) ?? null;
      }
    }
    const placement = { projectId, sectionId, parentTaskId: null };
    const stays =
      existing !== null &&
      existing.parentTaskId === null &&
      existing.projectId === projectId &&
      existing.sectionId === sectionId;
    return { ...placement, position: stays ? null : await this.lastPosition(placement) };
  }

  /** A task deleted in Asana, archived here when it came across and is not already. */
  private async archiveIfHere(gid: string): Promise<LiveChange | null> {
    const taskId = this.ref('task', gid);
    if (!taskId) return null;
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId: this.workspaceId, archivedAt: null },
      select: { id: true, title: true, projectId: true },
    });
    if (!task) return null;
    await this.archiveGone(task);
    return { taskId: task.id, projectIds: task.projectId ? [task.projectId] : [] };
  }

  /** Whoever is assigned a task joins its project, as a full run makes them. */
  private async grantAssigneeAccess(taskId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { assigneeId: true, projectId: true },
    });
    if (!task?.assigneeId || !task.projectId) return;
    await this.joinProjects([{ projectId: task.projectId, userId: task.assigneeId }]);
  }

  /** After everything already in this place, where a person's new task goes. */
  private async lastPosition(place: {
    projectId: string | null;
    sectionId: string | null;
    parentTaskId: string | null;
  }): Promise<number> {
    const tasks = await this.prisma.task.aggregate({
      where: {
        workspaceId: this.workspaceId,
        projectId: place.projectId,
        sectionId: place.sectionId,
        parentTaskId: place.parentTaskId,
        archivedAt: null,
      },
      _max: { position: true },
    });
    let last = tasks._max.position ?? 0;
    if (place.projectId && !place.parentTaskId) {
      const linked = await this.prisma.taskProject.aggregate({
        where: { projectId: place.projectId, sectionId: place.sectionId },
        _max: { position: true },
      });
      last = Math.max(last, linked._max.position ?? 0);
    }
    return last + POSITION_STEP;
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
   * Whoever Asana gives work to in a project joins it as an editor.
   *
   * Asana lets anyone in the workspace be assigned a task, or be named by a
   * rule's checklist, in a project they are not a member of. CoreTask gives a
   * project's work only to its members and the workspace's owner
   * (`project-access/assignable.ts`), and grants access by project. So the
   * assignee of a task here, and anyone the project's active rules give work
   * to, joins it — rather than holding work they cannot open, or a rule
   * leaving its subtasks unassigned. The projects this run brought, or
   * `projectIds` when given.
   */
  private async grantAssigneesAccess(projectIds?: readonly string[]): Promise<void> {
    const projects = projectIds
      ? [...projectIds]
      : [...this.projectGids]
          .map((gid) => this.ref('project', gid))
          .filter((id): id is string => Boolean(id));
    if (projects.length === 0) return;

    const [assignments, rules] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          workspaceId: this.workspaceId,
          projectId: { in: projects },
          assigneeId: { not: null },
          archivedAt: null,
        },
        select: { projectId: true, assigneeId: true },
        distinct: ['projectId', 'assigneeId'],
      }),
      this.prisma.automationRule.findMany({
        where: {
          workspaceId: this.workspaceId,
          projectId: { in: projects },
          status: AutomationRuleStatus.ACTIVE,
        },
        select: { projectId: true, publishedVersion: { select: { nodes: true } } },
      }),
    ]);
    const joined = await this.joinProjects([
      ...assignments.map((row) => ({
        projectId: row.projectId as string,
        userId: row.assigneeId as string,
      })),
      ...rules.flatMap((rule) =>
        ruleAssignees(readSnapshot(rule.publishedVersion?.nodes) ?? []).map((userId) => ({
          projectId: rule.projectId,
          userId,
        })),
      ),
    ]);
    this.counter('assigneesAddedToProjects').done += joined;
  }

  /**
   * Makes each person an editor of each project, unless they already belong
   * to it or own the workspace — the owner may be given work anywhere — or
   * have left the workspace. How many joined.
   */
  private async joinProjects(
    pairs: readonly { projectId: string; userId: string }[],
  ): Promise<number> {
    if (pairs.length === 0) return 0;
    const people = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: this.workspaceId, userId: { in: pairs.map((pair) => pair.userId) } },
      select: { userId: true, role: true },
    });
    const joinable = new Set(
      people.filter((person) => person.role !== WorkspaceRole.OWNER).map((person) => person.userId),
    );
    const result = await this.prisma.projectMember.createMany({
      data: pairs
        .filter((pair) => joinable.has(pair.userId))
        .map((pair) => ({
          projectId: pair.projectId,
          userId: pair.userId,
          workspaceId: this.workspaceId,
          role: ProjectMemberRole.EDITOR,
          addedById: this.starterId,
        })),
      skipDuplicates: true,
    });
    return result.count;
  }

  private async recordActivity(): Promise<void> {
    const projects = this.counter('projects').done;
    const tasks = this.counter('tasks').done + this.counter('subtasks').done;
    const archived = this.counter('archived').done;
    const deleted = archived > 0 ? `, and archived ${archived} deleted there` : '';
    await this.prisma.activityLog.create({
      data: {
        workspaceId: this.workspaceId,
        actorId: this.starterId,
        action: ActivityAction.UPDATED,
        entity: ActivityEntity.WORKSPACE,
        entityId: this.workspaceId,
        summary: `Imported ${projects} projects and ${tasks} tasks from Asana${deleted}`,
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

/**
 * Whether the record a ref kept and Asana's record now are the same. The
 * database keeps JSON with its keys in an order of its own, so they are
 * compared key by key, not as text.
 */
function sameRecord(kept: unknown, record: unknown): boolean {
  return kept !== undefined && kept !== null && stableJson(kept) === stableJson(record);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A story about a change, as the line CoreTask shows after its actor's name.
 * Asana's text starts with whoever made the change ("IT assigned to Earl"),
 * which CoreTask writes itself; "Asana changed Status to New" was a rule,
 * shown as CoreTask shows a rule's change, with no person.
 */
export function changeLine(story: AsanaStory): { text: string; byRule: boolean } | null {
  const text = story.text?.trim();
  if (!text) return null;
  const actor = story.created_by?.name?.trim();
  if (actor && text.startsWith(`${actor} `)) {
    return { text: text.slice(actor.length + 1), byRule: false };
  }
  if (text.startsWith('Asana ')) return { text: text.slice('Asana '.length), byRule: true };
  return { text, byRule: !story.created_by };
}

/**
 * A UUID v7 for the activity line a story becomes: its time is the story's,
 * so the line sorts among the task's others, and the rest is a hash of the
 * story, so the same story always makes the same id.
 */
export function historyId(workspaceId: string, storyGid: string, at: Date): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(Math.min(Math.max(at.getTime(), 0), 2 ** 48 - 1), 0, 6);
  createHash('sha256').update(`${workspaceId}:${storyGid}`).digest().copy(bytes, 6, 0, 10);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The gids `before` lists that `now` does not. */
function droppedGids(
  before: readonly (AsanaRef | null | undefined)[] | undefined,
  now: readonly (AsanaRef | null | undefined)[] | undefined,
): string[] {
  const kept = new Set((now ?? []).map((ref) => ref?.gid));
  const gids = (before ?? [])
    .map((ref) => ref?.gid)
    .filter((gid): gid is string => Boolean(gid) && !kept.has(gid));
  return [...new Set(gids)];
}

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
