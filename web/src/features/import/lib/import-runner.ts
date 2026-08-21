import type { CustomField, ProjectDetail, ProjectWorkItem, Section } from '@coretask/types';

import { ApiError } from '@/lib/api/api-error';
import { customFieldsApi, projectViewsApi } from '@/features/projects/api/project-views.api';
import { nextOptionColor } from '@/features/projects/components/field-picker/field-type-registry';
import { projectsApi, sectionsApi } from '@/features/projects/api/projects.api';
import { workItemsApi } from '@/features/work-items/api/work-items.api';

import type { ImportPlan } from './asana-import';

/**
 * Executes an ImportPlan against the real API, one request at a time.
 *
 * Pacing is adaptive: requests start at the fast spacing and drop to the safe
 * one the moment the server answers 429, permanently for the run. On a server
 * with the default 120 requests/min throttle that costs one backoff early on
 * and then behaves exactly like the old fixed pace; on a server whose limit
 * was raised (RATE_LIMIT_MAX in .env) the whole import runs ~6× faster. The
 * axios client retries nothing, so the 429 handling lives here.
 */

/** ≈600 requests/min — the opening pace, held until the server pushes back. */
export const FAST_SPACING_MS = 100;
/** ≈100 requests/min — adopted for the rest of the run after the first 429. */
export const SAFE_SPACING_MS = 600;

const DEFAULT_SECTION_COUNT = 4;
const TEXT_VALUE_MAX = 2000;

export type ImportPhase =
  | 'project'
  | 'cleanup'
  | 'sections'
  | 'fields'
  | 'columns'
  | 'tasks'
  | 'values';

export interface ImportProgress {
  phase: ImportPhase;
  /** Requests resolved so far, successes and recorded failures alike. */
  done: number;
  total: number;
  currentLabel: string;
  /** The current gap between request starts — the live ETA multiplier. */
  spacingMs: number;
}

export interface ImportRowError {
  rowIndex: number | null;
  label: string;
  message: string;
}

export interface ImportRunResult {
  /** Null only when creating the project itself failed. */
  projectId: string | null;
  createdSections: number;
  createdFields: number;
  createdTasks: number;
  createdSubtasks: number;
  valuesSet: number;
  errors: ImportRowError[];
  cancelled: boolean;
}

export interface ImportRunnerDeps {
  createProject: typeof projectsApi.create;
  createSection: typeof sectionsApi.create;
  removeSection: typeof sectionsApi.remove;
  createWorkItem: typeof workItemsApi.create;
  createCustomField: typeof customFieldsApi.create;
  setCustomFieldValue: typeof customFieldsApi.setValue;
  listViews: typeof projectViewsApi.list;
  updateView: typeof projectViewsApi.update;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
}

const REAL_DEPS: ImportRunnerDeps = {
  createProject: projectsApi.create,
  createSection: sectionsApi.create,
  removeSection: sectionsApi.remove,
  createWorkItem: workItemsApi.create,
  createCustomField: customFieldsApi.create,
  setCustomFieldValue: customFieldsApi.setValue,
  listViews: projectViewsApi.list,
  updateView: projectViewsApi.update,
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      // Reject on abort so a 60-second backoff cancels instantly rather than
      // holding the dialog hostage.
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }),
  now: () => Date.now(),
};

/**
 * Every write the run will make. The preview shows this number and the
 * duration derived from it — the honesty is the point, because a full export
 * with every column included is a long import and the user should choose it
 * knowingly.
 */
export function estimateRequestCount(plan: ImportPlan, includedColumns: boolean[]): number {
  const values = plan.customFieldColumns.reduce(
    (sum, column, index) => sum + (includedColumns[index] ? column.nonEmptyCount : 0),
    0,
  );
  const fields = includedColumns.filter(Boolean).length;
  // When fields are imported, two more requests make them visible: read the
  // project's views, write the List view's columns.
  const viewRequests = fields > 0 ? 2 : 0;
  return (
    1 +
    DEFAULT_SECTION_COUNT +
    plan.sections.length +
    fields +
    viewRequests +
    plan.tasks.length +
    values
  );
}

/**
 * Best and worst case for the preview: the fast pace holds when the server
 * never rate-limits, the safe pace is what a default 120/min server enforces.
 */
export function estimateDurationBoundsMs(
  plan: ImportPlan,
  includedColumns: boolean[],
): { fastMs: number; safeMs: number } {
  const count = estimateRequestCount(plan, includedColumns);
  return { fastMs: count * FAST_SPACING_MS, safeMs: count * SAFE_SPACING_MS };
}

/** Thrown internally to unwind the run; surfaced as `cancelled: true`. */
class ImportCancelled extends Error {}
/** Thrown when the run cannot meaningfully continue (project create, 429 wall). */
class ImportAborted extends Error {}

export async function runImport(args: {
  plan: ImportPlan;
  workspaceId: string;
  projectName: string;
  /** Parallel to plan.customFieldColumns. */
  includedColumns: boolean[];
  signal: AbortSignal;
  onProgress: (progress: ImportProgress) => void;
  deps?: Partial<ImportRunnerDeps>;
}): Promise<ImportRunResult> {
  const { plan, workspaceId, projectName, includedColumns, signal, onProgress } = args;
  const deps: ImportRunnerDeps = { ...REAL_DEPS, ...args.deps };

  const total = estimateRequestCount(plan, includedColumns);
  const result: ImportRunResult = {
    projectId: null,
    createdSections: 0,
    createdFields: 0,
    createdTasks: 0,
    createdSubtasks: 0,
    valuesSet: 0,
    errors: [],
    cancelled: false,
  };

  let done = 0;
  let phase: ImportPhase = 'project';
  let lastRequestStart = 0;
  let spacingMs = FAST_SPACING_MS;

  const report = (currentLabel: string) =>
    onProgress({ phase, done, total, currentLabel, spacingMs });

  /**
   * Paces, retries and counts one request. Returns null when the request
   * failed in a way the run survives — the caller records the error.
   */
  async function send<T>(label: string, request: () => Promise<T>): Promise<T | null> {
    // 429 backoff: wait out an ever-larger slice of the window and retry the
    // same request. If four rounds of waiting still hit the wall, something
    // else is eating the budget and continuing would just spin.
    const rateLimitWaits = [15_000, 30_000, 60_000, 60_000];
    const networkWaits = [2_000, 5_000];
    let rateLimitTry = 0;
    let networkTry = 0;

    for (;;) {
      if (signal.aborted) throw new ImportCancelled();

      const wait = Math.max(0, lastRequestStart + spacingMs - deps.now());
      if (wait > 0) await deps.sleep(wait, signal).catch(rethrowAsCancelled);

      report(label);
      lastRequestStart = deps.now();

      try {
        const response = await request();
        done++;
        report(label);
        return response;
      } catch (error) {
        if (signal.aborted) throw new ImportCancelled();

        const status = error instanceof ApiError ? error.status : undefined;
        const code = error instanceof ApiError ? error.code : undefined;

        if (status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
          // The server has told us its budget — settle to the pace that fits
          // under the default limit for everything that follows.
          spacingMs = SAFE_SPACING_MS;
          const backoff = rateLimitWaits[rateLimitTry++];
          if (backoff === undefined) {
            throw new ImportAborted(
              'The server kept rate-limiting the import — something else may be using the connection. The items created so far were kept.',
            );
          }
          report(`Rate limited — resuming in ${Math.round(backoff / 1000)}s`);
          await deps.sleep(backoff, signal).catch(rethrowAsCancelled);
          continue;
        }

        if (status === 0) {
          const backoff = networkWaits[networkTry++];
          if (backoff !== undefined) {
            await deps.sleep(backoff, signal).catch(rethrowAsCancelled);
            continue;
          }
        }

        // A validation failure will not heal on retry — record and move on.
        done++;
        return null;
      }
    }
  }

  try {
    /* -- project --------------------------------------------------------- */
    const project: ProjectDetail | null = await send(
      `Creating project "${projectName}"…`,
      () => deps.createProject(workspaceId, { name: projectName, defaultWorkItemType: 'TASK' }),
    );
    if (!project) {
      throw new ImportAborted('The project could not be created, so nothing was imported.');
    }
    result.projectId = project.id;

    /* -- cleanup: the four auto-created default sections ------------------ */
    phase = 'cleanup';
    const defaultSections: Section[] = project.sections ?? [];
    for (const section of defaultSections) {
      // Non-fatal: a leftover empty section is cosmetic, not corrupting.
      await send(`Removing default section "${section.name}"…`, () =>
        deps.removeSection(workspaceId, project.id, section.id),
      );
    }
    // If the project came with fewer than 4 defaults, keep `done` honest
    // against the estimate.
    done += Math.max(0, DEFAULT_SECTION_COUNT - defaultSections.length);

    /* -- sections ---------------------------------------------------------- */
    phase = 'sections';
    const sectionIds: (string | undefined)[] = [];
    for (const name of plan.sections) {
      const created = await send(`Creating section "${name}"…`, () =>
        deps.createSection(workspaceId, project.id, { name }),
      );
      if (!created) {
        result.errors.push({
          rowIndex: null,
          label: `Section "${name}"`,
          message: 'Could not be created — its tasks were imported without a section.',
        });
      } else {
        result.createdSections++;
      }
      sectionIds.push(created?.id);
    }

    /* -- custom field definitions ------------------------------------------ */
    phase = 'fields';
    const fields: (CustomField | undefined)[] = [];
    const optionIdsByLabel: (Map<string, string> | undefined)[] = [];
    for (let index = 0; index < plan.customFieldColumns.length; index++) {
      if (!includedColumns[index]) {
        fields.push(undefined);
        optionIdsByLabel.push(undefined);
        continue;
      }
      const column = plan.customFieldColumns[index]!;
      const created = await send(`Creating field "${column.header}"…`, () =>
        deps.createCustomField(workspaceId, project.id, {
          name: column.header,
          type: column.type,
          ...(column.options
            ? {
                options: column.options.map((label, index) => ({
                  label,
                  // Rotated through the same palette the create dialog starts
                  // from — a select of identical grey chips says nothing.
                  colorToken: nextOptionColor(index),
                })),
              }
            : {}),
        }),
      );
      if (!created) {
        result.errors.push({
          rowIndex: null,
          label: `Field "${column.header}"`,
          message: 'Could not be created — its values were skipped.',
        });
      } else {
        result.createdFields++;
      }
      fields.push(created ?? undefined);
      optionIdsByLabel.push(
        created?.options
          ? new Map(created.options.map((option) => [option.label, option.id]))
          : undefined,
      );
    }

    /* -- List view columns --------------------------------------------------- */
    // A field only *renders* when the saved List view names it as a column —
    // creating it is not enough. Without this step an import finishes with
    // every value stored and none of them visible.
    phase = 'columns';
    const createdFieldIds = fields.filter((field): field is CustomField => !!field).map((f) => f.id);
    const includedAny = includedColumns.some(Boolean);
    if (createdFieldIds.length > 0) {
      const views = await send('Adding the new fields to the List view…', () =>
        deps.listViews(workspaceId, project.id),
      );
      const listView =
        views?.find((view) => view.type === 'LIST' && view.isDefault) ??
        views?.find((view) => view.type === 'LIST');
      if (listView) {
        const columns = [
          ...listView.settings.columns,
          ...createdFieldIds.map((id) => ({ field: `custom:${id}` })),
        ];
        const updated = await send('Adding the new fields to the List view…', () =>
          deps.updateView(workspaceId, project.id, listView.id, { settings: { columns } }),
        );
        if (updated === null) {
          result.errors.push({
            rowIndex: null,
            label: 'List view',
            message:
              'The imported fields exist but could not be added as columns — add them from the Fields menu.',
          });
        }
      } else {
        // No List view to write into; the values are still there.
        done++;
        result.errors.push({
          rowIndex: null,
          label: 'List view',
          message:
            'No List view was found to add the imported fields to — add them from the Fields menu.',
        });
      }
    } else if (includedAny) {
      // Every field creation failed; the two view requests the estimate
      // counted are skipped, so keep the bar honest.
      done += 2;
    }

    /* -- tasks -------------------------------------------------------------- */
    phase = 'tasks';
    const taskIds: (string | undefined)[] = [];
    for (const task of plan.tasks) {
      const parentId = task.parentIndex === null ? undefined : taskIds[task.parentIndex];
      if (task.parentIndex !== null && parentId === undefined) {
        // The parent's own create failed; count the request we now skip so
        // the bar still reaches 100%.
        done++;
        result.errors.push({
          rowIndex: task.rowIndex,
          label: task.title,
          message: 'Skipped because its parent task was not created.',
        });
        taskIds.push(undefined);
        continue;
      }

      const sectionId =
        task.sectionIndex === null ? undefined : sectionIds[task.sectionIndex];

      const created: ProjectWorkItem | null = await send(
        `Creating task "${task.title.slice(0, 60)}"…`,
        () =>
          deps.createWorkItem(workspaceId, project.id, {
            type: 'TASK',
            title: task.title,
            ...(task.description ? { description: task.description } : {}),
            ...(sectionId ? { sectionId } : {}),
            ...(parentId ? { parentId } : {}),
            ...(task.done ? { statusId: 'DONE' } : {}),
            ...(task.priority ? { priorityId: task.priority } : {}),
            ...(task.assigneeUserId ? { assigneeIds: [task.assigneeUserId] } : {}),
            ...(task.startDate ? { startDate: task.startDate } : {}),
            ...(task.dueDate ? { dueDate: task.dueDate } : {}),
          }),
      );
      if (!created) {
        result.errors.push({
          rowIndex: task.rowIndex,
          label: task.title,
          message: 'The task could not be created.',
        });
      } else if (task.parentIndex === null) {
        result.createdTasks++;
      } else {
        result.createdSubtasks++;
      }
      taskIds.push(created?.id);
    }

    /* -- custom field values ------------------------------------------------- */
    phase = 'values';
    for (let taskIndex = 0; taskIndex < plan.tasks.length; taskIndex++) {
      const task = plan.tasks[taskIndex]!;
      const taskId = taskIds[taskIndex];

      for (let columnIndex = 0; columnIndex < plan.customFieldColumns.length; columnIndex++) {
        if (!includedColumns[columnIndex]) continue;
        const raw = task.customValues[columnIndex];
        if (raw === null || raw === undefined) continue;

        const field = fields[columnIndex];
        if (!taskId || !field) {
          // The task or the field never came to exist; the estimate counted
          // this request, so the skip still advances the bar.
          done++;
          continue;
        }

        const column = plan.customFieldColumns[columnIndex]!;
        let payload: Record<string, unknown>;
        switch (column.type) {
          case 'NUMBER':
            payload = { number: Number(raw) };
            break;
          case 'DATE':
            payload = { date: raw };
            break;
          case 'SINGLE_SELECT': {
            const optionId = optionIdsByLabel[columnIndex]?.get(raw);
            if (!optionId) {
              done++;
              result.errors.push({
                rowIndex: task.rowIndex,
                label: task.title,
                message: `No option "${raw}" exists on field "${column.header}".`,
              });
              continue;
            }
            payload = { optionIds: [optionId] };
            break;
          }
          default:
            payload = { text: raw.slice(0, TEXT_VALUE_MAX) };
        }

        const set = await send(
          `Setting "${column.header}" on "${task.title.slice(0, 40)}"…`,
          () => deps.setCustomFieldValue(workspaceId, taskId, field.id, payload),
        );
        if (set !== null) {
          result.valuesSet++;
        } else {
          result.errors.push({
            rowIndex: task.rowIndex,
            label: task.title,
            message: `The value for "${column.header}" could not be saved.`,
          });
        }
      }
    }

    onProgress({ phase, done: total, total, currentLabel: 'Finished', spacingMs });
    return result;
  } catch (error) {
    if (error instanceof ImportCancelled) {
      result.cancelled = true;
      return result;
    }
    if (error instanceof ImportAborted) {
      result.errors.push({ rowIndex: null, label: 'Import', message: error.message });
      return result;
    }
    throw error;
  }
}

function rethrowAsCancelled(): never {
  throw new ImportCancelled();
}
