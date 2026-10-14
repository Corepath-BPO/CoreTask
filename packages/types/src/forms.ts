import type { FormQuestionKind } from '@coretask/contracts';

export interface FormQuestion {
  id: string;
  label: string;
  kind: FormQuestionKind;
  required: boolean;
  /** For a choice question: what may be chosen. */
  options?: string[];
}

/** A project's form, as its editors see it. */
export interface ProjectForm {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  token: string;
  isActive: boolean;
  sectionId: string | null;
  questions: FormQuestion[];
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFormDraft {
  name: string;
  description?: string | null;
  isActive?: boolean;
  sectionId?: string | null;
  questions?: FormQuestion[];
}

/** What the public page shows: no ids beyond the questions', nothing internal. */
export interface PublicForm {
  name: string;
  description: string | null;
  projectName: string;
  questions: FormQuestion[];
}

export interface FormSubmission {
  title: string;
  details?: string | null;
  /** Keyed by question id. */
  answers?: Record<string, string>;
}
