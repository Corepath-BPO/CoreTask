/**
 * Queue and job names.
 *
 * Producers (API process) and consumers (worker process) both import these, so
 * a rename cannot silently orphan jobs already sitting in Redis.
 */
export const QueueName = {
  EMAIL: 'coretask.email',
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];

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
  expiresAt: string;
}

export type EmailJobData = WelcomeEmailJobData | InvitationEmailJobData;
