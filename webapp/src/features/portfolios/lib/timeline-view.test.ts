import type { ProjectSummary } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import type { ProjectStatusUpdateValue } from '@/features/projects/hooks/use-project-updates';

import { activeFilterCount, arrangeTimeline, DEFAULT_TIMELINE_VIEW } from './timeline-view';

const project = (over: Partial<ProjectSummary> & { id: string; name: string }): ProjectSummary =>
  ({ startDate: null, dueDate: null, lead: null, ...over }) as ProjectSummary;

const projects = [
  project({ id: 'p-1', name: 'Platform', dueDate: '2026-12-01', lead: { id: 'me' } as never }),
  project({ id: 'p-2', name: 'Leasing', startDate: '2026-10-01', dueDate: '2026-11-01' }),
  project({ id: 'p-3', name: 'Archive clean-up' }),
];

const statuses: Record<string, ProjectStatusUpdateValue> = { 'p-1': 'at_risk', 'p-2': 'on_track' };
const statusOf = (id: string) => statuses[id] ?? null;
const names = (list: ProjectSummary[]) => list.map((entry) => entry.name);

describe('arrangeTimeline', () => {
  it('keeps the portfolio order by default', () => {
    expect(names(arrangeTimeline(projects, DEFAULT_TIMELINE_VIEW, statusOf, 'me'))).toEqual([
      'Platform',
      'Leasing',
      'Archive clean-up',
    ]);
  });

  it('matches by name, status, lead and dates', () => {
    const view = { ...DEFAULT_TIMELINE_VIEW };
    expect(names(arrangeTimeline(projects, { ...view, search: 'LEAS' }, statusOf, 'me'))).toEqual([
      'Leasing',
    ]);
    expect(
      names(
        arrangeTimeline(
          projects,
          { ...view, statuses: new Set(['at_risk', 'none']) },
          statusOf,
          'me',
        ),
      ),
    ).toEqual(['Platform', 'Archive clean-up']);
    expect(names(arrangeTimeline(projects, { ...view, mine: true }, statusOf, 'me'))).toEqual([
      'Platform',
    ]);
    expect(names(arrangeTimeline(projects, { ...view, datedOnly: true }, statusOf, 'me'))).toEqual([
      'Platform',
      'Leasing',
    ]);
  });

  it('sorts by date with the undated last, and by name', () => {
    const view = DEFAULT_TIMELINE_VIEW;
    expect(names(arrangeTimeline(projects, { ...view, sort: 'start' }, statusOf, 'me'))).toEqual([
      'Leasing',
      'Platform',
      'Archive clean-up',
    ]);
    expect(names(arrangeTimeline(projects, { ...view, sort: 'name' }, statusOf, 'me'))).toEqual([
      'Archive clean-up',
      'Leasing',
      'Platform',
    ]);
  });

  it('counts the filters that are on', () => {
    expect(activeFilterCount(DEFAULT_TIMELINE_VIEW)).toBe(0);
    expect(
      activeFilterCount({ ...DEFAULT_TIMELINE_VIEW, mine: true, statuses: new Set(['none']) }),
    ).toBe(2);
  });
});
