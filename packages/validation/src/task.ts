import {
  DESCRIPTION_MAX_LENGTH,
  TASK_MAX_ESTIMATED_MINUTES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
  TASK_TITLE_MIN_LENGTH,
} from '@coretask/contracts';
import { z } from 'zod';

export const taskTitleSchema = z
  .string()
  .trim()
  .min(TASK_TITLE_MIN_LENGTH, 'Task title is required.')
  .max(TASK_TITLE_MAX_LENGTH, `Must be at most ${TASK_TITLE_MAX_LENGTH} characters.`);

export const taskStatusSchema = z.enum(
  TASK_STATUSES as unknown as [string, ...string[]],
  'Choose a valid status.',
);

export const taskPrioritySchema = z.enum(
  TASK_PRIORITIES as unknown as [string, ...string[]],
  'Choose a valid priority.',
);

/** Accepts an ISO date or datetime; an empty string clears the field. */
const optionalDate = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .refine((value) => value === null || !Number.isNaN(Date.parse(value)), 'Enter a valid date.');

const estimatedMinutes = z
  .number()
  .int('Enter a whole number of minutes.')
  .min(0, 'An estimate cannot be negative.')
  .max(TASK_MAX_ESTIMATED_MINUTES, 'That estimate is unrealistically large.');

export const createTaskSchema = z.object({
  title: taskTitleSchema,
  description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).optional(),
  projectId: z.uuid().nullable().optional(),
  sectionId: z.uuid().nullable().optional(),
  parentTaskId: z.uuid().nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.uuid().nullable().optional(),
  startDate: optionalDate.optional(),
  dueDate: optionalDate.optional(),
  estimatedMinutes: estimatedMinutes.nullable().optional(),
  afterTaskId: z.uuid().nullable().optional(),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: taskTitleSchema.optional(),
    description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeId: z.uuid().nullable().optional(),
    startDate: optionalDate.optional(),
    dueDate: optionalDate.optional(),
    estimatedMinutes: estimatedMinutes.nullable().optional(),
  })
  .refine((values) => Object.keys(values).length > 0, {
    message: 'Provide at least one field to update.',
  });
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export const moveTaskSchema = z.object({
  sectionId: z.uuid().nullable(),
  afterTaskId: z.uuid().nullable(),
});
export type MoveTaskInput = z.input<typeof moveTaskSchema>;

/**
 * Form-facing variant.
 *
 * Bound to controlled inputs, so every field is a string that starts as `''`
 * rather than `undefined`, and the date range only makes sense checked across
 * both fields at once.
 */
export const taskFormSchema = z
  .object({
    title: taskTitleSchema,
    description: z.string().trim().max(DESCRIPTION_MAX_LENGTH),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    assigneeId: z.string(),
    startDate: z.string().trim(),
    dueDate: z.string().trim(),
    estimatedMinutes: z
      .string()
      .trim()
      .refine(
        (value) =>
          value === '' || (/^\d+$/.test(value) && Number(value) <= TASK_MAX_ESTIMATED_MINUTES),
        'Enter a whole number of minutes.',
      ),
  })
  .refine(
    (values) =>
      !values.startDate ||
      !values.dueDate ||
      Date.parse(values.startDate) <= Date.parse(values.dueDate),
    { message: 'The due date cannot be before the start date.', path: ['dueDate'] },
  );
export type TaskFormInput = z.input<typeof taskFormSchema>;
