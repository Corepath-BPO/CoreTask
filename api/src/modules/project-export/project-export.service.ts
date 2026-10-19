import { CustomFieldType, TaskPriority } from '@coretask/contracts';
import { Injectable } from '@nestjs/common';

import type { ActorContext } from '../../common/types/api.types';
import { htmlToText } from '../../common/utils/rich-text.util';
import { PrismaService } from '../../database/prisma.service';
import { FormulaValuesService } from '../custom-fields/formula-values.service';
import { ProjectAccessService } from '../project-access/project-access.service';

import { toCsv, type CsvCell } from './csv';

/** A spreadsheet, not a backup: past this many tasks, the rest are left off. */
const MAX_TASKS = 10_000;

const BASE_COLUMNS = [
  'Task ID',
  'Created At',
  'Completed At',
  'Last Modified',
  'Name',
  'Section/Column',
  'Assignee',
  'Assignee Email',
  'Start Date',
  'Due Date',
  'Status',
  'Priority',
  'Tags',
  'Notes',
  'Projects',
  'Parent task',
] as const;

/** `IN_PROGRESS` → `In progress`. */
const humanize = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

const day = (value: Date | null): CsvCell =>
  value ? { raw: value.toISOString().slice(0, 10) } : null;

/**
 * A project as a CSV file — Asana's Export › CSV: one row per task, subtasks
 * under their parent, with its section, people, dates, tags, notes, every
 * project it is in, and a column for each of the project's custom fields.
 * Anyone who can open the project may export it; it is a read.
 */
@Injectable()
export class ProjectExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly formulas: FormulaValuesService,
  ) {}

  async exportCsv(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<{ filename: string; body: string }> {
    await this.access.resolveAccess(workspaceId, projectId, actor);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        name: true,
        customFields: {
          where: { customField: { isArchived: false } },
          orderBy: { position: 'asc' },
          select: {
            customField: {
              select: {
                id: true,
                name: true,
                type: true,
                options: { select: { id: true, label: true } },
              },
            },
          },
        },
      },
    });
    const fields = project.customFields.map((link) => link.customField);

    const tasks = await this.prisma.task.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        OR: [{ projectId }, { projectLinks: { some: { projectId } } }],
      },
      select: {
        id: true,
        parentTaskId: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        position: true,
        startDate: true,
        dueDate: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
        projectId: true,
        section: { select: { name: true, position: true } },
        statusDefinition: { select: { name: true } },
        priorityDefinition: { select: { name: true } },
        assignee: { select: { name: true, email: true } },
        parentTask: { select: { title: true } },
        project: { select: { name: true } },
        projectLinks: {
          select: {
            projectId: true,
            position: true,
            project: { select: { name: true } },
            section: { select: { name: true, position: true } },
          },
        },
        tags: { select: { tag: { select: { name: true } } } },
        customFieldValues: {
          select: {
            customFieldId: true,
            textValue: true,
            numberValue: true,
            dateValue: true,
            booleanValue: true,
            optionIds: true,
            userIds: true,
          },
        },
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: MAX_TASKS,
    });

    // Where each task sits in *this* project: its home, or the link that brought it in.
    const placeOf = (task: (typeof tasks)[number]) => {
      if (task.projectId === projectId) {
        return { section: task.section, position: task.position };
      }
      const link = task.projectLinks.find((row) => row.projectId === projectId);
      return { section: link?.section ?? null, position: link?.position ?? task.position };
    };

    // Subtasks follow their parent; the rest go by section, then position.
    const ids = new Set(tasks.map((task) => task.id));
    const children = new Map<string, typeof tasks>();
    const roots: typeof tasks = [];
    for (const task of tasks) {
      if (task.parentTaskId && ids.has(task.parentTaskId)) {
        children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task]);
      } else {
        roots.push(task);
      }
    }
    const sectionRank = (task: (typeof tasks)[number]) =>
      placeOf(task).section?.position ?? -Infinity;
    roots.sort(
      (a, b) => sectionRank(a) - sectionRank(b) || placeOf(a).position - placeOf(b).position,
    );
    const ordered: typeof tasks = [];
    const visit = (task: (typeof tasks)[number], depth: number) => {
      ordered.push(task);
      if (depth > 10) return;
      for (const child of children.get(task.id) ?? []) visit(child, depth + 1);
    };
    for (const root of roots) visit(root, 0);

    // Names for the people and options custom fields point at.
    const userIds = new Set(
      tasks.flatMap((task) => task.customFieldValues.flatMap((v) => v.userIds)),
    );
    const people = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true },
        })
      ).map((user) => [user.id, user.name]),
    );
    const optionLabels = new Map(
      fields.flatMap((field) => field.options.map((option) => [option.id, option.label] as const)),
    );

    const plan = await this.formulas.plan(projectId);
    const computed = plan
      ? this.formulas.compute(
          plan,
          tasks.map((task) => ({
            taskId: task.id,
            values: task.customFieldValues.map((value) => ({
              customFieldId: value.customFieldId,
              number: value.numberValue === null ? null : Number(value.numberValue),
              date: value.dateValue?.toISOString() ?? null,
            })),
          })),
        )
      : null;

    const fieldCell = (task: (typeof tasks)[number], field: (typeof fields)[number]): CsvCell => {
      if (field.type === CustomFieldType.FORMULA) {
        return (
          computed?.get(task.id)?.find((row) => row.customFieldId === field.id)?.number ?? null
        );
      }
      const value = task.customFieldValues.find((row) => row.customFieldId === field.id);
      if (!value) return null;
      switch (field.type) {
        case CustomFieldType.NUMBER:
        case CustomFieldType.RATING:
          return value.numberValue === null ? null : Number(value.numberValue);
        case CustomFieldType.DATE:
          return day(value.dateValue);
        case CustomFieldType.CHECKBOX:
          return value.booleanValue ? { raw: 'Yes' } : null;
        case CustomFieldType.SINGLE_SELECT:
        case CustomFieldType.MULTI_SELECT:
          return value.optionIds
            .map((id) => optionLabels.get(id) ?? '')
            .filter(Boolean)
            .join(', ');
        case CustomFieldType.PEOPLE:
          return value.userIds
            .map((id) => people.get(id) ?? '')
            .filter(Boolean)
            .join(', ');
        default:
          return value.textValue;
      }
    };

    const rows: CsvCell[][] = [[...BASE_COLUMNS, ...fields.map((field) => field.name)]];
    for (const task of ordered) {
      const projects = [
        task.project?.name,
        ...task.projectLinks.map((link) => link.project.name),
      ].filter((name): name is string => Boolean(name));
      rows.push([
        { raw: task.id },
        day(task.createdAt),
        day(task.completedAt),
        day(task.updatedAt),
        task.title,
        placeOf(task).section?.name ?? null,
        task.assignee?.name ?? null,
        task.assignee?.email ?? null,
        day(task.startDate),
        day(task.dueDate),
        task.statusDefinition?.name ?? humanize(task.status),
        task.priorityDefinition?.name ??
          (task.priority === TaskPriority.NONE ? null : humanize(task.priority)),
        task.tags.map((row) => row.tag.name).join(', '),
        task.description ? htmlToText(task.description) : null,
        projects.join(', '),
        task.parentTask?.title ?? null,
        ...fields.map((field) => fieldCell(task, field)),
      ]);
    }

    const slug = project.name
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase();
    return { filename: `${slug || 'project'}.csv`, body: toCsv(rows) };
  }
}
