import { TaskPriority } from '@coretask/contracts';

import type { ParsedCsv } from './parse-csv';

/**
 * Turns a parsed Asana CSV export into an import plan — a pure description of
 * what to create, in what order, with every judgement call already made and
 * every compromise recorded as a warning. The runner that executes the plan
 * never has to interpret CSV again.
 */

/** The work-items API caps — truncating beats a mid-import validation error. */
const TITLE_MAX = 500;
const DESCRIPTION_MAX = 20_000;
const FIELD_NAME_MAX = 80;
const OPTION_LABEL_MAX = 80;
const MAX_SECTIONS = 50;

export interface ImportTask {
  /** 1-based CSV line, for error reporting (the header is line 1). */
  rowIndex: number;
  title: string;
  description: string | null;
  /** Into `ImportPlan.sections`; null for subtasks (they follow their parent). */
  sectionIndex: number | null;
  /** Into `ImportPlan.tasks`; null means top-level. */
  parentIndex: number | null;
  /** `Completed At` was set — created with status DONE. */
  done: boolean;
  priority: TaskPriority | null;
  assigneeUserId: string | null;
  assigneeEmail: string | null;
  startDate: string | null;
  dueDate: string | null;
  /** Raw cell text, parallel to `ImportPlan.customFieldColumns`. */
  customValues: (string | null)[];
}

export type ImportColumnType = 'TEXT' | 'NUMBER' | 'DATE' | 'SINGLE_SELECT';

export interface ImportCustomColumn {
  header: string;
  type: ImportColumnType;
  /** Distinct labels in first-appearance order; SINGLE_SELECT only. */
  options: string[] | null;
  /** How many rows carry a value — this is what the import's ETA is made of. */
  nonEmptyCount: number;
}

export interface ImportWarning {
  rowIndex: number | null;
  message: string;
}

export interface ImportPlan {
  projectName: string;
  sections: string[];
  tasks: ImportTask[];
  customFieldColumns: ImportCustomColumn[];
  warnings: ImportWarning[];
  /** Non-null makes the plan unimportable — shown instead of the Import button. */
  blockingError: string | null;
  stats: {
    topLevel: number;
    subtasks: number;
    skippedEmptyName: number;
    flattened: number;
    orphaned: number;
    assigneesMatched: number;
    assigneesUnmatched: number;
    unmatchedEmails: string[];
  };
}

/**
 * The columns every Asana export carries. Anything outside this set is a
 * user-defined custom field. Matching by name rather than position survives
 * Asana reordering or dropping columns; the cost — a custom field literally
 * named "Tags" would be swallowed — is accepted and small.
 */
const KNOWN_HEADERS = new Set([
  'Task ID',
  'Created At',
  'Completed At',
  'Last Modified',
  'Name',
  'Section/Column',
  'Assignee',
  'Assignee Email',
  'Start Date',
  'Due Date',
  'Tags',
  'Notes',
  'Projects',
  'Parent task',
  'Blocked By (Dependencies)',
  'Blocking (Dependencies)',
]);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Asana writes plain dates; the API demands full ISO datetimes. Midnight UTC
 * is the least surprising reading of a date with no time.
 */
function toIsoZ(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (DATE_ONLY.test(trimmed)) return `${trimmed}T00:00:00.000Z`;

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return null;
}

function isDateLike(value: string): boolean {
  return DATE_ONLY.test(value) || (value.includes('T') && Number.isFinite(Date.parse(value)));
}

/** Strict — `1,200` stays TEXT rather than silently becoming 1. */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * What kind of field a custom column should become, judged from its values.
 * Every rule requires ALL values to conform: a half-matching column falls
 * back to TEXT, which never loses data, while a wrong NUMBER or SINGLE_SELECT
 * either fails the write or mangles the value. CHECKBOX is deliberately never
 * guessed — a false positive destroys data.
 */
function detectColumnType(values: string[]): { type: ImportColumnType; options: string[] | null } {
  if (values.every(isDateLike)) return { type: 'DATE', options: null };
  if (values.every((value) => NUMERIC.test(value))) return { type: 'NUMBER', options: null };

  const distinct: string[] = [];
  for (const value of values) {
    if (!distinct.includes(value)) distinct.push(value);
  }
  const averageLength = values.reduce((sum, value) => sum + value.length, 0) / values.length;
  if (
    distinct.length <= 20 &&
    distinct.every((value) => value.length <= OPTION_LABEL_MAX) &&
    averageLength <= 40
  ) {
    return { type: 'SINGLE_SELECT', options: distinct };
  }

  return { type: 'TEXT', options: null };
}

export function buildImportPlan(
  csv: ParsedCsv,
  options: {
    /** Lowercased member email → user id, from the workspace member list. */
    membersByEmail: ReadonlyMap<string, string>;
    fileName: string;
  },
): ImportPlan {
  const { headers, rows } = csv;
  const column = (name: string) => headers.indexOf(name);

  const nameCol = column('Name');
  const sectionCol = column('Section/Column');
  const parentCol = column('Parent task');
  const emailCol = column('Assignee Email');
  const notesCol = column('Notes');
  const projectsCol = column('Projects');
  const completedCol = column('Completed At');
  const startCol = column('Start Date');
  const dueCol = column('Due Date');
  const tagsCol = column('Tags');
  const priorityCol = headers.findIndex((header) => header.toLowerCase() === 'priority');

  const warnings: ImportWarning[] = [];

  if (nameCol === -1) {
    return {
      projectName: options.fileName.replace(/\.csv$/i, ''),
      sections: [],
      tasks: [],
      customFieldColumns: [],
      warnings,
      blockingError: 'This file has no "Name" column. It does not look like an Asana export.',
      stats: emptyStats(),
    };
  }

  /*
   * The Priority column is consumed as the system priority only when every
   * value maps onto the enum — otherwise it stays an ordinary custom column,
   * because half-importing it would silently drop the values that don't fit.
   */
  const priorityValues = rows
    .map((row) => (priorityCol === -1 ? '' : (row[priorityCol] ?? '').trim()))
    .filter((value) => value !== '');
  const priorityIsSystem =
    priorityCol !== -1 &&
    priorityValues.length > 0 &&
    priorityValues.every((value) => (Object.values(TaskPriority) as string[]).includes(value.toUpperCase()));

  /* ---- custom columns ------------------------------------------------- */

  const customColumnIndices = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => {
      if (header === '' || KNOWN_HEADERS.has(header)) return false;
      if (priorityIsSystem && index === priorityCol) return false;
      return true;
    });

  const customFieldColumns: ImportCustomColumn[] = [];
  const includedCustomIndices: number[] = [];
  for (const { header, index } of customColumnIndices) {
    const values = rows.map((row) => (row[index] ?? '').trim()).filter((value) => value !== '');
    // A column nobody filled in tells the reader nothing — drop it silently.
    if (values.length === 0) continue;

    const { type, options: selectOptions } = detectColumnType(values);
    let name = header.trim();
    if (name.length > FIELD_NAME_MAX) {
      name = name.slice(0, FIELD_NAME_MAX);
      warnings.push({
        rowIndex: null,
        message: `Column "${header}" was renamed to fit the 80-character field name limit.`,
      });
    }
    customFieldColumns.push({
      header: name,
      type,
      options: selectOptions,
      // DATE values are converted here so the runner never parses CSV text.
      nonEmptyCount: values.length,
    });
    includedCustomIndices.push(index);
  }

  /* ---- tasks ----------------------------------------------------------- */

  const sections: string[] = [];
  const sectionIndexByName = new Map<string, number>();
  let noSectionIndex: number | null = null;

  const tasks: ImportTask[] = [];
  /** Most recently seen task per name — how duplicate parent names resolve. */
  const lastSeenByName = new Map<string, number>();

  const stats = emptyStats();
  let projectName = '';
  let taggedRows = 0;

  rows.forEach((row, rowOffset) => {
    // Header is line 1; data starts at line 2. Multi-line cells shift real
    // file lines, but a stable row number still finds the record.
    const rowIndex = rowOffset + 2;

    const name = (row[nameCol] ?? '').trim();
    if (name === '') {
      stats.skippedEmptyName++;
      return;
    }

    if (projectName === '' && projectsCol !== -1) {
      projectName = (row[projectsCol] ?? '').trim();
    }
    if (tagsCol !== -1 && (row[tagsCol] ?? '').trim() !== '') taggedRows++;

    const parentName = parentCol === -1 ? '' : (row[parentCol] ?? '').trim();

    let parentIndex: number | null = null;
    let sectionIndex: number | null = null;

    if (parentName === '') {
      const sectionName = sectionCol === -1 ? '' : (row[sectionCol] ?? '').trim();
      if (sectionName === '') {
        // Deterministic beats floating: unsectioned tasks get a visible home.
        if (noSectionIndex === null) {
          noSectionIndex = sections.length;
          sections.push('(No section)');
        }
        sectionIndex = noSectionIndex;
      } else {
        const existing = sectionIndexByName.get(sectionName);
        if (existing !== undefined) {
          sectionIndex = existing;
        } else {
          sectionIndex = sections.length;
          sections.push(sectionName);
          sectionIndexByName.set(sectionName, sectionIndex);
        }
      }
      stats.topLevel++;
    } else {
      const candidate = lastSeenByName.get(parentName);
      if (candidate === undefined) {
        // The parent was skipped or never exported. Losing the row would be
        // worse than losing the nesting.
        parentIndex = null;
        sectionIndex = sections.length > 0 ? 0 : null;
        stats.orphaned++;
        stats.topLevel++;
        warnings.push({
          rowIndex,
          message: `Parent "${parentName}" was not found. Imported as a top-level task.`,
        });
      } else if (tasks[candidate]!.parentIndex === null) {
        parentIndex = candidate;
        stats.subtasks++;
      } else {
        /*
         * The parent is itself a subtask — deeper nesting than the API
         * allows. Subtasks only ever store top-level parents, so one hop
         * reaches the top-level ancestor no matter how deep the original.
         */
        parentIndex = tasks[candidate]!.parentIndex;
        stats.flattened++;
        stats.subtasks++;
      }
    }

    let title = name;
    if (title.length > TITLE_MAX) {
      title = title.slice(0, TITLE_MAX);
      warnings.push({ rowIndex, message: 'Task name was shortened to 500 characters.' });
    }

    let description: string | null = notesCol === -1 ? null : (row[notesCol] ?? '').trim() || null;
    if (description && description.length > DESCRIPTION_MAX) {
      description = description.slice(0, DESCRIPTION_MAX);
      warnings.push({ rowIndex, message: 'Description was shortened to 20,000 characters.' });
    }

    const email = emailCol === -1 ? '' : (row[emailCol] ?? '').trim();
    let assigneeUserId: string | null = null;
    if (email !== '') {
      assigneeUserId = options.membersByEmail.get(email.toLowerCase()) ?? null;
      if (assigneeUserId) {
        stats.assigneesMatched++;
      } else {
        stats.assigneesUnmatched++;
        if (!stats.unmatchedEmails.includes(email)) stats.unmatchedEmails.push(email);
      }
    }

    const startRaw = startCol === -1 ? '' : (row[startCol] ?? '');
    const dueRaw = dueCol === -1 ? '' : (row[dueCol] ?? '');
    const startDate = toIsoZ(startRaw);
    const dueDate = toIsoZ(dueRaw);
    if (startRaw.trim() !== '' && startDate === null) {
      warnings.push({ rowIndex, message: `Unreadable start date "${startRaw.trim()}" was skipped.` });
    }
    if (dueRaw.trim() !== '' && dueDate === null) {
      warnings.push({ rowIndex, message: `Unreadable due date "${dueRaw.trim()}" was skipped.` });
    }

    const priorityRaw =
      priorityIsSystem && priorityCol !== -1 ? (row[priorityCol] ?? '').trim().toUpperCase() : '';

    tasks.push({
      rowIndex,
      title,
      description,
      sectionIndex,
      parentIndex,
      done: completedCol !== -1 && (row[completedCol] ?? '').trim() !== '',
      priority: priorityRaw === '' ? null : (priorityRaw as TaskPriority),
      assigneeUserId,
      assigneeEmail: email || null,
      startDate,
      dueDate,
      customValues: includedCustomIndices.map((index) => {
        const value = (row[index] ?? '').trim();
        return value === '' ? null : value;
      }),
    });

    // Registered after push so a task can never resolve itself as parent.
    // Last write wins: Asana emits subtasks right after their parent, so the
    // nearest preceding occurrence is the right owner for a reused name.
    lastSeenByName.set(name, tasks.length - 1);
  });

  // DATE custom values are converted once here — the runner sends them as-is.
  customFieldColumns.forEach((columnMeta, columnIndex) => {
    if (columnMeta.type !== 'DATE') return;
    for (const task of tasks) {
      const raw = task.customValues[columnIndex];
      if (raw !== null && raw !== undefined) task.customValues[columnIndex] = toIsoZ(raw);
    }
  });

  if (taggedRows > 0) {
    warnings.push({
      rowIndex: null,
      message: `Tags are not imported. ${taggedRows} row${taggedRows === 1 ? '' : 's'} had tags.`,
    });
  }

  const blockingError =
    sections.length > MAX_SECTIONS
      ? `This export has ${sections.length} sections; a CoreTask project allows ${MAX_SECTIONS}.`
      : null;

  return {
    projectName: projectName || options.fileName.replace(/\.csv$/i, '').trim() || 'Imported project',
    sections,
    tasks,
    customFieldColumns,
    warnings,
    blockingError,
    stats,
  };
}

function emptyStats(): ImportPlan['stats'] {
  return {
    topLevel: 0,
    subtasks: 0,
    skippedEmptyName: 0,
    flattened: 0,
    orphaned: 0,
    assigneesMatched: 0,
    assigneesUnmatched: 0,
    unmatchedEmails: [],
  };
}
