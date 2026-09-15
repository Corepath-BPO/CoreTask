import { API_KEY_PREFIX, ApiRoutes, TaskPriority, TaskStatus } from '@coretask/contracts';

/**
 * The calls the playground offers: the handful an n8n flow makes against
 * CoreTask, in the order a flow usually makes them.
 *
 * Deliberately a short, curated list rather than the whole API. The docs page
 * (Swagger) is the complete reference; this is the guided path, with the ids
 * filled in from dropdowns instead of pasted.
 */

export type PlaygroundCallId =
  | 'whoami'
  | 'sections'
  | 'create-task'
  | 'get-task'
  | 'complete-task'
  | 'add-comment'
  | 'add-subtask'
  | 'subtasks';

export type PlaygroundMethod = 'GET' | 'POST' | 'PATCH';

/** How a field is drawn and filled. `project`/`section`/`taskId` get help from the workspace. */
export type PlaygroundFieldKind = 'text' | 'textarea' | 'select' | 'project' | 'section' | 'taskId';

export interface PlaygroundFieldSpec {
  key: string;
  label: string;
  kind: PlaygroundFieldKind;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: readonly { value: string; label: string }[];
  /** Left out of the request body: it only helps fill another field (the project behind a section). */
  helperOnly?: boolean;
}

export type PlaygroundValues = Record<string, string>;

export interface PlaygroundCall {
  id: PlaygroundCallId;
  label: string;
  description: string;
  method: PlaygroundMethod;
  /** The API accepts an `Idempotency-Key` header here. */
  idempotent?: boolean;
  fields: readonly PlaygroundFieldSpec[];
  path: (workspaceId: string, values: PlaygroundValues) => string;
  body?: (values: PlaygroundValues) => Record<string, unknown>;
  /**
   * What to remember from a successful answer, to hand to the next call. A
   * task's id becomes both the task and the parent the next calls point at; a
   * subtask's id becomes the task only, so its parent stays put.
   */
  produces?: 'taskId' | 'subtaskId';
  /** The answer is a list of records; any one's `id` can be handed to this field. */
  picks?: { key: string; label: string };
}

/** The ids the last successful answers left behind, by the field key they fill. */
export type PlaygroundHandoff = Partial<Record<'taskId' | 'parentTaskId', string | null>>;

const PRIORITY_OPTIONS = [
  { value: TaskPriority.NONE, label: 'None' },
  { value: TaskPriority.LOW, label: 'Low' },
  { value: TaskPriority.MEDIUM, label: 'Medium' },
  { value: TaskPriority.HIGH, label: 'High' },
  { value: TaskPriority.CRITICAL, label: 'Critical' },
] as const;

const PROJECT_FIELD: PlaygroundFieldSpec = {
  key: 'projectId',
  label: 'Project',
  kind: 'project',
  required: true,
  helperOnly: true,
};

const TASK_ID_FIELD: PlaygroundFieldSpec = {
  key: 'taskId',
  label: 'Task ID',
  kind: 'taskId',
  required: true,
  placeholder: 'The id from a create-task response',
};

/** Its own key, so adding a second subtask does not point at the first one. */
const PARENT_TASK_ID_FIELD: PlaygroundFieldSpec = {
  key: 'parentTaskId',
  label: 'Parent task ID',
  kind: 'taskId',
  required: true,
  placeholder: 'The id of the task the subtasks belong to',
};

/** Drops empty strings so an untouched optional field never reaches the API as `""`. */
function present(values: PlaygroundValues, keys: readonly string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    const value = values[key]?.trim();
    if (value) body[key] = value;
  }
  return body;
}

export const PLAYGROUND_CALLS: readonly PlaygroundCall[] = [
  {
    id: 'whoami',
    label: 'Who am I?',
    description:
      'Checks the credential and returns the workspace it belongs to. The first call every flow should make.',
    method: 'GET',
    fields: [],
    path: () => ApiRoutes.integration.whoami,
  },
  {
    id: 'sections',
    label: 'List sections',
    description: 'The sections of a project, with the ids a create-task call needs.',
    method: 'GET',
    fields: [{ ...PROJECT_FIELD, helperOnly: false }],
    path: (workspaceId, values) => ApiRoutes.sections.list(workspaceId, values['projectId'] ?? ''),
    picks: { key: 'sectionId', label: 'Section' },
  },
  {
    id: 'create-task',
    label: 'Create a task',
    description: 'Files a task into a section. The response carries the new task id.',
    method: 'POST',
    idempotent: true,
    produces: 'taskId',
    fields: [
      PROJECT_FIELD,
      {
        key: 'sectionId',
        label: 'Section',
        kind: 'section',
        required: true,
        hint: 'Decides which column the task appears in.',
      },
      { key: 'title', label: 'Title', kind: 'text', required: true, placeholder: 'Filed from n8n' },
      { key: 'description', label: 'Description', kind: 'textarea' },
      { key: 'priority', label: 'Priority', kind: 'select', options: PRIORITY_OPTIONS },
    ],
    path: (workspaceId) => ApiRoutes.tasks.create(workspaceId),
    body: (values) => present(values, ['sectionId', 'title', 'description', 'priority']),
  },
  {
    id: 'get-task',
    label: 'Get a task',
    description: 'Everything about one task, including who created it.',
    method: 'GET',
    fields: [TASK_ID_FIELD],
    path: (workspaceId, values) => ApiRoutes.tasks.detail(workspaceId, values['taskId'] ?? ''),
  },
  {
    id: 'complete-task',
    label: 'Complete a task',
    description: 'Marks a task done. Any other field of a task is changed the same way.',
    method: 'PATCH',
    fields: [TASK_ID_FIELD],
    path: (workspaceId, values) => ApiRoutes.tasks.update(workspaceId, values['taskId'] ?? ''),
    body: () => ({ status: TaskStatus.DONE }),
  },
  {
    id: 'add-comment',
    label: 'Add a comment',
    description: 'Posts a comment on a task, attributed to the credential that sent it.',
    method: 'POST',
    idempotent: true,
    fields: [
      TASK_ID_FIELD,
      {
        key: 'body',
        label: 'Comment',
        kind: 'textarea',
        required: true,
        placeholder: 'Deployed to staging.',
      },
    ],
    path: (workspaceId, values) => ApiRoutes.comments.forTask(workspaceId, values['taskId'] ?? ''),
    body: (values) => present(values, ['body']),
  },
  {
    id: 'add-subtask',
    label: 'Add a subtask',
    description:
      'Files a task under another one. A subtask is an ordinary task with a parent: complete it or comment on it by its own id.',
    method: 'POST',
    idempotent: true,
    produces: 'subtaskId',
    fields: [
      PARENT_TASK_ID_FIELD,
      {
        key: 'subtaskTitle',
        label: 'Subtask title',
        kind: 'text',
        required: true,
        placeholder: 'Check the deploy',
      },
    ],
    path: (workspaceId) => ApiRoutes.tasks.create(workspaceId),
    body: (values) => {
      const body = present(values, ['parentTaskId']);
      const title = values['subtaskTitle']?.trim();
      if (title) body['title'] = title;
      return body;
    },
  },
  {
    id: 'subtasks',
    label: 'List subtasks',
    description:
      'The subtasks of one task, each with its own id and status. Pick one to hand its id to the next call.',
    method: 'GET',
    fields: [PARENT_TASK_ID_FIELD],
    path: (workspaceId, values) =>
      ApiRoutes.tasks.subtasks(workspaceId, values['parentTaskId'] ?? ''),
    picks: { key: 'taskId', label: 'Task ID' },
  },
];

export function playgroundCall(id: PlaygroundCallId): PlaygroundCall {
  const call = PLAYGROUND_CALLS.find((candidate) => candidate.id === id);
  if (!call) throw new Error(`Unknown playground call: ${id}`);
  return call;
}

/** Required fields still empty, by key, with a message the form can show. */
export function missingFields(
  call: PlaygroundCall,
  values: PlaygroundValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of call.fields) {
    if (field.required && !values[field.key]?.trim()) {
      errors[field.key] = `${field.label} is required.`;
    }
  }
  return errors;
}

/** Who the request runs as. A key emulates n8n; the session is the signed-in person. */
export type PlaygroundCredential =
  { kind: 'session'; token: string | null } | { kind: 'api-key'; key: string };

export interface PlaygroundRequest {
  method: PlaygroundMethod;
  url: string;
  headers: Record<string, string>;
  /** Already serialised, so what is shown, sent and exported are the same bytes. */
  body: string | null;
}

export const SECRET_HEADERS = ['authorization', 'x-api-key'] as const;

/** Builds exactly what will be sent, so the preview never lies about the request. */
export function buildRequest(input: {
  call: PlaygroundCall;
  apiUrl: string;
  workspaceId: string;
  values: PlaygroundValues;
  credential: PlaygroundCredential;
  idempotencyKey?: string | null;
}): PlaygroundRequest {
  const { call, apiUrl, workspaceId, values, credential, idempotencyKey } = input;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (credential.kind === 'api-key') {
    headers['X-API-Key'] = credential.key.trim();
  } else if (credential.token) {
    headers['Authorization'] = `Bearer ${credential.token}`;
  }

  const body = call.body ? JSON.stringify(call.body(values), null, 2) : null;
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (call.idempotent && idempotencyKey?.trim()) headers['Idempotency-Key'] = idempotencyKey.trim();

  return { method: call.method, url: `${apiUrl}${call.path(workspaceId, values)}`, headers, body };
}

/** A key with only its start showing, for the on-screen preview. */
export function maskSecret(value: string): string {
  const shown = value.startsWith(API_KEY_PREFIX) ? API_KEY_PREFIX.length + 4 : 4;
  return value.length <= shown ? '•'.repeat(value.length) : `${value.slice(0, shown)}…`;
}

export function maskedHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!(SECRET_HEADERS as readonly string[]).includes(name.toLowerCase())) {
      masked[name] = value;
    } else if (name.toLowerCase() === 'authorization') {
      masked[name] = `Bearer ${maskSecret(value.replace(/^Bearer\s+/i, ''))}`;
    } else {
      masked[name] = maskSecret(value);
    }
  }
  return masked;
}
