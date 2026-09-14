import {
  CustomFieldType,
  WorkItemType,
  evaluateFormula,
  parseFormula,
  type FormulaNode,
} from '@coretask/contracts';
import type {
  ProjectWorkItem,
  TaskCustomFieldValue,
  WorkItemCustomFieldValue,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';

/** One parsed formula field on a project. */
interface PlannedFormula {
  fieldId: string;
  ast: FormulaNode;
}

/** Everything a page of tasks needs to have its formulas worked out. */
export interface FormulaPlan {
  formulas: PlannedFormula[];
}

/** The stored values a computation reads: numbers and dates, by field. */
export interface StoredValues {
  taskId: string;
  values: { customFieldId: string; number: number | null; date: string | null }[];
}

/**
 * Formula values are worked out on read and never stored.
 *
 * Storing them would mean recalculating every task whenever any operand
 * changed — and getting that wrong silently, which is the worst kind of
 * wrong for a number somebody reports on. Evaluating a handful of arithmetic
 * expressions over a page of rows is cheaper than any of that, and it is
 * always right.
 *
 * `plan` is one indexed query and returns null when the project has no
 * formula fields, so the hot path for every other project is unchanged.
 */
@Injectable()
export class FormulaValuesService {
  constructor(private readonly prisma: PrismaService) {}

  async plan(projectId: string): Promise<FormulaPlan | null> {
    const links = await this.prisma.projectCustomField.findMany({
      where: {
        projectId,
        customField: { type: CustomFieldType.FORMULA, isArchived: false },
      },
      select: { customField: { select: { id: true, settings: true } } },
    });
    if (links.length === 0) return null;

    const formulas: PlannedFormula[] = [];
    for (const link of links) {
      const settings = (link.customField.settings ?? {}) as { expression?: unknown };
      if (typeof settings.expression !== 'string') continue;
      const parsed = parseFormula(settings.expression);
      if (parsed.ok) formulas.push({ fieldId: link.customField.id, ast: parsed.ast });
    }

    return formulas.length > 0 ? { formulas } : null;
  }

  /**
   * Every formula's value for every task, keyed by task. A formula that names
   * another formula is followed, memoised per task and guarded against depth
   * the validator already refused.
   */
  compute(
    plan: FormulaPlan,
    tasks: readonly StoredValues[],
  ): Map<string, { customFieldId: string; number: number | null }[]> {
    const today = new Date();
    const midnight = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const byField = new Map(plan.formulas.map((formula) => [formula.fieldId, formula.ast]));
    const result = new Map<string, { customFieldId: string; number: number | null }[]>();

    for (const task of tasks) {
      const stored = new Map(task.values.map((value) => [value.customFieldId, value]));
      const memo = new Map<string, number | null>();
      const visiting = new Set<string>();

      const valueOf = (fieldId: string): number | Date | null => {
        const formula = byField.get(fieldId);
        if (formula) {
          if (memo.has(fieldId)) return memo.get(fieldId) ?? null;
          // A cycle the validator missed (a field re-typed under it) is null,
          // not a stack overflow.
          if (visiting.has(fieldId) || visiting.size > 10) return null;
          visiting.add(fieldId);
          const value = evaluateFormula(formula, { valueOf, today: () => midnight });
          visiting.delete(fieldId);
          memo.set(fieldId, value);
          return value;
        }
        const row = stored.get(fieldId);
        if (!row) return null;
        if (row.number !== null) return row.number;
        if (row.date !== null) return new Date(row.date);
        return null;
      };

      result.set(
        task.taskId,
        plan.formulas.map((formula) => ({
          customFieldId: formula.fieldId,
          number: (() => {
            const value = valueOf(formula.fieldId);
            return typeof value === 'number' ? value : null;
          })(),
        })),
      );
    }

    return result;
  }

  /**
   * A page of tasks with their formula values appended, in the shape the
   * task routes speak. Unchanged, and without a query, when the project has
   * no formula fields.
   */
  async decorateTasks<T extends { id: string; customFieldValues: TaskCustomFieldValue[] }>(
    projectId: string,
    tasks: readonly T[],
  ): Promise<T[]> {
    if (tasks.length === 0) return [...tasks];
    const plan = await this.plan(projectId);
    if (!plan) return [...tasks];

    const computed = this.compute(
      plan,
      tasks.map((task) => ({
        taskId: task.id,
        values: task.customFieldValues.map((value) => ({
          customFieldId: value.customFieldId,
          number: value.number,
          date: value.date,
        })),
      })),
    );

    return tasks.map((task) => ({
      ...task,
      customFieldValues: [
        ...task.customFieldValues,
        ...(computed.get(task.id) ?? []).map((row): TaskCustomFieldValue => ({
          customFieldId: row.customFieldId,
          text: null,
          number: row.number,
          date: null,
          checkbox: null,
          optionIds: [],
          userIds: [],
        })),
      ],
    }));
  }

  /** The same for the project work-item shape; tickets hold no values and pass through. */
  async decorateWorkItems(
    projectId: string,
    items: readonly ProjectWorkItem[],
  ): Promise<ProjectWorkItem[]> {
    const tasks = items.filter((item) => item.type === WorkItemType.TASK);
    if (tasks.length === 0) return [...items];
    const plan = await this.plan(projectId);
    if (!plan) return [...items];

    const computed = this.compute(
      plan,
      tasks.map((item) => ({
        taskId: item.id,
        values: item.customFieldValues.map((value) => ({
          customFieldId: value.fieldId,
          number: value.numberValue,
          date: value.dateValue,
        })),
      })),
    );

    return items.map((item) => {
      const rows = computed.get(item.id);
      if (!rows) return item;
      return {
        ...item,
        customFieldValues: [
          ...item.customFieldValues,
          ...rows.map((row): WorkItemCustomFieldValue => ({
            fieldId: row.customFieldId,
            textValue: null,
            numberValue: row.number,
            dateValue: null,
            booleanValue: null,
            optionIds: [],
            userIds: [],
          })),
        ],
      };
    });
  }
}
