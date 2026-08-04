import { WorkspaceRole } from '@coretask/contracts';
import type { Team, TeamDetail } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { useAuthStore } from '@/stores/auth.store';

import { TeamsPage } from './teams-page';

const WORKSPACE = '019fc880-0000-7000-8000-000000000000';
const ME = '019fc880-0000-7000-8000-00000000aaaa';
const OTHER = '019fc880-0000-7000-8000-00000000bbbb';

const listTeams = vi.fn();
const teamDetail = vi.fn();
const createTeam = vi.fn();
const updateTeam = vi.fn();
const removeTeam = vi.fn();
const addTeamMember = vi.fn();
const removeTeamMember = vi.fn();

let activeRole: WorkspaceRole = WorkspaceRole.OWNER;

vi.mock('../api/teams.api', () => ({
  teamsApi: {
    list: (...args: unknown[]) => listTeams(...args),
    detail: (...args: unknown[]) => teamDetail(...args),
    create: (...args: unknown[]) => createTeam(...args),
    update: (...args: unknown[]) => updateTeam(...args),
    remove: (...args: unknown[]) => removeTeam(...args),
    addMember: (...args: unknown[]) => addTeamMember(...args),
    removeMember: (...args: unknown[]) => removeTeamMember(...args),
  },
}));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({
    workspace: { id: WORKSPACE, name: 'Acme Product', role: activeRole },
    workspaces: [],
    isLoading: false,
    select: vi.fn(),
  }),
  useWorkspaceMembers: () => ({
    data: [
      {
        id: 'm1',
        workspaceId: WORKSPACE,
        role: WorkspaceRole.OWNER,
        joinedAt: '2026-01-01T00:00:00.000Z',
        user: { id: ME, name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null },
      },
      {
        id: 'm2',
        workspaceId: WORKSPACE,
        role: WorkspaceRole.MEMBER,
        joinedAt: '2026-02-01T00:00:00.000Z',
        user: { id: OTHER, name: 'Jonas Feld', email: 'jonas@coretask.dev', avatarUrl: null },
      },
    ],
    isLoading: false,
  }),
}));

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    workspaceId: WORKSPACE,
    name: 'Platform',
    description: 'Auth and the shell',
    color: '#6366F1',
    lead: { id: ME, name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null },
    leadId: ME,
    memberCount: 2,
    projectCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function detail(overrides: Partial<TeamDetail> = {}): TeamDetail {
  return {
    ...team(),
    members: [
      { id: ME, name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null },
      { id: OTHER, name: 'Jonas Feld', email: 'jonas@coretask.dev', avatarUrl: null },
    ],
    ...overrides,
  };
}

const renderPage = () => renderWithRouter(() => <TeamsPage />);

describe('TeamsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeRole = WorkspaceRole.OWNER;
    listTeams.mockResolvedValue([team()]);
    teamDetail.mockResolvedValue(detail());
    useAuthStore.setState({
      user: { id: ME, name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null },
      status: 'authenticated',
    } as never);
  });

  it('lists teams with their lead and counts', async () => {
    await renderPage();

    expect(await screen.findByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Demo Owner')).toBeInTheDocument();
    expect(screen.getByText('2 members')).toBeInTheDocument();
    expect(screen.getByText('3 projects')).toBeInTheDocument();
  });

  it('links the project count at the filtered project list', async () => {
    await renderPage();

    const link = await screen.findByRole('link', { name: /3 projects/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('teamId=team-1'));
  });

  it('says so plainly when a team has no lead', async () => {
    listTeams.mockResolvedValue([team({ lead: null, leadId: null })]);
    await renderPage();

    expect(await screen.findByText('No lead')).toBeInTheDocument();
  });

  describe('permissions', () => {
    it('offers no way to create a team to a plain member', async () => {
      activeRole = WorkspaceRole.MEMBER;
      await renderPage();

      await screen.findByText('Platform');
      expect(screen.queryByRole('button', { name: /new team/i })).not.toBeInTheDocument();
    });

    it('lets a lead edit their own team without being an admin', async () => {
      activeRole = WorkspaceRole.MEMBER;
      await renderPage();

      await screen.findByText('Platform');
      await userEvent.click(screen.getByRole('button', { name: /actions for platform/i }));

      expect(await screen.findByRole('menuitem', { name: /edit team/i })).toBeInTheDocument();
      // Dissolving a team stays an administrator's call.
      expect(screen.queryByRole('menuitem', { name: /delete team/i })).not.toBeInTheDocument();
    });

    it('gives a member who is neither admin nor lead no actions at all', async () => {
      activeRole = WorkspaceRole.MEMBER;
      listTeams.mockResolvedValue([team({ leadId: OTHER, lead: null })]);
      await renderPage();

      await screen.findByText('Platform');
      expect(
        screen.queryByRole('button', { name: /actions for platform/i }),
      ).not.toBeInTheDocument();
    });

    it('shows a read-only roster to someone who cannot manage it', async () => {
      activeRole = WorkspaceRole.MEMBER;
      listTeams.mockResolvedValue([team({ leadId: OTHER, lead: null })]);
      await renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /view members/i }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Jonas Feld')).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    });
  });

  describe('creating', () => {
    it('sends the form and closes the dialog', async () => {
      createTeam.mockResolvedValue(team({ id: 'team-2', name: 'Design' }));
      await renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /new team/i }));

      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/team name/i), 'Design');
      await userEvent.click(within(dialog).getByRole('button', { name: /create team/i }));

      await waitFor(() => {
        expect(createTeam).toHaveBeenCalledWith(
          WORKSPACE,
          expect.objectContaining({ name: 'Design' }),
        );
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('refuses a name that is too short before sending anything', async () => {
      await renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /new team/i }));

      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/team name/i), 'X');
      await userEvent.click(within(dialog).getByRole('button', { name: /create team/i }));

      expect(await within(dialog).findByText(/at least 2 characters/i)).toBeInTheDocument();
      expect(createTeam).not.toHaveBeenCalled();
    });
  });

  describe('deleting', () => {
    it('warns that the projects survive, then deletes', async () => {
      removeTeam.mockResolvedValue(undefined);
      await renderPage();

      await screen.findByText('Platform');
      await userEvent.click(screen.getByRole('button', { name: /actions for platform/i }));
      await userEvent.click(await screen.findByRole('menuitem', { name: /delete team/i }));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText(/3 projects stay put/i)).toBeInTheDocument();

      await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

      await waitFor(() => expect(removeTeam).toHaveBeenCalledWith(WORKSPACE, 'team-1'));
    });
  });

  describe('the roster', () => {
    it('adds someone and drops them again', async () => {
      // Only the owner is on the team, so Jonas is the one candidate to add.
      teamDetail.mockResolvedValue(
        detail({
          members: [{ id: ME, name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null }],
        }),
      );
      addTeamMember.mockResolvedValue(detail());
      removeTeamMember.mockResolvedValue(detail());
      await renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /manage members/i }));

      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('combobox', { name: /person to add/i }));
      await userEvent.click(await screen.findByRole('option', { name: 'Jonas Feld' }));
      await userEvent.click(within(dialog).getByRole('button', { name: /^add$/i }));

      await waitFor(() =>
        expect(addTeamMember).toHaveBeenCalledWith(WORKSPACE, 'team-1', { userId: OTHER }),
      );

      await userEvent.click(
        within(dialog).getByRole('button', { name: /remove demo owner from platform/i }),
      );
      await waitFor(() =>
        expect(removeTeamMember).toHaveBeenCalledWith(WORKSPACE, 'team-1', ME),
      );
    });

    it('marks the lead on the roster', async () => {
      await renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /manage members/i }));

      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('Lead')).toBeInTheDocument();
    });
  });

  it('invites the first team when there are none', async () => {
    listTeams.mockResolvedValue([]);
    await renderPage();

    expect(await screen.findByText(/no teams yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create a team/i })).toBeInTheDocument();
  });
});
