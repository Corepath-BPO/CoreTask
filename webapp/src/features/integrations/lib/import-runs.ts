import type { AsanaImportStatus } from '@coretask/types';

/** Whether a run is still going, which is what keeps the page polling and the button off. */
export function isRunActive(status: AsanaImportStatus | undefined): boolean {
  return Boolean(status?.runs.some((run) => run.status === 'QUEUED' || run.status === 'RUNNING'));
}
