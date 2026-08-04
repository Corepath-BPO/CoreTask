/**
 * Field constraints and pagination defaults.
 *
 * The API (class-validator DTOs) and the web client (Zod schemas) both read
 * these constants, so validation rules cannot drift between the two layers.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 120;

export const EMAIL_MAX_LENGTH = 254;

export const WORKSPACE_NAME_MIN_LENGTH = 2;
export const WORKSPACE_NAME_MAX_LENGTH = 80;
export const WORKSPACE_SLUG_MIN_LENGTH = 2;
export const WORKSPACE_SLUG_MAX_LENGTH = 40;
/** Lowercase alphanumerics separated by single hyphens. */
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const PROJECT_NAME_MIN_LENGTH = 2;
export const PROJECT_NAME_MAX_LENGTH = 120;
export const PROJECT_KEY_MIN_LENGTH = 2;
export const PROJECT_KEY_MAX_LENGTH = 8;
/** 2–8 uppercase letters/digits — the `CORE` in `CORE-1001`. */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/;
/** `#RGB`, `#RRGGBB` or `#RRGGBBAA`. */
export const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** Offered in the project form; any valid hex colour is accepted by the API. */
export const PROJECT_COLORS: readonly string[] = [
  '#6366F1',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#EC4899',
  '#8B5CF6',
  '#14B8A6',
];

export const TEAM_NAME_MIN_LENGTH = 2;
export const TEAM_NAME_MAX_LENGTH = 80;
/** A workspace cannot have an unbounded number of groupings. */
export const MAX_TEAMS_PER_WORKSPACE = 100;

export const SECTION_NAME_MIN_LENGTH = 1;
export const SECTION_NAME_MAX_LENGTH = 120;
/** Created with every new project so a board is usable immediately. */
export const DEFAULT_SECTION_NAMES: readonly string[] = [
  'Backlog',
  'In Progress',
  'In Review',
  'Done',
];
/** A project cannot hold an unbounded number of columns. */
export const MAX_SECTIONS_PER_PROJECT = 50;

export const DESCRIPTION_MAX_LENGTH = 10_000;

export const COMMENT_MIN_LENGTH = 1;
export const COMMENT_MAX_LENGTH = 20_000;
/** A thread loads in one request up to this many; beyond it, paging kicks in. */
export const COMMENT_PAGE_LIMIT = 50;

export const TASK_TITLE_MIN_LENGTH = 1;
export const TASK_TITLE_MAX_LENGTH = 500;
/** Guards against a typo in a time field turning into a nonsense estimate. */
export const TASK_MAX_ESTIMATED_MINUTES = 60 * 24 * 365;
/**
 * Ceiling on how many tasks the board loads per project in one request.
 *
 * A board is a direct-manipulation surface, not a report — beyond this the list
 * views and filters are the right tool, and the client shows how many were
 * withheld rather than silently truncating.
 */
export const BOARD_TASK_LIMIT = 500;

export const TICKET_TITLE_MIN_LENGTH = 1;
export const TICKET_TITLE_MAX_LENGTH = 500;
/** `CORE-1001` — the workspace prefix, a hyphen, then the per-workspace number. */
export const TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,7}-\d+$/;
/** Ticket numbering starts above this, so the first key is `PREFIX-1001`. */
export const TICKET_NUMBER_START = 1000;

/** How many entries the dashboard's activity feed and inbox request. */
export const ACTIVITY_FEED_LIMIT = 20;
export const ACTIVITY_FEED_MAX_LIMIT = 100;
export const NOTIFICATION_FEED_LIMIT = 30;
export const NOTIFICATION_FEED_MAX_LIMIT = 100;

/**
 * Gap between adjacent `position` values when a list is (re)numbered.
 *
 * Fractional ordering inserts at the midpoint of its neighbours, so a large
 * initial gap buys many insertions before the values need rebalancing.
 */
export const POSITION_STEP = 1_000;
/**
 * Below this gap, midpoint insertion is close enough to double precision limits
 * that the list is renumbered instead. See `api/src/common/utils/position.util.ts`.
 */
export const POSITION_MIN_GAP = 0.000_001;

/**
 * How long an invitation link stays valid.
 *
 * Long enough to survive a holiday, short enough that a forwarded or leaked
 * mailbox does not grant access indefinitely.
 */
export const INVITATION_EXPIRY_DAYS = 7;
/** Entropy in the invitation token, before base64url encoding. */
export const INVITATION_TOKEN_BYTES = 32;
/** A workspace cannot have an unbounded number of offers outstanding. */
export const MAX_PENDING_INVITATIONS = 200;

export const PAGINATION_DEFAULT_PAGE = 1;
export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

/** Header carrying the per-request correlation id, echoed on every response. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Name of the HTTP-only cookie carrying the rotating refresh token. */
export const REFRESH_TOKEN_COOKIE = 'coretask_rt';

/** How long a presigned upload or download URL stays valid. */
export const UPLOAD_URL_TTL_SECONDS = 300;
export const DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * How long an unconfirmed upload is left alone before the sweeper removes it.
 *
 * Comfortably longer than the URL's own lifetime, so a slow upload that is still
 * legitimately in flight is never swept out from under itself.
 */
export const PENDING_UPLOAD_TTL_MINUTES = 60;

export const MAX_ATTACHMENTS_PER_ITEM = 25;
export const FILENAME_MAX_LENGTH = 255;

/** Upload guardrails enforced by the storage integration. */
export const ALLOWED_UPLOAD_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
