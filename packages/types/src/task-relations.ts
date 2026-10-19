import type { MyTasksBucket } from '@coretask/contracts';

import type { UserRef } from './work-items.js';

/** Who has liked a task — Asana's thumbs-up in the pane's top bar. */
export interface TaskLikes {
  count: number;
  likedByMe: boolean;
  /** In the order they liked it, for the tooltip. */
  users: UserRef[];
}

/** The other end of a dependency, as the pane lists it. */
export interface DependencyTask {
  /** The edge itself — what removing the dependency deletes. */
  dependencyId: string;
  id: string;
  title: string;
  isCompleted: boolean;
  dueDate: string | null;
  assignee: UserRef | null;
  project: { id: string; name: string; color: string } | null;
}

/**
 * A task's place in the dependency graph, one step out each way.
 *
 * `blockedBy` is what this task is waiting on; `blocking` is what is waiting
 * on it. A task with an incomplete `blockedBy` entry is "blocked" in Asana's
 * sense: it should not start yet.
 */
export interface TaskDependencies {
  blockedBy: DependencyTask[];
  blocking: DependencyTask[];
}

export type DependencyDirection = 'BLOCKED_BY' | 'BLOCKING';

/** One dependency inside a project, as its Timeline draws it. */
export interface ProjectDependency {
  id: string;
  /** The task that has to finish first. */
  blockingId: string;
  /** The task waiting on it. */
  blockedId: string;
}

export interface AddDependencyPayload {
  /** The other task. */
  taskId: string;
  /** `BLOCKED_BY`: this task waits on `taskId`. `BLOCKING`: `taskId` waits on this one. */
  direction: DependencyDirection;
}

/** A starred project, as the sidebar lists it. */
export interface StarredProject {
  id: string;
  name: string;
  key: string;
  color: string;
  status: string;
  position: number;
}

/** Where one of my tasks sits in My Tasks. Absent means "Recently assigned". */
export interface MyTaskPlacement {
  taskId: string;
  bucket: MyTasksBucket;
  /** When its owner last moved it — a move made today outranks the auto-sort rules. */
  placedAt?: string;
}
