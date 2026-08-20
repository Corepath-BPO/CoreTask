import { beforeEach, describe, expect, it } from 'vitest';

import { usePortfolioStore } from './portfolio.store';

const WS_A = 'workspace-a';
const WS_B = 'workspace-b';

const draft = { name: 'Q3 launches', description: null, color: '#6366f1' };

const portfoliosIn = (workspaceId: string) =>
  usePortfolioStore.getState().portfoliosByWorkspace[workspaceId] ?? [];

beforeEach(() => {
  usePortfolioStore.setState({ portfoliosByWorkspace: {} });
  localStorage.clear();
});

describe('portfolio store', () => {
  it('creates a portfolio scoped to its workspace', () => {
    const created = usePortfolioStore.getState().createPortfolio(WS_A, draft);

    expect(created.projectIds).toEqual([]);
    expect(portfoliosIn(WS_A).map((portfolio) => portfolio.id)).toEqual([created.id]);
    expect(portfoliosIn(WS_B)).toEqual([]);
  });

  it('lets one project sit in many portfolios', () => {
    const state = usePortfolioStore.getState();
    const first = state.createPortfolio(WS_A, draft);
    const second = state.createPortfolio(WS_A, { ...draft, name: 'Everything' });

    usePortfolioStore.getState().addProjects(WS_A, first.id, ['project-1']);
    usePortfolioStore.getState().addProjects(WS_A, second.id, ['project-1']);

    expect(portfoliosIn(WS_A).map((portfolio) => portfolio.projectIds)).toEqual([
      ['project-1'],
      ['project-1'],
    ]);
  });

  it('never duplicates a project already in the portfolio', () => {
    const created = usePortfolioStore.getState().createPortfolio(WS_A, draft);

    usePortfolioStore.getState().addProjects(WS_A, created.id, ['project-1', 'project-2']);
    usePortfolioStore.getState().addProjects(WS_A, created.id, ['project-2', 'project-3']);

    expect(portfoliosIn(WS_A)[0]?.projectIds).toEqual(['project-1', 'project-2', 'project-3']);
  });

  it('removes only the named project reference', () => {
    const created = usePortfolioStore.getState().createPortfolio(WS_A, draft);
    usePortfolioStore.getState().addProjects(WS_A, created.id, ['project-1', 'project-2']);

    usePortfolioStore.getState().removeProject(WS_A, created.id, 'project-1');

    expect(portfoliosIn(WS_A)[0]?.projectIds).toEqual(['project-2']);
  });

  it('updates fields without touching membership', () => {
    const created = usePortfolioStore.getState().createPortfolio(WS_A, draft);
    usePortfolioStore.getState().addProjects(WS_A, created.id, ['project-1']);

    usePortfolioStore.getState().updatePortfolio(WS_A, created.id, {
      name: 'Renamed',
      description: 'Now with words',
      color: '#000000',
    });

    const updated = portfoliosIn(WS_A)[0];
    expect(updated?.name).toBe('Renamed');
    expect(updated?.description).toBe('Now with words');
    expect(updated?.projectIds).toEqual(['project-1']);
  });

  it('toggles starred on and off', () => {
    const created = usePortfolioStore.getState().createPortfolio(WS_A, draft);
    expect(created.starred).toBe(false);

    usePortfolioStore.getState().toggleStarred(WS_A, created.id);
    expect(portfoliosIn(WS_A)[0]?.starred).toBe(true);

    usePortfolioStore.getState().toggleStarred(WS_A, created.id);
    expect(portfoliosIn(WS_A)[0]?.starred).toBe(false);
  });

  it('deletes a portfolio without crossing workspaces', () => {
    const inA = usePortfolioStore.getState().createPortfolio(WS_A, draft);
    const inB = usePortfolioStore.getState().createPortfolio(WS_B, draft);

    usePortfolioStore.getState().deletePortfolio(WS_A, inA.id);

    expect(portfoliosIn(WS_A)).toEqual([]);
    expect(portfoliosIn(WS_B).map((portfolio) => portfolio.id)).toEqual([inB.id]);
  });
});
