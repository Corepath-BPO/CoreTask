import type { ProjectSummary } from '@coretask/types';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, userEvent } from '@/test/test-utils';

import { ProjectCard } from './project-card';

const baseProject: ProjectSummary = {
  id: '019fc880-0000-7000-8000-000000000001',
  workspaceId: '019fc880-0000-7000-8000-0000000000ff',
  name: 'Platform Foundation',
  key: 'PLAT',
  description: 'Authentication and the shell',
  status: 'ACTIVE',
  color: '#6366F1',
  leadId: null,
  lead: null,
  startDate: null,
  dueDate: null,
  completedAt: null,
  archivedAt: null,
  taskCount: 10,
  completedTaskCount: 4,
  sectionCount: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Must be awaited: `renderWithRouter` resolves the initial match before
// rendering, so a synchronous wrapper would assert against an empty DOM.
async function renderCard(
  overrides: Partial<ProjectSummary> = {},
  props: Record<string, unknown> = {},
) {
  const onEdit = vi.fn();
  const onToggleArchive = vi.fn();

  await renderWithRouter(() => (
    <ProjectCard
      project={{ ...baseProject, ...overrides }}
      onEdit={onEdit}
      onToggleArchive={onToggleArchive}
      canEdit
      canArchive
      {...props}
    />
  ));

  return { onEdit, onToggleArchive };
}

describe('ProjectCard', () => {
  it('shows the name, key and description', async () => {
    await renderCard();

    expect(screen.getByText('Platform Foundation')).toBeInTheDocument();
    expect(screen.getByText('PLAT')).toBeInTheDocument();
    expect(screen.getByText('Authentication and the shell')).toBeInTheDocument();
  });

  it('reports task progress as a rounded percentage', async () => {
    await renderCard({ taskCount: 10, completedTaskCount: 4 });

    expect(screen.getByText('4/10 tasks')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('does not divide by zero for a project with no tasks', async () => {
    await renderCard({ taskCount: 0, completedTaskCount: 0 });

    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('links to the project board', async () => {
    await renderCard();

    expect(screen.getByRole('link', { name: /platform foundation/i })).toHaveAttribute(
      'href',
      `/projects/${baseProject.id}`,
    );
  });

  it('marks an archived project', async () => {
    await renderCard({ archivedAt: '2026-02-01T00:00:00.000Z' });
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('offers Archive for an active project and Restore for an archived one', async () => {
    const user = userEvent.setup();
    const { onToggleArchive } = await renderCard();

    await user.click(screen.getByRole('button', { name: /actions for platform foundation/i }));
    await user.click(await screen.findByRole('menuitem', { name: /archive project/i }));

    expect(onToggleArchive).toHaveBeenCalledTimes(1);
  });

  it('hides the action menu entirely without permission', async () => {
    await renderCard({}, { canEdit: false, canArchive: false });

    expect(
      screen.queryByRole('button', { name: /actions for platform foundation/i }),
    ).not.toBeInTheDocument();
  });

  it('shows only Edit when the caller cannot archive', async () => {
    const user = userEvent.setup();
    await renderCard({}, { canArchive: false });

    await user.click(screen.getByRole('button', { name: /actions for platform foundation/i }));

    expect(await screen.findByRole('menuitem', { name: /edit project/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /archive project/i })).not.toBeInTheDocument();
  });
});
