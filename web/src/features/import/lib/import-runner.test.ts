import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/api-error';

import type { ImportPlan, ImportTask } from './asana-import';
import {
  FAST_SPACING_MS,
  SAFE_SPACING_MS,
  estimateRequestCount,
  runImport,
  type ImportProgress,
  type ImportRunnerDeps,
} from './import-runner';

/* ------------------------------------------------------------------ fakes */

function task(overrides: Partial<ImportTask>): ImportTask {
  return {
    rowIndex: 2,
    title: 'task',
    description: null,
    sectionIndex: 0,
    parentIndex: null,
    done: false,
    priority: null,
    assigneeUserId: null,
    assigneeEmail: null,
    startDate: null,
    dueDate: null,
    customValues: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return {
    projectName: 'Imported',
    sections: ['First'],
    tasks: [task({ title: 'Parent' }), task({ title: 'Child', parentIndex: 0, sectionIndex: null })],
    customFieldColumns: [],
    warnings: [],
    blockingError: null,
    stats: {
      topLevel: 1,
      subtasks: 1,
      skippedEmptyName: 0,
      flattened: 0,
      orphaned: 0,
      assigneesMatched: 0,
      assigneesUnmatched: 0,
      unmatchedEmails: [],
    },
    ...overrides,
  };
}

interface Call {
  kind: string;
  payload?: unknown;
}

function makeDeps(behaviour: {
  failWorkItemTitles?: string[];
  failSectionNames?: string[];
  workItemErrors?: (() => Error)[];
}): { deps: ImportRunnerDeps; calls: Call[]; sleeps: number[] } {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let ids = 0;
  const nextId = (prefix: string) => `${prefix}-${++ids}`;

  const deps: ImportRunnerDeps = {
    createProject: async (_ws, payload) => {
      calls.push({ kind: 'project', payload });
      return {
        id: 'project-1',
        sections: [
          { id: 'default-1', name: 'Backlog' },
          { id: 'default-2', name: 'In Progress' },
          { id: 'default-3', name: 'In Review' },
          { id: 'default-4', name: 'Done' },
        ],
      } as never;
    },
    removeSection: async (_ws, _project, sectionId) => {
      calls.push({ kind: 'remove-section', payload: sectionId });
      return { deleted: true, reassignedTaskCount: 0 };
    },
    createSection: async (_ws, _project, payload) => {
      calls.push({ kind: 'section', payload });
      if (behaviour.failSectionNames?.includes(payload.name)) {
        throw new ApiError({ code: 'VALIDATION_FAILED', message: 'nope', status: 400 });
      }
      return { id: nextId('section'), name: payload.name } as never;
    },
    createCustomField: async (_ws, _project, payload) => {
      calls.push({ kind: 'field', payload });
      return {
        id: nextId('field'),
        name: payload.name,
        options: (payload.options ?? []).map((option) => ({
          id: nextId('option'),
          label: option.label,
        })),
      } as never;
    },
    createWorkItem: async (_ws, _project, payload) => {
      calls.push({ kind: 'work-item', payload });
      const queued = behaviour.workItemErrors?.shift();
      if (queued) throw queued();
      if (behaviour.failWorkItemTitles?.includes(payload.title)) {
        throw new ApiError({ code: 'VALIDATION_FAILED', message: 'nope', status: 400 });
      }
      return { id: nextId('task') } as never;
    },
    setCustomFieldValue: async (_ws, taskId, fieldId, payload) => {
      calls.push({ kind: 'value', payload: { taskId, fieldId, ...payload } });
      return {};
    },
    listViews: async () => {
      calls.push({ kind: 'list-views' });
      return [
        { id: 'view-board', type: 'BOARD', isDefault: true, settings: { columns: [] } },
        { id: 'view-list', type: 'LIST', isDefault: true, settings: { columns: [{ field: 'title' }] } },
      ] as never;
    },
    updateView: async (_ws, _project, viewId, payload) => {
      calls.push({ kind: 'update-view', payload: { viewId, ...payload } });
      return {} as never;
    },
    sleep: async (ms, signal) => {
      sleeps.push(ms);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    },
    now: () => 0,
  };

  return { deps, calls, sleeps };
}

function run(
  plan: ImportPlan,
  deps: ImportRunnerDeps,
  options: { includedColumns?: boolean[]; signal?: AbortSignal; onProgress?: (p: ImportProgress) => void } = {},
) {
  return runImport({
    plan,
    workspaceId: 'ws-1',
    projectName: plan.projectName,
    includedColumns: options.includedColumns ?? plan.customFieldColumns.map(() => true),
    signal: options.signal ?? new AbortController().signal,
    onProgress: options.onProgress ?? (() => undefined),
    deps,
  });
}

/* ------------------------------------------------------------------ tests */

describe('runImport', () => {
  it('runs project → default deletes → sections → tasks in order', async () => {
    const { deps, calls } = makeDeps({});
    const result = await run(makePlan(), deps);

    expect(calls.map((call) => call.kind)).toEqual([
      'project',
      'remove-section',
      'remove-section',
      'remove-section',
      'remove-section',
      'section',
      'work-item',
      'work-item',
    ]);
    expect(result).toMatchObject({
      projectId: 'project-1',
      createdSections: 1,
      createdTasks: 1,
      createdSubtasks: 1,
      cancelled: false,
    });
    expect(result.errors).toHaveLength(0);
  });

  it('threads the created parent id into the subtask and sends DONE at create', async () => {
    const plan = makePlan({
      tasks: [
        task({ title: 'Parent', done: true }),
        task({ title: 'Child', parentIndex: 0, sectionIndex: null }),
      ],
    });
    const { deps, calls } = makeDeps({});
    await run(plan, deps);

    const workItems = calls.filter((call) => call.kind === 'work-item');
    expect(workItems[0]?.payload).toMatchObject({ statusId: 'DONE' });
    expect(workItems[1]?.payload).toMatchObject({ parentId: 'task-2' });
  });

  it('retries a 429 with the backoff ladder, then succeeds', async () => {
    let attempts = 0;
    const { deps, calls, sleeps } = makeDeps({
      workItemErrors: [
        () => {
          attempts++;
          return new ApiError({ code: 'RATE_LIMIT_EXCEEDED', message: 'slow down', status: 429 });
        },
        () => {
          attempts++;
          return new ApiError({ code: 'RATE_LIMIT_EXCEEDED', message: 'slow down', status: 429 });
        },
      ],
    });
    const result = await run(makePlan(), deps);

    expect(attempts).toBe(2);
    expect(sleeps).toContain(15_000);
    expect(sleeps).toContain(30_000);
    expect(result.errors).toHaveLength(0);
    expect(calls.filter((call) => call.kind === 'work-item')).toHaveLength(4); // 2 retries + 2 tasks
  });

  it('paces at the fast spacing until a 429, then settles to the safe one for good', async () => {
    const { deps, sleeps } = makeDeps({
      workItemErrors: [
        () => new ApiError({ code: 'RATE_LIMIT_EXCEEDED', message: 'slow down', status: 429 }),
      ],
    });
    await run(makePlan(), deps);

    // Backoff sleeps (15s+) aside, every gap before the 429 is the fast pace
    // and every gap after it is the safe one — the downgrade is permanent.
    const pacing = sleeps.filter((ms) => ms === FAST_SPACING_MS || ms === SAFE_SPACING_MS);
    const firstSafe = pacing.indexOf(SAFE_SPACING_MS);
    expect(firstSafe).toBeGreaterThan(0);
    expect(pacing.slice(0, firstSafe)).toEqual(Array(firstSafe).fill(FAST_SPACING_MS));
    expect(pacing.slice(firstSafe).every((ms) => ms === SAFE_SPACING_MS)).toBe(true);
    expect(pacing.slice(firstSafe).length).toBeGreaterThan(0);
  });

  it('aborts with partial results when 429 persists past the ladder', async () => {
    const always429 = () => new ApiError({ code: 'RATE_LIMIT_EXCEEDED', message: 'slow down', status: 429 });
    const { deps } = makeDeps({
      workItemErrors: [always429, always429, always429, always429, always429],
    });
    const result = await run(makePlan(), deps);

    expect(result.projectId).toBe('project-1');
    expect(result.createdSections).toBe(1);
    expect(result.createdTasks).toBe(0);
    expect(result.errors.some((error) => error.message.includes('rate-limiting'))).toBe(true);
  });

  it('records a failed task, skips its subtasks, and keeps going', async () => {
    const plan = makePlan({
      tasks: [
        task({ title: 'Broken parent' }),
        task({ title: 'Orphaned child', parentIndex: 0, sectionIndex: null }),
        task({ title: 'Healthy', sectionIndex: 0 }),
      ],
    });
    const { deps } = makeDeps({ failWorkItemTitles: ['Broken parent'] });
    const result = await run(plan, deps);

    expect(result.createdTasks).toBe(1);
    expect(result.createdSubtasks).toBe(0);
    expect(result.errors.map((error) => error.label)).toEqual(['Broken parent', 'Orphaned child']);
  });

  it('creates tasks without a section when the section itself failed', async () => {
    const { deps, calls } = makeDeps({ failSectionNames: ['First'] });
    const result = await run(makePlan(), deps);

    const workItem = calls.find((call) => call.kind === 'work-item');
    expect(workItem?.payload).not.toHaveProperty('sectionId');
    expect(result.errors.some((error) => error.label.includes('First'))).toBe(true);
    expect(result.createdTasks).toBe(1);
  });

  it('creates included custom fields and maps select labels to option ids', async () => {
    const plan = makePlan({
      customFieldColumns: [
        { header: 'Status', type: 'SINGLE_SELECT', options: ['New', 'Closed'], nonEmptyCount: 1 },
        { header: 'Effort', type: 'TEXT', options: null, nonEmptyCount: 1 },
      ],
      tasks: [task({ title: 'Only', customValues: ['Closed', 'Large'] })],
    });
    const { deps, calls } = makeDeps({});
    const result = await run(plan, deps, { includedColumns: [true, false] });

    // Only the included column becomes a field; only its value is written.
    expect(calls.filter((call) => call.kind === 'field')).toHaveLength(1);
    // Options arrive coloured, rotating the same palette the create dialog uses.
    expect(calls.find((call) => call.kind === 'field')?.payload).toMatchObject({
      options: [
        { label: 'New', colorToken: 'blue' },
        { label: 'Closed', colorToken: 'violet' },
      ],
    });
    const values = calls.filter((call) => call.kind === 'value');
    expect(values).toHaveLength(1);
    // Ids share one counter: section-1, field-2, option-3 ('New'),
    // option-4 ('Closed').
    expect(values[0]?.payload).toMatchObject({ optionIds: ['option-4'] });
    expect(result.valuesSet).toBe(1);
  });

  it('appends the created fields to the default List view so they render', async () => {
    const plan = makePlan({
      customFieldColumns: [
        { header: 'Status', type: 'SINGLE_SELECT', options: ['New'], nonEmptyCount: 1 },
      ],
      tasks: [task({ title: 'Only', customValues: ['New'] })],
    });
    const { deps, calls } = makeDeps({});
    await run(plan, deps);

    const update = calls.find((call) => call.kind === 'update-view');
    expect(update?.payload).toMatchObject({
      viewId: 'view-list',
      settings: { columns: [{ field: 'title' }, { field: 'custom:field-2' }] },
    });
  });

  it('skips the view requests when no custom columns are included', async () => {
    const { deps, calls } = makeDeps({});
    await run(makePlan(), deps);

    expect(calls.some((call) => call.kind === 'list-views')).toBe(false);
    expect(calls.some((call) => call.kind === 'update-view')).toBe(false);
  });

  it('sends numbers and dates with typed payloads', async () => {
    const plan = makePlan({
      customFieldColumns: [
        { header: 'Rate', type: 'NUMBER', options: null, nonEmptyCount: 1 },
        { header: 'Notified', type: 'DATE', options: null, nonEmptyCount: 1 },
      ],
      tasks: [task({ title: 'Only', customValues: ['100', '2026-08-21T00:00:00.000Z'] })],
    });
    const { deps, calls } = makeDeps({});
    await run(plan, deps);

    const values = calls.filter((call) => call.kind === 'value');
    expect(values[0]?.payload).toMatchObject({ number: 100 });
    expect(values[1]?.payload).toMatchObject({ date: '2026-08-21T00:00:00.000Z' });
  });

  it('stops promptly on cancellation and reports partial state', async () => {
    const controller = new AbortController();
    const { deps } = makeDeps({});
    const cancelAfter = 6; // project + 4 deletes + 1 section
    let seen = 0;
    const wrapped: ImportRunnerDeps = {
      ...deps,
      createWorkItem: async (...args) => {
        seen++;
        if (seen === 1) controller.abort();
        return deps.createWorkItem(...args);
      },
    };
    const result = await run(makePlan(), wrapped, { signal: controller.signal });

    expect(result.cancelled).toBe(true);
    expect(result.projectId).toBe('project-1');
    expect(seen).toBeLessThanOrEqual(cancelAfter);
  });

  it('aborts everything when the project itself cannot be created', async () => {
    const { deps } = makeDeps({});
    const failing: ImportRunnerDeps = {
      ...deps,
      createProject: async () => {
        throw new ApiError({ code: 'FORBIDDEN', message: 'no', status: 403 });
      },
    };
    const result = await run(makePlan(), failing);

    expect(result.projectId).toBeNull();
    expect(result.errors).toHaveLength(1);
  });

  it('reports monotonic progress ending at the estimated total', async () => {
    const plan = makePlan({
      customFieldColumns: [{ header: 'Status', type: 'TEXT', options: null, nonEmptyCount: 1 }],
      tasks: [
        task({ title: 'Parent', customValues: ['New'] }),
        task({ title: 'Child', parentIndex: 0, sectionIndex: null, customValues: [null] }),
      ],
    });
    const { deps } = makeDeps({});
    const seen: ImportProgress[] = [];
    await run(plan, deps, { onProgress: (progress) => seen.push(progress) });

    const total = estimateRequestCount(plan, [true]);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.done).toBeGreaterThanOrEqual(seen[i - 1]!.done);
    }
    expect(seen.at(-1)).toMatchObject({ done: total, total });
  });

  it('estimate matches the number of requests actually made on a clean run', async () => {
    const plan = makePlan({
      customFieldColumns: [
        { header: 'Status', type: 'SINGLE_SELECT', options: ['New'], nonEmptyCount: 2 },
      ],
      tasks: [
        task({ title: 'Parent', customValues: ['New'] }),
        task({ title: 'Child', parentIndex: 0, sectionIndex: null, customValues: ['New'] }),
      ],
    });
    const { deps, calls } = makeDeps({});
    await run(plan, deps);

    expect(calls).toHaveLength(estimateRequestCount(plan, [true]));
  });
});
