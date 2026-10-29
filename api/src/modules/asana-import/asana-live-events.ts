import type { AsanaEvent } from '../../integrations/asana/asana.types';

import type { ProjectPart } from './asana-import-run';

/** What a project's events ask live sync to do. */
export interface LiveWork {
  /** Tasks to read again from Asana and write. */
  tasks: Set<string>;
  /** Of those, the ones whose comments or files changed too. */
  history: Set<string>;
  /** Projects whose sections changed. */
  sections: Set<string>;
  /** Comments the events named without their task, to be looked up. */
  stories: Set<string>;
  /** Comments deleted in Asana, found here by their refs. */
  deletedStories: Set<string>;
  /** Projects whose details, fields or members changed, and which of those. */
  projects: Map<string, Set<ProjectPart>>;
}

export function emptyWork(): LiveWork {
  return {
    tasks: new Set(),
    history: new Set(),
    sections: new Set(),
    stories: new Set(),
    deletedStories: new Set(),
    projects: new Map(),
  };
}

function touch(work: LiveWork, projectGid: string, part: ProjectPart): void {
  const parts = work.projects.get(projectGid) ?? new Set<ProjectPart>();
  parts.add(part);
  work.projects.set(projectGid, parts);
}

/** Stories that are content, not Asana's own record of a change. */
const CONTENT_STORIES = new Set(['comment_added', 'attachment_added']);

/**
 * Adds what one project's events ask for to `work`.
 *
 * Only tasks are re-read, never patched from the event: an event says that
 * something changed, not what it is now, and the task as Asana has it is the
 * one thing a write can be sure of. So ten changes to one task are one read.
 *
 * A story Asana writes about a change ("changed the due date") comes with an
 * event on the task itself, so it is skipped; a comment or a file is read
 * with the task's history, which also finds a comment deleted there. A story
 * event without its task (an edited comment) is looked up, or, deleted, found
 * by its ref. Sections are re-read per project, and so is the project itself
 * when its details, fields or members changed.
 */
export function addWork(work: LiveWork, projectGid: string, events: readonly AsanaEvent[]): void {
  for (const event of events) {
    const resource = event.resource;
    const parent = event.parent;
    switch (resource.resource_type) {
      case 'task':
        work.tasks.add(resource.gid);
        break;

      case 'story': {
        const subtype = resource.resource_subtype;
        if (subtype && !CONTENT_STORIES.has(subtype)) break;
        if (parent?.resource_type === 'task') {
          work.tasks.add(parent.gid);
          work.history.add(parent.gid);
        } else if (event.action === 'removed' || event.action === 'deleted') {
          work.deletedStories.add(resource.gid);
        } else {
          work.stories.add(resource.gid);
        }
        break;
      }

      case 'attachment':
        if (parent?.resource_type === 'task') {
          work.tasks.add(parent.gid);
          work.history.add(parent.gid);
        }
        break;

      case 'section':
        work.sections.add(projectGid);
        break;

      case 'project':
        // Deleted in Asana: left in place, as a full run leaves it.
        if (event.action !== 'deleted' && resource.gid === projectGid) {
          touch(work, projectGid, 'details');
        }
        break;

      case 'custom_field_setting':
        touch(work, projectGid, 'fields');
        break;

      case 'membership':
      case 'project_membership':
        touch(work, projectGid, 'members');
        break;

      default:
        // A tag or a field's definition: live sync looks at those every few
        // minutes (`syncDefinitions`), since Asana sends no event for them.
        break;
    }
  }
}
