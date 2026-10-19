import type { BlueprintPart, ProjectVisibility } from '@coretask/contracts';

import type { UpdateAuthor } from './project-updates.js';

/** A project template as the picker lists it. */
export interface ProjectTemplate {
  id: string;
  name: string;
  description: string | null;
  color: string;
  parts: BlueprintPart[];
  /** What it holds, for the picker's summary line. */
  sectionCount: number;
  taskCount: number;
  ruleCount: number;
  fieldCount: number;
  createdBy: UpdateAuthor | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectTemplatePayload {
  /** The project it is taken from. */
  projectId: string;
  name: string;
  description?: string | null;
  parts?: BlueprintPart[];
}

/** Starting a project from a template, or duplicating one. */
export interface StartProjectPayload {
  name: string;
  /** The day task dates count from; today when left out. */
  startDate?: string | null;
  visibility?: ProjectVisibility;
  teamId?: string | null;
}

export interface DuplicateProjectPayload extends StartProjectPayload {
  parts?: BlueprintPart[];
}

/** What starting a project left out, so the person can be told. */
export interface StartedProject {
  projectId: string;
  /** Rules that were live in the source but need an answer here first. */
  rulesNeedingAttention: string[];
  /** Rules not copied because the starter may not manage rules. */
  rulesSkipped: number;
}
