/**
 * The AI steps: "Use AI…", an action, and "Check with AI", a condition.
 *
 * Both hand the task to a language model with words the rule's author wrote.
 * The action's model may only make the kinds of change the author ticked, and
 * only to values the project really has — it picks from the project's own
 * sections, statuses and people, never types them — and what it picks runs
 * through the same actions a rule would otherwise run. The condition's model
 * answers yes or no, and says why.
 *
 * They need a model to talk to. A server without one greys both out with
 * `AI_UNAVAILABLE_REASON` rather than offering a step that cannot run.
 */

/** The action's subtype — "Use AI…". */
export const AI_ACTION_SUBTYPE = 'AI_ACTION';

/**
 * The field an AI check is stored under.
 *
 * Builder conditions are all `FIELD_COMPARISON` nodes told apart by
 * `config.field`, so the AI check is one more field rather than a node type of
 * its own. Its question rides in `config.question`.
 */
export const AI_CHECK_FIELD = 'ai.check';

/** What "Use AI…" may be allowed to change, besides custom fields. */
export const AiPermission = {
  COMMENT: 'COMMENT',
  ASSIGN: 'ASSIGN',
  SECTION: 'SECTION',
  STATUS: 'STATUS',
  PRIORITY: 'PRIORITY',
  DUE_DATE: 'DUE_DATE',
  SUBTASKS: 'SUBTASKS',
} as const;
export type AiPermission = (typeof AiPermission)[keyof typeof AiPermission];
export const AI_PERMISSIONS = Object.values(AiPermission);

export const AI_PERMISSION_LABEL: Record<AiPermission, string> = {
  COMMENT: 'Add a comment',
  ASSIGN: 'Assign or unassign the task',
  SECTION: 'Move it to a section',
  STATUS: 'Change its status',
  PRIORITY: 'Change its priority',
  DUE_DATE: 'Set or clear its due date',
  SUBTASKS: 'Create subtasks',
};

/** The custom field types AI may fill in: a choice, a number, words, a tick. */
export const AI_FIELD_TYPES = [
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'TEXT',
  'NUMBER',
  'CHECKBOX',
] as const;

const FIELD_PREFIX = 'field:';

/** The permission that lets AI fill one custom field: `field:<id>`. */
export function aiFieldPermission(fieldId: string): string {
  return `${FIELD_PREFIX}${fieldId}`;
}

/** The custom field a permission names, or null for the other kinds. */
export function aiPermissionFieldId(permission: string): string | null {
  return permission.startsWith(FIELD_PREFIX) && permission.length > FIELD_PREFIX.length
    ? permission.slice(FIELD_PREFIX.length)
    : null;
}

/** Longest instructions a step holds — a paragraph or two, not a manual. */
export const AI_INSTRUCTIONS_MAX = 2000;
/** Longest question an AI check asks. */
export const AI_QUESTION_MAX = 500;
/** Most changes one "Use AI…" step makes, whatever the model asks for. */
export const AI_MAX_CHANGES = 10;
/** Longest description a rule is drafted from, on the Add automation page. */
export const AI_DRAFT_PROMPT_MAX = 1000;

/** Why the AI steps are greyed out on a server with no model configured. */
export const AI_UNAVAILABLE_REASON =
  'AI isn’t set up on this server yet — an admin adds an Anthropic API key to turn it on.';

/** The permissions a step's configuration grants, known kinds only, each once. */
export function aiPermissionsOf(configuration: Record<string, unknown>): string[] {
  const raw = configuration['allow'];
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter(
        (value): value is string =>
          typeof value === 'string' &&
          ((AI_PERMISSIONS as readonly string[]).includes(value) ||
            aiPermissionFieldId(value) !== null),
      ),
    ),
  ];
}

/**
 * What is wrong with a "Draft an update with AI…" step's settings, or null.
 * Its instructions are optional — "what the update should cover" — so only
 * their length can be wrong.
 */
export function aiDraftUpdateProblem(configuration: Record<string, unknown>): string | null {
  const instructions = configuration['instructions'];
  if (instructions === undefined || instructions === null) return null;
  if (typeof instructions !== 'string') return 'Write the instructions as text.';
  if (instructions.length > AI_INSTRUCTIONS_MAX) {
    return `Keep the instructions under ${AI_INSTRUCTIONS_MAX} characters.`;
  }
  return null;
}

/** What is wrong with a "Use AI…" step's settings, or null. */
export function aiActionProblem(configuration: Record<string, unknown>): string | null {
  const instructions = configuration['instructions'];
  if (typeof instructions !== 'string' || instructions.trim() === '') {
    return 'Tell AI what to do.';
  }
  if (instructions.length > AI_INSTRUCTIONS_MAX) {
    return `Keep the instructions under ${AI_INSTRUCTIONS_MAX} characters.`;
  }
  if (aiPermissionsOf(configuration).length === 0) {
    return 'Choose at least one thing AI may change.';
  }
  return null;
}

/** What is wrong with an AI check's question, or null. */
export function aiCheckProblem(configuration: Record<string, unknown>): string | null {
  const question = configuration['question'];
  if (typeof question !== 'string' || question.trim() === '') {
    return 'Ask AI a yes-or-no question about the task.';
  }
  if (question.length > AI_QUESTION_MAX) {
    return `Keep the question under ${AI_QUESTION_MAX} characters.`;
  }
  return null;
}
