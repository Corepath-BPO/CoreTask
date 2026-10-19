import type { InboundEmailOutcome, InboundEmailSender } from '@coretask/contracts';

/** One message that reached a project's address, and what became of it. */
export interface InboundEmailRecord {
  id: string;
  fromAddress: string;
  subject: string;
  outcome: InboundEmailOutcome;
  /** Why a message was turned away; null otherwise. */
  reason: string | null;
  /** The task it made or commented on, while that task still exists. */
  taskId: string | null;
  receivedAt: string;
}

/** Customize › Emails: a project's address and how mail to it is handled. */
export interface ProjectEmailSettings {
  /** Null while the server receives no mail (no inbound domain is set). */
  address: string | null;
  /** Whether the server is set up to receive mail at all. */
  receiving: boolean;
  isActive: boolean;
  sectionId: string | null;
  acceptFrom: InboundEmailSender;
  addCollaborators: boolean;
  sendUpdates: boolean;
  receivedCount: number;
  recent: InboundEmailRecord[];
}

export interface UpdateProjectEmailPayload {
  isActive?: boolean;
  sectionId?: string | null;
  acceptFrom?: InboundEmailSender;
  addCollaborators?: boolean;
  sendUpdates?: boolean;
}
