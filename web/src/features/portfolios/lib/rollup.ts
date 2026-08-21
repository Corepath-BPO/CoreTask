import type { ProjectSummary, UserRef } from '@coretask/types';

import { percentage } from '@/lib/utils';
import type { Portfolio } from '@/stores/portfolio.store';

export interface PortfolioRollup {
  /** Members that resolved against the live project list, in portfolio order. */
  projects: ProjectSummary[];
  /** References the server no longer returns — usually deleted projects. */
  missingCount: number;
  taskCount: number;
  completedTaskCount: number;
  /** Whole-portfolio completion, weighted by task count. */
  progress: number;
}

/** Distinct leads of the member projects — the closest thing to Asana's member chips. */
export function projectLeads(projects: ProjectSummary[], limit = 3): UserRef[] {
  const leads = projects
    .map((project) => project.lead)
    .filter((lead): lead is UserRef => lead !== null);
  return [...new Map(leads.map((lead) => [lead.id, lead])).values()].slice(0, limit);
}

export function rollupPortfolio(
  portfolio: Portfolio,
  projectsById: ReadonlyMap<string, ProjectSummary>,
): PortfolioRollup {
  const projects = portfolio.projectIds
    .map((id) => projectsById.get(id))
    .filter((project): project is ProjectSummary => project !== undefined);

  const taskCount = projects.reduce((sum, project) => sum + project.taskCount, 0);
  const completedTaskCount = projects.reduce((sum, project) => sum + project.completedTaskCount, 0);

  return {
    projects,
    missingCount: portfolio.projectIds.length - projects.length,
    taskCount,
    completedTaskCount,
    progress: percentage(completedTaskCount, taskCount),
  };
}
