import type { ProjectStatusValue } from '@coretask/contracts';

export interface UpdateAuthor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** One posted status update. */
export interface ProjectStatusUpdate {
  id: string;
  projectId: string;
  status: ProjectStatusValue;
  title: string;
  summary: string | null;
  nextSteps: string | null;
  author: UpdateAuthor | null;
  createdAt: string;
}

/**
 * A status update a rule's "Draft an update with AI…" step wrote, waiting for
 * a person to review and post it. One per project; posting any update clears
 * it.
 */
export interface ProjectStatusDraft {
  id: string;
  projectId: string;
  status: ProjectStatusValue;
  title: string;
  summary: string | null;
  nextSteps: string | null;
  /** The rule that drafted it; null once that rule is gone. */
  rule: { id: string; name: string } | null;
  createdAt: string;
}

/** A status update on a portfolio as a whole. */
export interface PortfolioStatusUpdate {
  id: string;
  portfolioId: string;
  status: ProjectStatusValue;
  title: string;
  summary: string | null;
  nextSteps: string | null;
  author: UpdateAuthor | null;
  createdAt: string;
}

export interface ProjectMessageReply {
  id: string;
  body: string;
  author: UpdateAuthor | null;
  createdAt: string;
}

/** A message with its replies, oldest first — the shape a project's and a portfolio's share. */
export interface ThreadMessage {
  id: string;
  title: string;
  /** Sanitised HTML. */
  body: string;
  author: UpdateAuthor | null;
  replies: ProjectMessageReply[];
  createdAt: string;
}

/** A message on a project's Messages tab. */
export interface ProjectMessage extends ThreadMessage {
  projectId: string;
}

/** A message on a portfolio's Messages tab. */
export interface PortfolioMessage extends ThreadMessage {
  portfolioId: string;
}

/** A conversation on a team's Messages tab. */
export interface TeamMessage extends ThreadMessage {
  teamId: string;
}

/** Who a "Request status update" went to. */
export interface StatusRequestResult {
  recipient: { id: string; name: string };
}

export interface PostStatusUpdatePayload {
  status: ProjectStatusValue;
  title: string;
  summary?: string | null;
  nextSteps?: string | null;
}

export interface PostProjectMessagePayload {
  title: string;
  body: string;
}

/** A file on a project's Files tab: an attachment, and the task it is on. */
export interface ProjectFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploader: UpdateAuthor | null;
  task: { id: string; title: string } | null;
}

/** A status update's starting point — Customize › Status templates. */
export interface StatusTemplate {
  id: string;
  projectId: string;
  name: string;
  /** The status the composer starts on; null keeps whatever was picked. */
  status: ProjectStatusValue | null;
  summary: string | null;
  nextSteps: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StatusTemplateDraft {
  name: string;
  status?: ProjectStatusValue | null;
  summary?: string | null;
  nextSteps?: string | null;
}
