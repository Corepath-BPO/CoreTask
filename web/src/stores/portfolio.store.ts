import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Portfolios are Asana-shaped: a portfolio *references* projects, it never
 * contains them. One project can sit in any number of portfolios, and adding
 * or removing it changes only the portfolio — the project is untouched.
 *
 * Client-only for now — there is no portfolio API. State persists to this
 * browser's localStorage, keyed by workspace so switching tenants cannot show
 * another tenant's portfolios (the same rule the query keys follow). Only
 * project *ids* are stored: the projects themselves are always fetched live,
 * so a portfolio can never show stale names or counts.
 */
export interface Portfolio {
  id: string;
  name: string;
  description: string | null;
  color: string;
  /** References, in the order they were added. */
  projectIds: string[];
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the form provides; everything else the store fills in. */
export interface PortfolioDraft {
  name: string;
  description: string | null;
  color: string;
}

interface PortfolioState {
  portfoliosByWorkspace: Record<string, Portfolio[]>;
  createPortfolio: (workspaceId: string, draft: PortfolioDraft) => Portfolio;
  updatePortfolio: (workspaceId: string, portfolioId: string, draft: PortfolioDraft) => void;
  deletePortfolio: (workspaceId: string, portfolioId: string) => void;
  addProjects: (workspaceId: string, portfolioId: string, projectIds: string[]) => void;
  removeProject: (workspaceId: string, portfolioId: string, projectId: string) => void;
  toggleStarred: (workspaceId: string, portfolioId: string) => void;
}

/** Applies `update` to one portfolio and stamps `updatedAt`. */
function patch(
  workspaceId: string,
  portfolioId: string,
  update: (portfolio: Portfolio) => Portfolio,
) {
  return (state: Pick<PortfolioState, 'portfoliosByWorkspace'>) => ({
    portfoliosByWorkspace: {
      ...state.portfoliosByWorkspace,
      [workspaceId]: (state.portfoliosByWorkspace[workspaceId] ?? []).map((portfolio) =>
        portfolio.id === portfolioId
          ? { ...update(portfolio), updatedAt: new Date().toISOString() }
          : portfolio,
      ),
    },
  });
}

export const usePortfolioStore = create<PortfolioState>()(
  persist(
    (set) => ({
      portfoliosByWorkspace: {},

      createPortfolio: (workspaceId, draft) => {
        const now = new Date().toISOString();
        const portfolio: Portfolio = {
          id: crypto.randomUUID(),
          name: draft.name,
          description: draft.description,
          color: draft.color,
          projectIds: [],
          starred: false,
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          portfoliosByWorkspace: {
            ...state.portfoliosByWorkspace,
            [workspaceId]: [...(state.portfoliosByWorkspace[workspaceId] ?? []), portfolio],
          },
        }));

        return portfolio;
      },

      updatePortfolio: (workspaceId, portfolioId, draft) =>
        set(patch(workspaceId, portfolioId, (portfolio) => ({ ...portfolio, ...draft }))),

      deletePortfolio: (workspaceId, portfolioId) =>
        set((state) => ({
          portfoliosByWorkspace: {
            ...state.portfoliosByWorkspace,
            [workspaceId]: (state.portfoliosByWorkspace[workspaceId] ?? []).filter(
              (portfolio) => portfolio.id !== portfolioId,
            ),
          },
        })),

      addProjects: (workspaceId, portfolioId, projectIds) =>
        set(
          patch(workspaceId, portfolioId, (portfolio) => ({
            ...portfolio,
            projectIds: [
              ...portfolio.projectIds,
              ...projectIds.filter((id) => !portfolio.projectIds.includes(id)),
            ],
          })),
        ),

      removeProject: (workspaceId, portfolioId, projectId) =>
        set(
          patch(workspaceId, portfolioId, (portfolio) => ({
            ...portfolio,
            projectIds: portfolio.projectIds.filter((id) => id !== projectId),
          })),
        ),

      toggleStarred: (workspaceId, portfolioId) =>
        set(
          patch(workspaceId, portfolioId, (portfolio) => ({
            ...portfolio,
            // `?? false` tolerates portfolios persisted before starring existed.
            starred: !(portfolio.starred ?? false),
          })),
        ),
    }),
    { name: 'coretask.portfolios' },
  ),
);

/** Stable empty result, so an unknown workspace does not re-render forever. */
const NO_PORTFOLIOS: Portfolio[] = [];

export const usePortfolios = (workspaceId: string | undefined): Portfolio[] =>
  usePortfolioStore((state) =>
    workspaceId ? (state.portfoliosByWorkspace[workspaceId] ?? NO_PORTFOLIOS) : NO_PORTFOLIOS,
  );

export const usePortfolio = (
  workspaceId: string | undefined,
  portfolioId: string,
): Portfolio | null =>
  usePortfolioStore(
    (state) =>
      (workspaceId
        ? (state.portfoliosByWorkspace[workspaceId] ?? NO_PORTFOLIOS)
        : NO_PORTFOLIOS
      ).find((portfolio) => portfolio.id === portfolioId) ?? null,
  );
