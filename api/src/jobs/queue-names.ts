/**
 * Queue and job names.
 *
 * Producers (API process) and consumers (worker process) both import these, so
 * a rename cannot silently orphan jobs already sitting in Redis.
 */
export const QueueName = {
  EMAIL: 'coretask.email',
  MAINTENANCE: 'coretask.maintenance',
  AUTOMATION: 'coretask.automation',
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];

export const AutomationJob = {
  /** A domain event that may match one or more rules. */
  EVENT: 'automation-event',
} as const;
export type AutomationJob = (typeof AutomationJob)[keyof typeof AutomationJob];

export const MaintenanceJob = {
  /** Removes uploads that were started and never finished. */
  SWEEP_ABANDONED_UPLOADS: 'sweep-abandoned-uploads',
} as const;
export type MaintenanceJob = (typeof MaintenanceJob)[keyof typeof MaintenanceJob];

export const EmailJob = {
  WELCOME: 'welcome',
  INVITATION: 'invitation',
} as const;
export type EmailJob = (typeof EmailJob)[keyof typeof EmailJob];

export interface WelcomeEmailJobData {
  userId: string;
  email: string;
  name: string;
}

/**
 * Carries the *raw* invitation token, because the accept link is the only place
 * it ever exists in the clear — the database holds a hash. Jobs are removed on
 * completion, so it does not linger in Redis.
 */
export interface InvitationEmailJobData {
  email: string;
  token: string;
  workspaceName: string;
  invitedByName: string;
  role: string;
  /** Null when the invitation names no team. */
  teamName: string | null;
  expiresAt: string;
}

export type EmailJobData = WelcomeEmailJobData | InvitationEmailJobData;
