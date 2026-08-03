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
} as const;
export type EmailJob = (typeof EmailJob)[keyof typeof EmailJob];

export interface WelcomeEmailJobData {
  userId: string;
  email: string;
  name: string;
}
