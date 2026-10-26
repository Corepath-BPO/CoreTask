import type { ProjectSummary } from '@coretask/types';
import { useMemo } from 'react';

import { useProjects } from '@/features/projects/hooks/use-projects';

/**
 * Archived projects are included on purpose: a portfolio keeps watching a
 * project through archival rather than silently dropping it from the rollup.
 *
 * One page of 100 is the API's ceiling; references beyond it surface as
 * "unavailable" in the rollup rather than pretending to be complete.
 */
const PORTFOLIO_PROJECT_PARAMS = { limit: 100, includeArchived: true } as const;

/** Every project the portfolio pages can resolve against, as one lookup. */
export function usePortfolioProjectIndex(workspaceId: string | undefined) {
  const { data, isLoading } = useProjects(workspaceId, PORTFOLIO_PROJECT_PARAMS);

  const projectsById = useMemo(
    () =>
      new Map<string, ProjectSummary>((data?.items ?? []).map((project) => [project.id, project])),
    [data],
  );

  return { projectsById, isLoading };
}
