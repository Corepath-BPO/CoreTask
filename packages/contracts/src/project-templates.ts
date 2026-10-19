/**
 * Project templates and "Duplicate project" — Asana's two ways of starting a
 * project from another.
 *
 * Both rest on a blueprint: a project's sections and the parts chosen of the
 * rest. Duplicating builds the new project straight away; a template keeps the
 * blueprint so the workspace can start any number of projects from it, each
 * with its task dates counted from the day it starts.
 */

/** What a blueprint can carry besides the sections, which it always does. */
export const BlueprintPart = {
  TASKS: 'TASKS',
  SUBTASKS: 'SUBTASKS',
  ASSIGNEES: 'ASSIGNEES',
  DATES: 'DATES',
  FIELDS: 'FIELDS',
  RULES: 'RULES',
  TASK_TEMPLATES: 'TASK_TEMPLATES',
  MEMBERS: 'MEMBERS',
} as const;
export type BlueprintPart = (typeof BlueprintPart)[keyof typeof BlueprintPart];
export const BLUEPRINT_PARTS = Object.values(BlueprintPart);

export const BLUEPRINT_PART_LABEL: Record<BlueprintPart, string> = {
  TASKS: 'Tasks',
  SUBTASKS: 'Subtasks',
  ASSIGNEES: 'Assignees',
  DATES: 'Task dates',
  FIELDS: 'Fields',
  RULES: 'Rules',
  TASK_TEMPLATES: 'Task templates',
  MEMBERS: 'Project members',
};

/** Which parts a part needs: subtasks, assignees and dates only travel with tasks. */
export const BLUEPRINT_PART_NEEDS: Partial<Record<BlueprintPart, BlueprintPart>> = {
  SUBTASKS: BlueprintPart.TASKS,
  ASSIGNEES: BlueprintPart.TASKS,
  DATES: BlueprintPart.TASKS,
};

/** The parts that make sense in a template — no people, who differ project to project. */
export const DEFAULT_TEMPLATE_PARTS: readonly BlueprintPart[] = [
  BlueprintPart.TASKS,
  BlueprintPart.SUBTASKS,
  BlueprintPart.DATES,
  BlueprintPart.FIELDS,
  BlueprintPart.RULES,
  BlueprintPart.TASK_TEMPLATES,
];

/** A duplicate takes everything by default. */
export const DEFAULT_DUPLICATE_PARTS: readonly BlueprintPart[] = BLUEPRINT_PARTS;

export const PROJECT_TEMPLATE_NAME_MAX = 120;
export const PROJECT_TEMPLATE_DESCRIPTION_MAX = 2_000;
export const MAX_PROJECT_TEMPLATES = 100;
/** The most tasks a blueprint carries; past this a project is not a template. */
export const MAX_BLUEPRINT_TASKS = 500;

/** Parts as asked, with what each needs and nothing unknown. */
export function readBlueprintParts(parts: readonly string[]): BlueprintPart[] {
  const chosen = BLUEPRINT_PARTS.filter((part) => parts.includes(part));
  return chosen.filter((part) => {
    const needs = BLUEPRINT_PART_NEEDS[part];
    return !needs || chosen.includes(needs);
  });
}
