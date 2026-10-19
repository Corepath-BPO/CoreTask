import type { ColorToken } from '@coretask/contracts';

/** A tag as a task carries it. */
export interface TagRef {
  id: string;
  name: string;
  color: ColorToken;
}

/** A workspace tag, with how many tasks carry it. */
export interface Tag extends TagRef {
  taskCount: number;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface CreateTagPayload {
  name: string;
  color?: ColorToken;
}

export interface UpdateTagPayload {
  name?: string;
  color?: ColorToken;
}

/** Tag a task: an existing tag by id, or by name — made when it does not exist. */
export interface AddTaskTagPayload {
  tagId?: string;
  name?: string;
}
