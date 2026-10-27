import {
  ApprovalStatus,
  CustomFieldType,
  PROJECT_KEY_MAX_LENGTH,
  ProjectMemberRole,
  ProjectStatusValue,
  ProjectVisibility,
  TaskKind,
  WorkspaceRole,
  type ColorToken,
} from '@coretask/contracts';
import { safeParseFieldSettings } from '@coretask/validation';

import {
  escapeHtml,
  normalizeCommentBody,
  normalizeRichText,
} from '../../common/utils/rich-text.util';
import type {
  AsanaCustomField,
  AsanaStory,
  AsanaWorkspaceMembership,
} from '../../integrations/asana/asana.types';

/**
 * Asana's values in CoreTask's terms. Pure functions, so every judgement call
 * the importer makes about a single value is testable without Asana, a
 * database or a queue.
 */

/** Column limits the rows are written against; truncating beats a failed insert. */
export const LIMITS = {
  projectName: 120,
  sectionName: 120,
  taskTitle: 500,
  teamName: 80,
  workspaceName: 80,
  fieldName: 80,
  optionLabel: 80,
  tagName: 60,
  userName: 120,
  statusTitle: 200,
  portfolioName: 120,
  filename: 255,
  /**
   * A text field's value: what the field editor accepts (`MaxLength(2000)` on
   * the value DTO), and safely under the 2,704-byte row limit of the index on
   * `(customFieldId, textValue)`, which refuses anything longer outright.
   */
  fieldText: 2_000,
} as const;

export function clip(value: string | null | undefined, max: number, fallback = ''): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') return fallback;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/**
 * Asana's colour names, for projects and tags (`dark-green`) and for select
 * options (`yellow-green`), mapped to the nearest CoreTask token.
 */
const ASANA_COLOR_TOKENS: Record<string, ColorToken> = {
  'dark-red': 'red',
  'light-red': 'rose',
  'dark-orange': 'orange',
  'light-orange': 'amber',
  'dark-brown': 'yellow',
  'light-brown': 'amber',
  'light-green': 'lime',
  'dark-green': 'green',
  'light-teal': 'teal',
  'dark-teal': 'cyan',
  'light-blue': 'sky',
  'dark-blue': 'blue',
  'light-purple': 'purple',
  'dark-purple': 'violet',
  'light-pink': 'fuchsia',
  'dark-pink': 'pink',
  'light-warm-gray': 'gray',
  'dark-warm-gray': 'slate',
  red: 'red',
  orange: 'orange',
  'yellow-orange': 'amber',
  yellow: 'yellow',
  'yellow-green': 'lime',
  green: 'green',
  'blue-green': 'teal',
  aqua: 'cyan',
  blue: 'blue',
  indigo: 'indigo',
  purple: 'purple',
  magenta: 'fuchsia',
  'hot-pink': 'pink',
  pink: 'rose',
  'cool-gray': 'slate',
};

/** The 500 shade of each token: what a project's hex colour is stored as. */
const TOKEN_HEX: Record<ColorToken, string> = {
  slate: '#64748B',
  gray: '#6B7280',
  red: '#EF4444',
  orange: '#F97316',
  amber: '#F59E0B',
  yellow: '#EAB308',
  lime: '#84CC16',
  green: '#22C55E',
  emerald: '#10B981',
  teal: '#14B8A6',
  cyan: '#06B6D4',
  sky: '#0EA5E9',
  blue: '#3B82F6',
  indigo: '#6366F1',
  violet: '#8B5CF6',
  purple: '#A855F7',
  fuchsia: '#D946EF',
  pink: '#EC4899',
  rose: '#F43F5E',
};

export function colorToken(asanaColor: string | null | undefined): ColorToken {
  return (asanaColor && ASANA_COLOR_TOKENS[asanaColor]) || 'gray';
}

/** A project's colour; Asana's "none" keeps CoreTask's default indigo. */
export function projectColor(asanaColor: string | null | undefined): string {
  const token = asanaColor ? ASANA_COLOR_TOKENS[asanaColor] : undefined;
  return TOKEN_HEX[token ?? 'indigo'];
}

// ---------------------------------------------------------------------------
// Roles, visibility, statuses
// ---------------------------------------------------------------------------

export function workspaceRole(membership: AsanaWorkspaceMembership): WorkspaceRole {
  if (membership.is_admin) return WorkspaceRole.ADMIN;
  if (membership.is_guest) return WorkspaceRole.GUEST;
  return WorkspaceRole.MEMBER;
}

const PROJECT_ROLES: Record<string, ProjectMemberRole> = {
  admin: ProjectMemberRole.ADMIN,
  editor: ProjectMemberRole.EDITOR,
  commenter: ProjectMemberRole.COMMENTER,
  viewer: ProjectMemberRole.VIEWER,
};

export function projectRole(accessLevel: string | undefined): ProjectMemberRole {
  return (accessLevel && PROJECT_ROLES[accessLevel]) || ProjectMemberRole.EDITOR;
}

/** Only "public to workspace" is open to everyone; team-private and private are both private. */
export function projectVisibility(privacy: string | undefined): ProjectVisibility {
  return privacy === 'public_to_workspace' ? ProjectVisibility.PUBLIC : ProjectVisibility.PRIVATE;
}

const STATUS_VALUES: Record<string, ProjectStatusValue> = {
  on_track: ProjectStatusValue.ON_TRACK,
  at_risk: ProjectStatusValue.AT_RISK,
  off_track: ProjectStatusValue.OFF_TRACK,
  on_hold: ProjectStatusValue.ON_HOLD,
  complete: ProjectStatusValue.COMPLETE,
  achieved: ProjectStatusValue.COMPLETE,
  partial: ProjectStatusValue.COMPLETE,
  missed: ProjectStatusValue.DROPPED,
  dropped: ProjectStatusValue.DROPPED,
};

export function statusValue(statusType: string | undefined): ProjectStatusValue {
  return (statusType && STATUS_VALUES[statusType]) || ProjectStatusValue.ON_TRACK;
}

export function taskKind(subtype: string | undefined): TaskKind {
  if (subtype === 'milestone') return TaskKind.MILESTONE;
  if (subtype === 'approval') return TaskKind.APPROVAL;
  return TaskKind.TASK;
}

const APPROVALS: Record<string, ApprovalStatus> = {
  pending: ApprovalStatus.PENDING,
  approved: ApprovalStatus.APPROVED,
  rejected: ApprovalStatus.REJECTED,
  changes_requested: ApprovalStatus.CHANGES_REQUESTED,
};

/** An approval's answer; null for every other kind, as CoreTask keeps it. */
export function approvalStatus(
  kind: TaskKind,
  value: string | null | undefined,
): ApprovalStatus | null {
  if (kind !== TaskKind.APPROVAL) return null;
  return (value && APPROVALS[value]) || ApprovalStatus.PENDING;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `2026-10-27` as the UTC midnight CoreTask stores calendar dates at. */
export function calendarDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function instant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A start or due pair. Asana sends `due_on` beside `due_at` when a time was
 * chosen; when only the instant came back, its UTC day stands in.
 */
export function schedule(
  on: string | null | undefined,
  at: string | null | undefined,
): { date: Date | null; at: Date | null } {
  const exact = instant(at);
  const date = calendarDate(on) ?? (exact ? calendarDate(exact.toISOString()) : null);
  return { date, at: date ? exact : null };
}

// ---------------------------------------------------------------------------
// Keys and names
// ---------------------------------------------------------------------------

/** A project key not yet taken, `deriveProjectKey`'s result with a number when it is. */
export function uniqueKey(base: string, taken: Set<string>): string {
  const normalized = base.toUpperCase().slice(0, PROJECT_KEY_MAX_LENGTH);
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const suffix = attempt === 0 ? '' : String(attempt + 1);
    const candidate = `${normalized.slice(0, PROJECT_KEY_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error(`No free project key for ${base}.`);
}

/** A name unique in its set, case-insensitively: "Leads", then "Leads (2)". */
export function uniqueName(name: string, taken: Set<string>, max: number): string {
  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    const suffix = attempt === 1 ? '' : ` (${attempt})`;
    const candidate = `${clip(name, max - suffix.length, 'Untitled')}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
  throw new Error(`No free name for ${name}.`);
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export interface FieldDefinition {
  type: CustomFieldType;
  settings: Record<string, unknown>;
}

/**
 * The CoreTask field an Asana field becomes, or null for a type Asana adds
 * later that nothing here knows.
 *
 * Reference fields point at Asana objects CoreTask has no table for, and
 * formula and ID fields are Asana's own computations; each becomes a text
 * field holding what Asana displays for it, so the value is still there to
 * read. The record itself is kept whole in the import's snapshot.
 */
export function fieldDefinition(field: AsanaCustomField): FieldDefinition | null {
  const definition = rawFieldDefinition(field);
  if (!definition) return null;

  // Written as the field service would have validated them, defaults filled.
  const parsed = safeParseFieldSettings(definition.type, definition.settings);
  return parsed.success
    ? { type: definition.type, settings: parsed.data as Record<string, unknown> }
    : { type: definition.type, settings: {} };
}

function rawFieldDefinition(field: AsanaCustomField): FieldDefinition | null {
  switch (field.resource_subtype) {
    case 'text':
    case 'reference':
    case 'formula':
    case 'custom_id':
      return { type: CustomFieldType.TEXT, settings: { textMode: 'SHORT' } };
    case 'enum':
      return { type: CustomFieldType.SINGLE_SELECT, settings: {} };
    case 'multi_enum':
      return { type: CustomFieldType.MULTI_SELECT, settings: {} };
    case 'date':
      return { type: CustomFieldType.DATE, settings: { dateMode: 'DATE_ONLY' } };
    case 'people':
      return { type: CustomFieldType.PEOPLE, settings: { peopleMode: 'MULTIPLE' } };
    case 'number':
      return { type: CustomFieldType.NUMBER, settings: numberSettings(field) };
    default:
      return null;
  }
}

function numberSettings(field: AsanaCustomField): Record<string, unknown> {
  const decimalPlaces = Math.min(Math.max(field.precision ?? 0, 0), 6);

  switch (field.format) {
    case 'percentage':
      return { numberFormat: 'PERCENTAGE', decimalPlaces };
    case 'currency':
      return {
        numberFormat: 'CURRENCY',
        decimalPlaces,
        currencyCode: (field.currency_code ?? 'USD').toUpperCase(),
      };
    case 'custom':
      return field.custom_label
        ? {
            numberFormat: 'CUSTOM_UNIT',
            decimalPlaces,
            unitLabel: field.custom_label.slice(0, 12),
            unitPosition: field.custom_label_position === 'prefix' ? 'PREFIX' : 'SUFFIX',
          }
        : { numberFormat: 'PLAIN', decimalPlaces };
    case 'duration':
      // Asana stores a duration as minutes.
      return {
        numberFormat: 'CUSTOM_UNIT',
        decimalPlaces,
        unitLabel: 'min',
        unitPosition: 'SUFFIX',
      };
    default:
      return { numberFormat: 'PLAIN', decimalPlaces };
  }
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

/** Who an Asana user gid is in CoreTask, when they came across. */
export type PersonLookup = (asanaGid: string) => { id: string; name: string } | undefined;

const BLOCK_TAG = /<(\/?)(ul|ol|li|h1|h2|h3|blockquote|pre|hr)\b[^>]*>/gi;
const USER_LINK = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

/**
 * Asana's rich text as the HTML CoreTask's editor writes.
 *
 * Asana wraps its markup in `<body>` and breaks lines with bare newlines
 * rather than paragraphs, so top-level text is split into `<p>`s here; inside
 * a list or a quote a newline is a `<br>`. A mention of someone who came
 * across becomes CoreTask's mention chip; anyone else stays as `@Name` text.
 * Embedded images go: they point at Asana, and their files are imported as
 * the task's attachments instead. Everything then passes the same sanitiser
 * every description write does.
 */
export function asanaHtml(html: string | null | undefined, person: PersonLookup): string {
  if (!html) return '';

  const body = html
    .replace(/^\s*<body>/i, '')
    .replace(/<\/body>\s*$/i, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(USER_LINK, (whole: string, attributes: string, label: string) => {
      if (!/data-asana-type="user"/i.test(attributes)) return whole;
      const gid = /data-asana-gid="([^"]+)"/i.exec(attributes)?.[1];
      const known = gid ? person(gid) : undefined;
      if (known) return `<span data-mention="${known.id}">@${escapeHtml(known.name)}</span>`;
      const text = label.replace(/<[^>]*>/g, '').replace(/^@/, '');
      return `@${text}`;
    });

  let out = '';
  let depth = 0;
  let last = 0;
  let previousWasBlock = false;

  for (const match of body.matchAll(BLOCK_TAG)) {
    const index = match.index ?? 0;
    out += inline(body.slice(last, index), depth, previousWasBlock, true);

    const tag = (match[2] ?? '').toLowerCase();
    if (tag !== 'hr') depth = Math.max(0, depth + (match[1] === '/' ? -1 : 1));
    out += match[0];
    last = index + match[0].length;
    previousWasBlock = true;
  }

  return out + inline(body.slice(last), depth, previousWasBlock, false);
}

function inline(text: string, depth: number, afterBlock: boolean, beforeBlock: boolean): string {
  if (text.trim() === '') return '';
  if (depth > 0) return text.replace(/\n/g, '<br>');

  let lines = text.split('\n');
  if (afterBlock && lines[0]?.trim() === '') lines = lines.slice(1);
  if (beforeBlock && lines.at(-1)?.trim() === '') lines = lines.slice(0, -1);
  return lines.map((line) => `<p>${line}</p>`).join('');
}

/** A task's or project's notes as a stored description; null when empty. */
export function description(html: string | null | undefined, person: PersonLookup): string | null {
  return normalizeRichText(asanaHtml(html, person)) ?? null;
}

/** A comment story as a stored comment body; null when there is nothing to say. */
export function commentBody(story: AsanaStory, person: PersonLookup): string | null {
  const html = story.html_text
    ? asanaHtml(story.html_text, person)
    : (story.text ?? '')
        .split('\n')
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('');
  return normalizeCommentBody(html);
}

/** Links to files Asana does not hold (Drive, Dropbox…), as a closing list in the description. */
export function linkedFilesHtml(files: { name: string; url: string }[]): string {
  if (files.length === 0) return '';
  const items = files
    .map((file) => `<li><a href="${escapeHtml(file.url)}">${escapeHtml(file.name)}</a></li>`)
    .join('');
  return `<p><strong>Linked files</strong></p><ul>${items}</ul>`;
}
