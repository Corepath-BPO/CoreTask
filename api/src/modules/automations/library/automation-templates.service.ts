import {
  AutomationNodeType,
  AutomationTemplateReferenceKind,
  AutomationTrigger,
  WorkspaceRole,
  hasAtLeastRole,
  isFallbackBranch,
} from '@coretask/contracts';
import type { AppliedAutomationTemplate, AutomationTemplateUnresolved } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { TaskStatus, type Prisma } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';
import { PrismaService } from '../../../database/prisma.service';
import { ProjectAccessService } from '../../project-access/project-access.service';
import { AutomationsService } from '../automations.service';
import { customFieldConditionId, customFieldKey } from '../builder/automation-catalogue';
import type {
  ApplyAutomationTemplateDto,
  SaveAutomationTemplateDto,
  UpdateAutomationTemplateDto,
} from '../dto/automation-template.dto';

/**
 * One node as a template stores it — the shape `POST /automations` accepts.
 *
 * Ids are the source rule's. They only matter relative to each other, for
 * `parentId`, and the rule writer maps them to fresh ones on every apply.
 */
interface TemplateNode {
  id: string;
  nodeType: string;
  subtype: string;
  configuration: Record<string, unknown>;
  position: { x: number; y: number };
  parentId: string | null;
  branchKey: string | null;
  order: number;
}

/**
 * The names behind the ids a template carries.
 *
 * Taken when the template is saved, from the project it was saved in. Applying
 * it somewhere else matches by these names, and having them in the row means
 * that still works after the source project has renamed or deleted the things
 * they name — the template is the record of what the rule meant.
 *
 * Only the project-scoped kinds. Members and priorities are workspace-wide, so
 * their ids mean the same thing in every project and are carried as they are.
 */
interface TemplateReferences {
  sections: Record<string, string>;
  statuses: Record<string, string>;
  customFields: Record<string, { name: string; options: Record<string, string> }>;
}

/** What the target project holds, indexed for matching. */
interface TargetProject {
  sectionById: Map<string, string>;
  sectionByName: Map<string, string>;
  statusById: Set<string>;
  statusByName: Map<string, string>;
  fieldById: Map<string, TargetField>;
  fieldByName: Map<string, TargetField>;
}

interface TargetField {
  id: string;
  optionById: Set<string>;
  optionByLabel: Map<string, string>;
}

const NO_REFERENCES: TemplateReferences = { sections: {}, statuses: {}, customFields: {} };

/** A project with nothing in it, for translating a rule into blanks. */
const emptyTarget = (): TargetProject => ({
  sectionById: new Map(),
  sectionByName: new Map(),
  statusById: new Set(),
  statusByName: new Map(),
  fieldById: new Map(),
  fieldByName: new Map(),
});

const templateInclude = {
  createdBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
  sourceProject: { select: { id: true, name: true } },
} satisfies Prisma.AutomationTemplateInclude;

/** Names compare loosely: "Done" and "done " are the same section to anybody reading a board. */
const fold = (name: string) => name.trim().toLocaleLowerCase();

const readId = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const readIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => readId(entry) !== null) : [];

/**
 * The rule library.
 *
 * A rule that works in one project is usually wanted, near enough unchanged, in
 * the next one — "assign the lead when a task lands in Review" is the same rule
 * everywhere, with a different Review. Saving it here turns the rule into
 * something a project can start from, and applying it writes a new draft with
 * the references translated to the project it lands in.
 *
 * Apply creates a **draft**, never a live rule. A template's references may not
 * all match, and even when they do, a rule that starts acting on real tasks the
 * moment somebody presses "Use" is a rule nobody has read in its new home.
 */
@Injectable()
export class AutomationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly automations: AutomationsService,
  ) {}

  async list(workspaceId: string) {
    const templates = await this.prisma.automationTemplate.findMany({
      where: { workspaceId },
      include: templateInclude,
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });

    return templates.map(toResponse);
  }

  /**
   * Snapshots a rule into the library.
   *
   * Addressed by rule rather than by graph so the library only ever holds
   * things that were built in the builder and could be published there. The
   * names behind the rule's references are read now, while the project that
   * gave them meaning is still here to be asked.
   */
  async saveFromRule(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    dto: SaveAutomationTemplateDto,
  ) {
    this.assertMayManage(role);

    const rule = await this.automations.get(workspaceId, dto.projectId, dto.ruleId);

    if (rule.nodes.length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'This rule has no steps to save.');
    }

    let nodes: TemplateNode[] = rule.nodes.map((node) => ({
      id: node.id,
      nodeType: node.nodeType,
      subtype: node.subtype,
      configuration: asConfiguration(node.configuration),
      position: { x: node.positionX, y: node.positionY },
      parentId: node.parentNodeId,
      branchKey: node.branchKey,
      order: node.position,
    }));
    let triggerConfig = asConfiguration(rule.triggerConfig);
    let references: TemplateReferences;

    if (dto.clearReferences) {
      /*
       * A template that asks rather than remembers.
       *
       * "Check if the section is Incoming Request" is this project's rule; the
       * template of it somebody wants is "check if the section is ___", to be
       * answered wherever it is used. Done by translating into a project that
       * has nothing — the same code path an apply takes when nothing matches —
       * so what "blank" means here and what it means there cannot differ.
       * People and priorities are workspace-wide and are not references in
       * this sense; they come through as they are.
       */
      const nowhere = emptyTarget();
      nodes = nodes.map((node) => ({
        ...node,
        configuration: translateConfiguration(node.configuration, node, NO_REFERENCES, nowhere, []),
      }));
      triggerConfig = translateConfiguration(
        triggerConfig,
        { nodeType: AutomationNodeType.TRIGGER, subtype: rule.triggerType },
        NO_REFERENCES,
        nowhere,
        [],
      );
      references = NO_REFERENCES;
    } else {
      references = await this.snapshotReferences(workspaceId, triggerConfig, nodes);
    }

    const template = await this.prisma.automationTemplate.create({
      data: {
        workspaceId,
        name: dto.name ?? rule.name,
        description: dto.description ?? rule.description,
        triggerType: rule.triggerType,
        triggerConfig: triggerConfig as Prisma.InputJsonValue,
        nodes: nodes as unknown as Prisma.InputJsonValue,
        references: references as unknown as Prisma.InputJsonValue,
        allowChaining: rule.allowChaining,
        sourceRuleId: rule.id,
        sourceProjectId: rule.projectId,
        createdById: userId,
      },
      include: templateInclude,
    });

    return toResponse(template);
  }

  async update(
    workspaceId: string,
    role: WorkspaceRole,
    templateId: string,
    dto: UpdateAutomationTemplateDto,
  ) {
    this.assertMayManage(role);
    await this.requireTemplate(workspaceId, templateId);

    const data: Prisma.AutomationTemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    const template = await this.prisma.automationTemplate.update({
      where: { id: templateId },
      data,
      include: templateInclude,
    });

    return toResponse(template);
  }

  /**
   * Removes a template outright.
   *
   * Unlike a rule there is no history to keep: the drafts started from it are
   * rules of their own and carry no link back, so nothing points here.
   */
  async remove(workspaceId: string, role: WorkspaceRole, templateId: string) {
    this.assertMayManage(role);
    await this.requireTemplate(workspaceId, templateId);

    await this.prisma.automationTemplate.delete({ where: { id: templateId } });

    return { deleted: true };
  }

  /**
   * Writes the template into a project as a new draft.
   *
   * Every project-scoped id in the graph is translated: kept where the target
   * project has the same row (a template applied back where it came from, or a
   * field the workspace library shares), matched by name where it does not, and
   * cleared where nothing matches. A cleared choice is reported in `unresolved`
   * and left for the builder to ask about — the alternative, refusing, would
   * make the library useless for exactly the rules it exists for, the ones that
   * name a "Review" section every project has under a slightly different name.
   */
  async apply(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    templateId: string,
    dto: ApplyAutomationTemplateDto,
  ): Promise<AppliedAutomationTemplate> {
    this.assertMayManage(role);
    const template = await this.requireTemplate(workspaceId, templateId);
    // The target arrives in the body, out of `ProjectAccessGuard`'s sight:
    // invisible is a 404, and the caller must still be a manager *inside* it.
    await this.access.requireAccess(
      workspaceId,
      dto.projectId,
      { userId, role },
      WorkspaceRole.MANAGER,
    );

    const target = await this.loadTarget(workspaceId, dto.projectId);
    const references = asReferences(template.references);
    const nodes = asNodes(template.nodes);
    let triggerConfig = asConfiguration(template.triggerConfig);

    /*
     * A section the caller named wins over the one the template remembers.
     *
     * Started from a section's menu, "when a task lands here" is the whole
     * point of the click; the template's own section is where the rule used
     * to watch, in a project this one is not. Checked against the target
     * project first, because an id from anywhere else is exactly what the
     * translation below exists to keep out.
     */
    if (dto.sectionId && template.triggerType === AutomationTrigger.TASK_MOVED_TO_SECTION) {
      if (!target.sectionById.has(dto.sectionId)) {
        throw AppException.notFound('RESOURCE_NOT_FOUND', 'Section not found in this project.');
      }

      triggerConfig = withSection(triggerConfig, dto.sectionId);
    }

    const unresolved: AutomationTemplateUnresolved[] = [];
    const translated = nodes.map((node) => {
      const configuration =
        node.nodeType === AutomationNodeType.TRIGGER && dto.sectionId
          ? withSection(node.configuration, triggerConfig['sectionId'] as string)
          : node.configuration;

      return {
        ...node,
        configuration: translateConfiguration(
          configuration,
          { nodeType: node.nodeType, subtype: node.subtype },
          references,
          target,
          unresolved,
        ),
      };
    });

    const trigger = translated.find((node) => node.nodeType === AutomationNodeType.TRIGGER);
    /*
     * The row's trigger columns follow the trigger node, as an update's would.
     *
     * The stored `triggerConfig` was a copy of the node's configuration when
     * the template was saved, and the node has just been translated; deriving
     * the columns from it means the runner matches on the same section the
     * canvas shows, rather than on the id the template remembered.
     */
    const ruleTriggerConfig = trigger
      ? trigger.configuration
      : translateConfiguration(
          triggerConfig,
          { nodeType: AutomationNodeType.TRIGGER, subtype: template.triggerType },
          references,
          target,
          unresolved,
        );

    const created = await this.automations.create(workspaceId, dto.projectId, userId, role, {
      name: template.name,
      ...(template.description ? { description: template.description } : {}),
      triggerType: trigger?.subtype ?? template.triggerType,
      triggerConfig: ruleTriggerConfig,
      nodes: translated,
    });

    // The create DTO does not carry chaining — it is a setting rather than a
    // step — so a template that turned it off is honoured in a second write.
    if (!template.allowChaining) {
      await this.prisma.automationRule.update({
        where: { id: created.id },
        data: { allowChaining: false },
      });
    }

    await this.prisma.automationTemplate.update({
      where: { id: templateId },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    });

    const rule = await this.automations.get(workspaceId, dto.projectId, created.id);

    return { rule, unresolved: dedupe(unresolved) };
  }

  // -------------------------------------------------------------------------

  /**
   * The names behind every project-scoped id the graph names.
   *
   * Looked up by id alone, not scoped to the project: the rule was validated
   * against its project when it was published, and a name is all that is being
   * recorded. A reference that no longer resolves is simply absent — when the
   * template is applied it will read as unresolved, which is what it is.
   */
  private async snapshotReferences(
    workspaceId: string,
    triggerConfig: Record<string, unknown>,
    nodes: readonly TemplateNode[],
  ): Promise<TemplateReferences> {
    const sectionIds = new Set<string>();
    const statusIds = new Set<string>();
    const fieldIds = new Set<string>();

    const configurations = [
      { configuration: triggerConfig, nodeType: AutomationNodeType.TRIGGER as string },
      ...nodes,
    ];

    for (const { configuration: config, nodeType } of configurations) {
      const sectionId = readId(config['sectionId']);
      if (sectionId) sectionIds.add(sectionId);
      for (const id of readIds(config['sectionIds'])) sectionIds.add(id);

      const statusId = readId(config['status'] ?? config['statusDefinitionId']);
      if (statusId && !isLegacyStatus(statusId)) statusIds.add(statusId);

      const fieldId = readId(config['fieldId'] ?? config['customFieldId']);
      if (fieldId) fieldIds.add(fieldId);

      if (nodeType === AutomationNodeType.CONDITION && !isFallbackBranch(config)) {
        const conditionField = customFieldConditionId(config['field']);
        if (conditionField) fieldIds.add(conditionField);

        if (config['field'] === 'sectionId') {
          for (const id of conditionValues(config)) sectionIds.add(id);
        }
        if (config['field'] === 'status') {
          for (const id of conditionValues(config)) if (!isLegacyStatus(id)) statusIds.add(id);
        }
      }
    }

    const [sections, statuses, fields] = await Promise.all([
      sectionIds.size
        ? this.prisma.section.findMany({
            where: { id: { in: [...sectionIds] }, workspaceId },
            select: { id: true, name: true },
          })
        : [],
      statusIds.size
        ? this.prisma.statusDefinition.findMany({
            where: { id: { in: [...statusIds] }, workspaceId },
            select: { id: true, name: true },
          })
        : [],
      fieldIds.size
        ? this.prisma.customField.findMany({
            where: { id: { in: [...fieldIds] }, workspaceId },
            select: {
              id: true,
              name: true,
              // Archived options too: the rule may still name one, and the
              // label is the only thing that lets it be matched elsewhere.
              options: { select: { id: true, label: true } },
            },
          })
        : [],
    ]);

    return {
      sections: Object.fromEntries(sections.map((row) => [row.id, row.name])),
      statuses: Object.fromEntries(statuses.map((row) => [row.id, row.name])),
      customFields: Object.fromEntries(
        fields.map((field) => [
          field.id,
          {
            name: field.name,
            options: Object.fromEntries(field.options.map((option) => [option.id, option.label])),
          },
        ]),
      ),
    };
  }

  /**
   * What the project a template is landing in has to offer.
   *
   * The same three lists the builder's metadata reads from, indexed both ways:
   * by id, so a reference that already fits is kept as it is, and by name, so
   * one that does not can be matched. Statuses resolve the way the metadata
   * resolves them — the project's own set when it has one, the workspace
   * defaults otherwise — because that is the list the board shows and the list
   * a rule can be published against.
   */
  private async loadTarget(workspaceId: string, projectId: string): Promise<TargetProject> {
    const statusSelect = { id: true, name: true } as const;

    const [sections, ownStatuses, links] = await Promise.all([
      this.prisma.section.findMany({ where: { projectId }, select: { id: true, name: true } }),
      this.prisma.statusDefinition.findMany({
        where: { workspaceId, projectId, isArchived: false },
        select: statusSelect,
      }),
      this.prisma.projectCustomField.findMany({
        where: { projectId, customField: { workspaceId, isArchived: false } },
        select: {
          customField: {
            select: {
              id: true,
              name: true,
              options: { where: { isArchived: false }, select: { id: true, label: true } },
            },
          },
        },
      }),
    ]);

    const statuses =
      ownStatuses.length > 0
        ? ownStatuses
        : await this.prisma.statusDefinition.findMany({
            where: { workspaceId, projectId: null, isArchived: false },
            select: statusSelect,
          });

    const fields: TargetField[] = links.map(({ customField }) => ({
      id: customField.id,
      optionById: new Set(customField.options.map((option) => option.id)),
      optionByLabel: new Map(customField.options.map((option) => [fold(option.label), option.id])),
    }));

    return {
      sectionById: new Map(sections.map((row) => [row.id, row.name])),
      // First wins on a duplicate name, which is the top-most section — the
      // one somebody reading the board from the top would also pick.
      sectionByName: firstByName(sections.map((row) => [row.name, row.id])),
      statusById: new Set(statuses.map((row) => row.id)),
      statusByName: firstByName(statuses.map((row) => [row.name, row.id])),
      fieldById: new Map(fields.map((field) => [field.id, field])),
      fieldByName: firstByName(
        links.map(({ customField }, index) => [customField.name, fields[index] as TargetField]),
      ),
    };
  }

  private assertMayManage(role: WorkspaceRole): void {
    if (!hasAtLeastRole(role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only a workspace manager can change the rule library.',
      );
    }
  }

  private async requireTemplate(workspaceId: string, templateId: string) {
    const template = await this.prisma.automationTemplate.findFirst({
      where: { id: templateId, workspaceId },
      include: templateInclude,
    });

    if (!template) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Rule template not found.');
    }

    return template;
  }
}

/* -------------------------------------------------------------------------- */
/* Translating a configuration into another project                            */
/* -------------------------------------------------------------------------- */

/**
 * One configuration, with every project-scoped id made to mean the same thing
 * in the target project — or removed, and said so.
 *
 * Pure, so what a template does to a rule can be read without a database: the
 * service gathers what the target project holds and this decides what each id
 * becomes. Every kind follows the same three steps — keep it if the target has
 * that very row, otherwise match the remembered name, otherwise clear it and
 * report — so a reader who has followed one has followed them all.
 */
function translateConfiguration(
  configuration: Record<string, unknown>,
  node: { nodeType: string; subtype: string },
  references: TemplateReferences,
  target: TargetProject,
  unresolved: AutomationTemplateUnresolved[],
): Record<string, unknown> {
  const config = { ...configuration };

  const report = (kind: AutomationTemplateReferenceKind, name: string) =>
    unresolved.push({ nodeType: node.nodeType, subtype: node.subtype, kind, name });

  const section = (id: string): string | null => {
    if (target.sectionById.has(id)) return id;
    const name = references.sections[id];
    const match = name ? target.sectionByName.get(fold(name)) : undefined;
    if (match) return match;
    report(AutomationTemplateReferenceKind.SECTION, name ?? 'a section from another project');
    return null;
  };

  const status = (id: string): string | null => {
    if (isLegacyStatus(id) || target.statusById.has(id)) return id;
    const name = references.statuses[id];
    const match = name ? target.statusByName.get(fold(name)) : undefined;
    if (match) return match;
    report(AutomationTemplateReferenceKind.STATUS, name ?? 'a status from another project');
    return null;
  };

  const field = (id: string): TargetField | null => {
    const same = target.fieldById.get(id);
    if (same) return same;
    const name = references.customFields[id]?.name;
    const match = name ? target.fieldByName.get(fold(name)) : undefined;
    if (match) return match;
    report(AutomationTemplateReferenceKind.CUSTOM_FIELD, name ?? 'a field from another project');
    return null;
  };

  /*
   * A value on a field, once the field is known.
   *
   * Only an option id is translated; anything else — text, a number, a date
   * token — means the same thing on the matched field as it did on the
   * original. Whether a string *is* an option id is answered by the snapshot,
   * not by its shape: "Large" could be text on one field and a label on another.
   */
  const optionValue = (sourceFieldId: string, resolved: TargetField, value: unknown): unknown => {
    const labels = references.customFields[sourceFieldId]?.options ?? {};

    const one = (entry: unknown): unknown => {
      const id = readId(entry);
      if (!id || !(id in labels)) return entry;
      if (resolved.optionById.has(id)) return id;
      const match = resolved.optionByLabel.get(fold(labels[id] as string));
      if (match) return match;
      report(AutomationTemplateReferenceKind.OPTION, labels[id] as string);
      return undefined;
    };

    if (Array.isArray(value)) return value.map(one).filter((entry) => entry !== undefined);
    return one(value);
  };

  // Sections, wherever a configuration names one: a trigger's scope, a move's
  // destination, or the list a trigger watches.
  const sectionId = readId(config['sectionId']);
  if (sectionId) {
    const resolved = section(sectionId);
    if (resolved) config['sectionId'] = resolved;
    else delete config['sectionId'];
  }

  if (Array.isArray(config['sectionIds'])) {
    const resolved = readIds(config['sectionIds'])
      .map(section)
      .filter((id): id is string => id !== null);
    if (resolved.length > 0) config['sectionIds'] = resolved;
    else delete config['sectionIds'];
  }

  // Statuses, under the runner's key and the one the form used to write.
  for (const key of ['status', 'statusDefinitionId'] as const) {
    const id = readId(config[key]);
    if (!id) continue;
    const resolved = status(id);
    if (resolved) config[key] = resolved;
    else delete config[key];
  }

  // A field named by an action or a trigger, with the value that goes on it.
  for (const key of ['fieldId', 'customFieldId'] as const) {
    const id = readId(config[key]);
    if (!id) continue;
    const resolved = field(id);
    if (!resolved) {
      delete config[key];
      delete config['value'];
      continue;
    }
    config[key] = resolved.id;
    if ('value' in config) {
      const value = optionValue(id, resolved, config['value']);
      if (value === undefined) delete config['value'];
      else config['value'] = value;
    }
  }

  // A condition: what it compares decides what its value is.
  if (node.nodeType === AutomationNodeType.CONDITION && !isFallbackBranch(config)) {
    const conditionField = config['field'];
    const conditionFieldId = customFieldConditionId(conditionField);

    if (conditionFieldId) {
      const resolved = field(conditionFieldId);
      /*
       * A condition about a field the project does not have is a question
       * with no subject. Left with nothing rather than a dangling key, so the
       * builder shows the row as unanswered — "Check if…" — and asks, instead
       * of showing a comparison against a field it cannot name.
       */
      if (!resolved) return {};
      config['field'] = customFieldKey(resolved.id);
      if ('value' in config) {
        const value = optionValue(conditionFieldId, resolved, config['value']);
        if (value === undefined) delete config['value'];
        else config['value'] = value;
      }
    } else if (conditionField === 'sectionId' || conditionField === 'status') {
      const resolve = conditionField === 'sectionId' ? section : status;
      const value = config['value'];

      if (Array.isArray(value)) {
        config['value'] = readIds(value)
          .map(resolve)
          .filter((id): id is string => id !== null);
      } else {
        const id = readId(value);
        if (id) {
          const resolved = resolve(id);
          if (resolved) config['value'] = resolved;
          else delete config['value'];
        }
      }
    }
  }

  return config;
}

/** The ids a condition compares against, whichever shape the operator stores. */
function conditionValues(config: Record<string, unknown>): string[] {
  const value = config['value'];
  const one = readId(value);
  return one ? [one] : readIds(value);
}

/**
 * A status written as the enum it was before definitions existed.
 *
 * Not an id, so there is nothing to match — it means the same thing in every
 * project and is carried as it is, exactly as the validator treats it.
 */
function isLegacyStatus(value: string): boolean {
  return value in TaskStatus;
}

/** The single-section form of a trigger, replacing whichever form was stored. */
function withSection(
  configuration: Record<string, unknown>,
  sectionId: string,
): Record<string, unknown> {
  const { sectionIds: _dropped, ...rest } = configuration;
  return { ...rest, sectionId };
}

function firstByName<T>(entries: readonly (readonly [string, T])[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const [name, value] of entries) {
    const key = fold(name);
    if (!map.has(key)) map.set(key, value);
  }
  return map;
}

/**
 * The same missing thing, said once.
 *
 * A template naming "Review" in its trigger and again in a move reports it
 * twice, and the person applying it needs to choose that section once.
 */
function dedupe(unresolved: AutomationTemplateUnresolved[]): AutomationTemplateUnresolved[] {
  const seen = new Set<string>();
  return unresolved.filter((entry) => {
    const key = `${entry.nodeType}|${entry.subtype}|${entry.kind}|${fold(entry.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Reading what the row holds                                                  */
/* -------------------------------------------------------------------------- */

function asConfiguration(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNodes(value: unknown): TemplateNode[] {
  if (!Array.isArray(value)) return [];

  return value.map((raw, index) => {
    const node = asConfiguration(raw);
    const position = asConfiguration(node['position']);

    return {
      id: typeof node['id'] === 'string' ? node['id'] : `node-${index}`,
      nodeType: String(node['nodeType'] ?? ''),
      subtype: String(node['subtype'] ?? ''),
      configuration: asConfiguration(node['configuration']),
      position: {
        x: typeof position['x'] === 'number' ? position['x'] : 0,
        y: typeof position['y'] === 'number' ? position['y'] : 0,
      },
      parentId: typeof node['parentId'] === 'string' ? node['parentId'] : null,
      branchKey: typeof node['branchKey'] === 'string' ? node['branchKey'] : null,
      order: typeof node['order'] === 'number' ? node['order'] : index,
    };
  });
}

function asReferences(value: unknown): TemplateReferences {
  const raw = asConfiguration(value);
  return {
    sections: asConfiguration(raw['sections']) as Record<string, string>,
    statuses: asConfiguration(raw['statuses']) as Record<string, string>,
    customFields: asConfiguration(raw['customFields']) as TemplateReferences['customFields'],
  };
}

/**
 * The row as the client reads it.
 *
 * `references` stays behind: it is the service's own notebook for matching, and
 * a client that read it would be tempted to do the translation itself.
 */
function toResponse(
  template: Prisma.AutomationTemplateGetPayload<{ include: typeof templateInclude }>,
) {
  const { references: _references, sourceProjectId: _sourceProjectId, ...rest } = template;

  return {
    ...rest,
    triggerConfig: asConfiguration(template.triggerConfig),
    nodes: asNodes(template.nodes),
  };
}
