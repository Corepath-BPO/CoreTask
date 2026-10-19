import type { PortfolioWorkloadMeasure, ProjectStatusValue } from '@coretask/contracts';
import type { UpdateAuthor } from './project-updates.js';

/** A named set of projects watched together. */
export interface Portfolio {
  id: string;
  name: string;
  description: string | null;
  color: string;
  /** In the portfolio's order, and only those the reader can open. */
  projectIds: string[];
  /** Whether the reader starred it — stars are per person. */
  starred: boolean;
  owner: UpdateAuthor | null;
  /** How its Workload tab counts load, and against what. */
  workload: PortfolioWorkload;
  /** Its own newest status update, if it has one. */
  status: { value: ProjectStatusValue; createdAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioWorkload {
  measure: PortfolioWorkloadMeasure;
  /** Everyone's capacity unless set for them; null for none. */
  defaultCapacity: number | null;
  /** Per-person capacities that differ from the default. */
  capacities: { userId: string; capacity: number }[];
}

export interface PortfolioDraft {
  name: string;
  description: string | null;
  color: string;
  workloadMeasure?: PortfolioWorkloadMeasure;
  defaultCapacity?: number | null;
}
