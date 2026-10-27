/**
 * Imports from other tools. Mirrors the Prisma enums of the same names; the
 * API's enum-parity test keeps the two in step.
 */

/** The tool an import read from. */
export const ImportSource = { ASANA: 'ASANA' } as const;
export type ImportSource = (typeof ImportSource)[keyof typeof ImportSource];
export const IMPORT_SOURCES = Object.values(ImportSource);

/** Where a run is. PARTIAL finished with records it could not bring across. */
export const ImportRunStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
} as const;
export type ImportRunStatus = (typeof ImportRunStatus)[keyof typeof ImportRunStatus];
export const IMPORT_RUN_STATUSES = Object.values(ImportRunStatus);
