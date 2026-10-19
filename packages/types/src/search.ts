import type { UserRef } from './work-items.js';

/**
 * What the top-bar search answers with: a few of each kind, best first.
 *
 * Grouped rather than one ranked list, as Asana's search dropdown is — a
 * person, a project and a task called "Launch" are three different things to
 * go to, and interleaving them makes the reader sort them back out.
 */
export interface SearchResults {
  query: string;
  tasks: SearchTaskHit[];
  tickets: SearchTicketHit[];
  projects: SearchProjectHit[];
  people: SearchPersonHit[];
}

export interface SearchTaskHit {
  id: string;
  title: string;
  isCompleted: boolean;
  dueDate: string | null;
  assignee: UserRef | null;
  project: { id: string; name: string; color: string } | null;
  /** Set for a subtask, so the result can say what it belongs to. */
  parent: { id: string; title: string } | null;
}

export interface SearchTicketHit {
  id: string;
  key: string;
  title: string;
  status: string;
  project: { id: string; name: string; color: string } | null;
}

export interface SearchProjectHit {
  id: string;
  name: string;
  key: string;
  color: string;
  status: string;
}

export interface SearchPersonHit extends UserRef {
  role: string;
}

/** The kinds a search can be narrowed to — the chips under the search box. */
export type SearchKind = 'tasks' | 'tickets' | 'projects' | 'people';
