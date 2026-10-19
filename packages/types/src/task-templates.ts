import type { TaskKind, TaskPriority } from '@coretask/contracts';

export interface TaskTemplateSubtask {
  title: string;
  assigneeId?: string | null;
}

/** A ready-made task, with its subtasks, a project's Add menu can create. */
export interface TaskTemplate {
  id: string;
  projectId: string;
  name: string;
  title: string;
  description: string | null;
  kind: TaskKind;
  priority: TaskPriority | null;
  assigneeId: string | null;
  /** Due this many days after it is created; null for no due date. */
  dueInDays: number | null;
  subtasks: TaskTemplateSubtask[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskTemplateDraft {
  name: string;
  title: string;
  description?: string | null;
  kind?: TaskKind;
  priority?: TaskPriority | null;
  assigneeId?: string | null;
  dueInDays?: number | null;
  subtasks?: TaskTemplateSubtask[];
}
