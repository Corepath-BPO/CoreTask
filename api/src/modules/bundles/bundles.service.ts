import {
  BUNDLE_PARTS,
  BundlePart,
  MAX_BUNDLES_PER_WORKSPACE,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type {
  Bundle,
  BundleApplyResult,
  BundleRefreshResult,
  CreateBundlePayload,
} from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import {
  AutomationRuleStatus,
  type Prisma,
  type Bundle as BundleRow,
  type TaskKind,
  type TaskPriority,
} from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { AutomationsService } from '../automations/automations.service';
import {
  AutomationTemplatesService,
  type RuleSnapshot,
} from '../automations/library/automation-templates.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { ProjectAccessService } from '../project-access/project-access.service';
import { SectionsService } from '../sections/sections.service';

/** A task template as a bundle carries it: everything but its ids. */
interface TemplateSnapshot {
  name: string;
  title: string;
  description: string | null;
  kind: TaskKind;
  priority: TaskPriority | null;
  assigneeId: string | null;
  dueInDays: number | null;
  subtasks: Prisma.JsonValue;
}

/** What a bundle holds, taken from its project. */
interface Contents {
  sections: string[];
  customFieldIds: string[];
  rules: RuleSnapshot[];
  taskTemplates: TemplateSnapshot[];
}

const bundleInclude = {
  sourceProject: { select: { id: true, name: true } },
  projects: {
    include: { project: { select: { id: true, name: true } } },
    orderBy: { appliedAt: 'asc' },
  },
} satisfies Prisma.BundleInclude;

type LoadedBundle = Prisma.BundleGetPayload<{ include: typeof bundleInclude }>;

/** Names compare loosely: "Done" and "done " are the same section to anybody reading a board. */
const fold = (name: string) => name.trim().toLocaleLowerCase();

const asArray = <T>(value: Prisma.JsonValue): T[] =>
  Array.isArray(value) ? (value as unknown as T[]) : [];

const readParts = (parts: readonly string[]): BundlePart[] =>
  BUNDLE_PARTS.filter((part) => parts.includes(part));

/**
 * Bundles — Asana's Customize › Bundles.
 *
 * A bundle is taken from one project and applied to others. Applying adds the
 * sections and fields a project lacks (never removing its own) and writes the
 * bundle's rules and task templates into it, tagged so that the next apply —
 * a refresh, or a project catching up — replaces them rather than piling up
 * copies. A rule that was live where the bundle was made is published where it
 * lands if it validates there; one that does not stays a draft and is named,
 * because a rule that silently does nothing is worse than one that says why.
 *
 * Making, refreshing and applying need a manager of the projects involved, the
 * same bar a rule has. The list is open to the workspace, filtered to the
 * projects each reader can see.
 */
@Injectable()
export class BundlesService {
  private readonly logger = new Logger(BundlesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly sections: SectionsService,
    private readonly customFields: CustomFieldsService,
    private readonly automations: AutomationsService,
    private readonly ruleLibrary: AutomationTemplatesService,
  ) {}

  async list(workspaceId: string, actor: ActorContext): Promise<Bundle[]> {
    const rows = await this.prisma.bundle.findMany({
      where: { workspaceId },
      include: bundleInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return this.toDtos(workspaceId, actor, rows);
  }

  async create(
    workspaceId: string,
    actor: ActorContext,
    dto: CreateBundlePayload,
  ): Promise<Bundle> {
    await this.access.requireAccess(workspaceId, dto.sourceProjectId, actor, WorkspaceRole.MANAGER);
    if ((await this.prisma.bundle.count({ where: { workspaceId } })) >= MAX_BUNDLES_PER_WORKSPACE) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A workspace holds up to ${MAX_BUNDLES_PER_WORKSPACE} bundles.`,
      );
    }

    const parts = dto.parts?.length ? readParts(dto.parts) : [...BUNDLE_PARTS];
    const contents = await this.take(workspaceId, dto.sourceProjectId, parts);

    const row = await this.prisma.bundle.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        sourceProjectId: dto.sourceProjectId,
        parts,
        createdById: actor.userId,
        ...this.contentsData(contents),
      },
      include: bundleInclude,
    });
    return (await this.toDtos(workspaceId, actor, [row]))[0] as Bundle;
  }

  async update(
    workspaceId: string,
    bundleId: string,
    actor: ActorContext,
    dto: { name?: string; description?: string | null },
  ): Promise<Bundle> {
    this.assertMayManageBundles(actor);
    await this.require(workspaceId, bundleId);
    const row = await this.prisma.bundle.update({
      where: { id: bundleId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
      },
      include: bundleInclude,
    });
    return (await this.toDtos(workspaceId, actor, [row]))[0] as Bundle;
  }

  /**
   * Deletes the bundle. What it wrote into projects stays, as theirs: the tag
   * comes off (the foreign key nulls it), so their rules keep running and
   * their templates stay in the Add menu.
   */
  async remove(workspaceId: string, bundleId: string, actor: ActorContext): Promise<void> {
    this.assertMayManageBundles(actor);
    await this.require(workspaceId, bundleId);
    await this.prisma.bundle.delete({ where: { id: bundleId } });
  }

  /** Applies the bundle to a project — or brings a project that has it up to date. */
  async apply(
    workspaceId: string,
    bundleId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<BundleApplyResult> {
    const bundle = await this.require(workspaceId, bundleId);
    const access = await this.access.requireAccess(
      workspaceId,
      projectId,
      actor,
      WorkspaceRole.MANAGER,
    );
    // Its rules are already there, as the originals; a second copy of each
    // would fire twice on every task.
    if (bundle.sourceProjectId === projectId) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'This bundle was made from this project. Refresh it to send changes out instead.',
      );
    }
    return this.applyTo(bundle, projectId, { userId: actor.userId, role: access.effectiveRole });
  }

  /**
   * Takes the bundle off a project: its rules and task templates go, its
   * sections and fields stay — they may hold the project's work by now.
   */
  async detach(
    workspaceId: string,
    bundleId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.require(workspaceId, bundleId);
    await this.access.requireAccess(workspaceId, projectId, actor, WorkspaceRole.MANAGER);

    await this.prisma.$transaction([
      this.prisma.automationRule.deleteMany({ where: { projectId, bundleId } }),
      this.prisma.taskTemplate.deleteMany({ where: { projectId, bundleId } }),
      this.prisma.bundleProject.deleteMany({ where: { projectId, bundleId } }),
    ]);
  }

  /**
   * Retakes the bundle from its source project and reapplies it everywhere the
   * refresher may manage. Anywhere else stays on its version, and shows it is
   * behind, until one of its own managers syncs it.
   */
  async refresh(
    workspaceId: string,
    bundleId: string,
    actor: ActorContext,
  ): Promise<BundleRefreshResult> {
    const bundle = await this.require(workspaceId, bundleId);
    if (!bundle.sourceProjectId) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'The project this bundle was made from is gone, so there is nothing to refresh it from.',
      );
    }
    await this.access.requireAccess(
      workspaceId,
      bundle.sourceProjectId,
      actor,
      WorkspaceRole.MANAGER,
    );

    const contents = await this.take(workspaceId, bundle.sourceProjectId, readParts(bundle.parts));
    const updated = await this.prisma.bundle.update({
      where: { id: bundleId },
      data: { ...this.contentsData(contents), version: { increment: 1 } },
    });

    const linked = await this.prisma.bundleProject.findMany({
      where: { bundleId },
      select: { projectId: true },
    });

    const applied: BundleApplyResult[] = [];
    let skipped = 0;
    for (const { projectId } of linked) {
      const access = await this.access.findAccess(workspaceId, projectId, actor);
      if (!access || !hasAtLeastRole(access.effectiveRole, WorkspaceRole.MANAGER)) {
        skipped += 1;
        continue;
      }
      applied.push(
        await this.applyTo(updated, projectId, {
          userId: actor.userId,
          role: access.effectiveRole,
        }),
      );
    }

    return { version: updated.version, applied, skipped };
  }

  // -------------------------------------------------------------------------

  /** The parts of a project a bundle carries, as they are now. */
  private async take(
    workspaceId: string,
    projectId: string,
    parts: readonly BundlePart[],
  ): Promise<Contents> {
    const has = (part: BundlePart) => parts.includes(part);

    const [sections, fields, rules, templates] = await Promise.all([
      has(BundlePart.SECTIONS)
        ? this.prisma.section.findMany({
            where: { projectId },
            orderBy: { position: 'asc' },
            select: { name: true },
          })
        : [],
      has(BundlePart.FIELDS)
        ? this.prisma.projectCustomField.findMany({
            where: { projectId, customField: { isArchived: false } },
            orderBy: { position: 'asc' },
            select: { customFieldId: true },
          })
        : [],
      // A rule another bundle wrote belongs to that bundle, not to this one.
      has(BundlePart.RULES)
        ? this.prisma.automationRule.findMany({
            where: { projectId, bundleId: null, status: { not: AutomationRuleStatus.ARCHIVED } },
            orderBy: { createdAt: 'asc' },
            select: { id: true, _count: { select: { nodes: true } } },
          })
        : [],
      has(BundlePart.TASK_TEMPLATES)
        ? this.prisma.taskTemplate.findMany({
            where: { projectId, bundleId: null },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          })
        : [],
    ]);

    const snapshots: RuleSnapshot[] = [];
    for (const rule of rules) {
      if (rule._count.nodes === 0) continue;
      snapshots.push(await this.ruleLibrary.snapshotRule(workspaceId, projectId, rule.id));
    }

    return {
      sections: sections.map((section) => section.name),
      customFieldIds: fields.map((field) => field.customFieldId),
      rules: snapshots,
      taskTemplates: templates.map((template) => ({
        name: template.name,
        title: template.title,
        description: template.description,
        kind: template.kind,
        priority: template.priority,
        assigneeId: template.assigneeId,
        dueInDays: template.dueInDays,
        subtasks: template.subtasks,
      })),
    };
  }

  private contentsData(contents: Contents) {
    return {
      sections: contents.sections as Prisma.InputJsonValue,
      customFieldIds: contents.customFieldIds,
      rules: contents.rules as unknown as Prisma.InputJsonValue,
      taskTemplates: contents.taskTemplates as unknown as Prisma.InputJsonValue,
    };
  }

  /** Writes a bundle into one project. The caller has checked it may manage it. */
  private async applyTo(
    bundle: BundleRow,
    projectId: string,
    actor: ActorContext,
  ): Promise<BundleApplyResult> {
    const { workspaceId } = bundle;
    const result: BundleApplyResult = {
      projectId,
      sectionsAdded: 0,
      fieldsAdded: 0,
      rulesWritten: 0,
      rulesLive: 0,
      rulesNeedingAttention: [],
      templatesWritten: 0,
    };

    // Sections first: the rules below are translated against them by name.
    const present = new Set(
      (await this.prisma.section.findMany({ where: { projectId }, select: { name: true } })).map(
        (section) => fold(section.name),
      ),
    );
    for (const name of asArray<string>(bundle.sections)) {
      if (typeof name !== 'string' || present.has(fold(name))) continue;
      try {
        await this.sections.create(workspaceId, actor.userId, projectId, { name });
        present.add(fold(name));
        result.sectionsAdded += 1;
      } catch (error) {
        // A project at its section limit keeps what it has.
        this.logger.warn({ err: error, projectId, name }, 'Bundle section not added');
        break;
      }
    }

    // Fields next, for the same reason.
    const attached = new Set(
      (
        await this.prisma.projectCustomField.findMany({
          where: { projectId },
          select: { customFieldId: true },
        })
      ).map((row) => row.customFieldId),
    );
    for (const fieldId of bundle.customFieldIds) {
      if (attached.has(fieldId)) continue;
      try {
        await this.customFields.attach(workspaceId, projectId, actor.userId, actor.role, fieldId);
        result.fieldsAdded += 1;
      } catch (error) {
        // Archived or deleted since the bundle was taken; the rest still come.
        this.logger.warn({ err: error, projectId, fieldId }, 'Bundle field not attached');
      }
    }

    // Rules and templates are the bundle's own: replaced, never merged.
    await this.prisma.$transaction([
      this.prisma.automationRule.deleteMany({ where: { projectId, bundleId: bundle.id } }),
      this.prisma.taskTemplate.deleteMany({ where: { projectId, bundleId: bundle.id } }),
    ]);

    for (const snapshot of asArray<RuleSnapshot>(bundle.rules)) {
      const written = await this.ruleLibrary.writeSnapshot(
        workspaceId,
        projectId,
        actor.userId,
        actor.role,
        snapshot,
      );
      await this.prisma.automationRule.update({
        where: { id: written.ruleId },
        data: { bundleId: bundle.id },
      });
      result.rulesWritten += 1;

      if (!snapshot.live) continue;
      if (written.unresolved.length > 0) {
        result.rulesNeedingAttention.push(snapshot.name);
        continue;
      }
      try {
        await this.automations.publish(workspaceId, projectId, actor.role, written.ruleId);
        result.rulesLive += 1;
      } catch {
        result.rulesNeedingAttention.push(snapshot.name);
      }
    }

    const templates = asArray<TemplateSnapshot>(bundle.taskTemplates);
    if (templates.length > 0) {
      await this.prisma.taskTemplate.createMany({
        data: templates.map((template) => ({
          workspaceId,
          projectId,
          bundleId: bundle.id,
          createdById: actor.userId,
          name: template.name,
          title: template.title,
          description: template.description,
          kind: template.kind,
          priority: template.priority,
          assigneeId: template.assigneeId,
          dueInDays: template.dueInDays,
          subtasks: (template.subtasks ?? []) as Prisma.InputJsonValue,
        })),
      });
      result.templatesWritten = templates.length;
    }

    await this.prisma.bundleProject.upsert({
      where: { bundleId_projectId: { bundleId: bundle.id, projectId } },
      create: { bundleId: bundle.id, projectId, appliedVersion: bundle.version },
      update: { appliedVersion: bundle.version, appliedAt: new Date() },
    });

    return result;
  }

  private async require(workspaceId: string, bundleId: string): Promise<BundleRow> {
    const row = await this.prisma.bundle.findFirst({ where: { id: bundleId, workspaceId } });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Bundle not found.');
    return row;
  }

  /** Renaming and deleting a bundle reaches every project it is on: a manager's call. */
  private assertMayManageBundles(actor: ActorContext) {
    if (!hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden('INSUFFICIENT_WORKSPACE_ROLE', undefined, {
        required: WorkspaceRole.MANAGER,
        actual: actor.role,
      });
    }
  }

  /** The rows as the list shows them: only the projects, and field names, the reader may see. */
  private async toDtos(
    workspaceId: string,
    actor: ActorContext,
    rows: readonly LoadedBundle[],
  ): Promise<Bundle[]> {
    const projectIds = [
      ...new Set(
        rows.flatMap((row) => [
          ...(row.sourceProjectId ? [row.sourceProjectId] : []),
          ...row.projects.map((link) => link.projectId),
        ]),
      ),
    ];
    const fieldIds = [...new Set(rows.flatMap((row) => row.customFieldIds))];

    const [visible, fields] = await Promise.all([
      projectIds.length
        ? this.prisma.project.findMany({
            where: {
              AND: [{ workspaceId, id: { in: projectIds } }, this.access.projectWhere(actor)],
            },
            select: { id: true },
          })
        : [],
      fieldIds.length
        ? this.prisma.customField.findMany({
            where: { id: { in: fieldIds }, workspaceId },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const canSee = new Set(visible.map((row) => row.id));
    const fieldName = new Map(fields.map((field) => [field.id, field.name]));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      sourceProject:
        row.sourceProject && canSee.has(row.sourceProject.id) ? row.sourceProject : null,
      version: row.version,
      sections: asArray<string>(row.sections).filter((name) => typeof name === 'string'),
      fields: row.customFieldIds.flatMap((id) => {
        const name = fieldName.get(id);
        return name ? [{ id, name }] : [];
      }),
      rules: asArray<RuleSnapshot>(row.rules).map((rule) => ({
        name: rule.name,
        live: rule.live === true,
      })),
      taskTemplates: asArray<TemplateSnapshot>(row.taskTemplates).map((template) => ({
        name: template.name,
      })),
      projects: row.projects
        .filter((link) => canSee.has(link.projectId))
        .map((link) => ({
          id: link.project.id,
          name: link.project.name,
          appliedVersion: link.appliedVersion,
        })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}
