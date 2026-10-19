/**
 * Home — Asana's customizable Home page.
 *
 * Each person picks which widgets their Home shows, and in what order, per
 * workspace. The list stores only what is shown: a widget left out is hidden,
 * and one added to CoreTask later stays out of a layout someone already chose
 * until they add it — their page does not rearrange itself under them.
 */

export const HomeWidget = {
  TASK_OVERVIEW: 'TASK_OVERVIEW',
  TICKET_HEALTH: 'TICKET_HEALTH',
  ASSIGNED: 'ASSIGNED',
  UPCOMING: 'UPCOMING',
  PROJECT_PROGRESS: 'PROJECT_PROGRESS',
  RECENT_ACTIVITY: 'RECENT_ACTIVITY',
  RECENT_TICKETS: 'RECENT_TICKETS',
  NOTEPAD: 'NOTEPAD',
} as const;
export type HomeWidget = (typeof HomeWidget)[keyof typeof HomeWidget];
export const HOME_WIDGETS = Object.values(HomeWidget);

export const HOME_WIDGET_LABEL: Record<HomeWidget, string> = {
  TASK_OVERVIEW: 'Task overview',
  TICKET_HEALTH: 'Ticket health',
  ASSIGNED: 'Assigned to you',
  UPCOMING: 'Upcoming deadlines',
  PROJECT_PROGRESS: 'Project progress',
  RECENT_ACTIVITY: 'Recent activity',
  RECENT_TICKETS: 'Recent tickets',
  NOTEPAD: 'Private notepad',
};

/** Home as it is before anyone customizes it — the notepad is offered, not imposed. */
export const DEFAULT_HOME_WIDGETS: readonly HomeWidget[] = [
  HomeWidget.TASK_OVERVIEW,
  HomeWidget.TICKET_HEALTH,
  HomeWidget.ASSIGNED,
  HomeWidget.UPCOMING,
  HomeWidget.PROJECT_PROGRESS,
  HomeWidget.RECENT_ACTIVITY,
  HomeWidget.RECENT_TICKETS,
];

export const HOME_NOTEPAD_MAX = 10_000;

/** A stored list, read leniently: known widgets, each once, in order. */
export function readHomeWidgets(value: unknown): HomeWidget[] {
  if (!Array.isArray(value)) return [...DEFAULT_HOME_WIDGETS];
  const seen = new Set<HomeWidget>();
  for (const entry of value) {
    if ((HOME_WIDGETS as readonly unknown[]).includes(entry)) seen.add(entry as HomeWidget);
  }
  return [...seen];
}
