/**
 * Project status updates and messages — Asana's "Set status" and Messages tab.
 *
 * A status is a person's judgement of how the work is going, posted with a
 * summary and next steps, never derived from the tasks. The newest update is
 * the project's status; the history is what the Messages tab reads back.
 */

export const ProjectStatusValue = {
  ON_TRACK: 'ON_TRACK',
  AT_RISK: 'AT_RISK',
  OFF_TRACK: 'OFF_TRACK',
  ON_HOLD: 'ON_HOLD',
  COMPLETE: 'COMPLETE',
  DROPPED: 'DROPPED',
} as const;
export type ProjectStatusValue = (typeof ProjectStatusValue)[keyof typeof ProjectStatusValue];
export const PROJECT_STATUS_VALUES = Object.values(ProjectStatusValue);

export const PROJECT_STATUS_LABEL: Record<ProjectStatusValue, string> = {
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  OFF_TRACK: 'Off track',
  ON_HOLD: 'On hold',
  COMPLETE: 'Complete',
  DROPPED: 'Dropped',
};

export const STATUS_UPDATE_TITLE_MAX = 200;
export const STATUS_UPDATE_TEXT_MAX = 10_000;
export const PROJECT_MESSAGE_TITLE_MAX = 200;
export const PROJECT_MESSAGE_BODY_MAX = 20_000;
export const PROJECT_MESSAGE_REPLY_MAX = 10_000;

/** How many updates or messages one page of the feed carries. */
export const PROJECT_FEED_PAGE_SIZE = 30;

/**
 * Status templates — Customize › Status templates. A template is a status
 * update's starting point: a status to begin on, and the Summary and Next
 * steps a team writes the same way every week.
 */
export const STATUS_TEMPLATE_NAME_MAX = 120;
export const MAX_STATUS_TEMPLATES_PER_PROJECT = 20;
