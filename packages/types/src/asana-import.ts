import type { ImportRunStatus } from '@coretask/contracts';

export interface ImportCounter {
  done: number;
  total?: number;
  skipped?: number;
}

/** One record that did not come across, and why. */
export interface ImportRunError {
  kind: string;
  externalId: string | null;
  name: string | null;
  message: string;
}

export interface ImportRun {
  id: string;
  workspaceId: string;
  status: ImportRunStatus;
  /** The step under way: `people`, `projects`, `tasks`, `subtasks`, `history`… */
  phase: string | null;
  /** Counters by kind; `requests` is a plain number of calls made to Asana. */
  counts: Record<string, ImportCounter | number>;
  /** The first failures; `errorCount` counts every one. */
  errors: ImportRunError[];
  errorCount: number;
  startedBy: { id: string; name: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ImportTargetWorkspace {
  id: string;
  name: string;
  slug: string;
}

/** Integrations › Asana, for whoever is looking. */
export interface AsanaImportStatus {
  /** Whether this server has an Asana token and workspace id. */
  configured: boolean;
  /** The settings missing when it does not, by variable name. */
  missing: string[];
  asanaWorkspace: { gid: string; name: string } | null;
  /** Whether the viewer may start an import: a member, not a guest, of that Asana workspace. */
  eligible: boolean;
  /** Why not, when they may not. */
  reason: string | null;
  /** The CoreTask workspace that holds the import, when the viewer belongs to it. */
  target: ImportTargetWorkspace | null;
  /** True when the page is open in that workspace — where "Sync again" lives. */
  isTarget: boolean;
  /** This workspace's runs, newest first. */
  runs: ImportRun[];
  /** Live sync, when the page is open in the workspace that holds the import. */
  liveSync: AsanaLiveSyncStatus | null;
}

/**
 * Live sync from Asana: changes made there come across within a minute or
 * two, read from each project's Asana event stream. Asana is only read.
 */
export interface AsanaLiveSyncStatus {
  enabled: boolean;
  enabledBy: { id: string; name: string } | null;
  enabledAt: string | null;
  /** A full Sync again runs before the next live check: just switched on, or a stream lapsed. */
  fullSyncPending: boolean;
  lastPolledAt: string | null;
  /** When the last change from Asana was applied. */
  lastChangeAt: string | null;
  /** Tasks updated from Asana today (UTC). */
  changesToday: number;
  /** The last problem, in a sentence; cleared by the next clean check. */
  lastError: string | null;
}

export interface StartAsanaImportResult {
  run: ImportRun;
  workspace: ImportTargetWorkspace;
}
