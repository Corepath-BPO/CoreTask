import type { StatusCategory } from '@coretask/contracts';

/** A task status: a name people read, and a category code reasons about. */
export interface StatusDefinition {
  id: string;
  /** Null for the workspace's own set, which a project uses until it changes one. */
  projectId: string | null;
  name: string;
  category: StatusCategory;
  colorToken: string;
  position: number;
  isDefault: boolean;
  isArchived: boolean;
}

/** A workspace priority; `level` orders urgency, highest first. */
export interface PriorityDefinition {
  id: string;
  name: string;
  level: number;
  colorToken: string;
  position: number;
  isDefault: boolean;
  isArchived: boolean;
}
