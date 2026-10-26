export type ProjectViewKind = 'list' | 'board';

/**
 * The address that opens a project view with this section selected, the way a
 * task's `?task=` opens its panel. Absolute, so it can be pasted anywhere.
 */
export function sectionLink(projectId: string, view: ProjectViewKind, sectionId: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/projects/${projectId}/${view}?section=${sectionId}`;
}
