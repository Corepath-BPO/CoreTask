import type { AsanaEvent } from '../../integrations/asana/asana.types';

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
}

export function emptyWork(): LiveWork {
  return { tasks: new Set(), history: new Set(), sections: new Set(), stories: new Set() };
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
 * with the task's history. A story event without its task (an edited
 * comment) is looked up. Sections are re-read per project.
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
        if (event.action === 'removed' || event.action === 'deleted') break;
        const subtype = resource.resource_subtype;
        if (subtype && !CONTENT_STORIES.has(subtype)) break;
        if (parent?.resource_type === 'task') {
          work.tasks.add(parent.gid);
          work.history.add(parent.gid);
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

      default:
        // Projects, tags and fields are a full run's: nightly, or Sync again.
        break;
    }
  }
}
