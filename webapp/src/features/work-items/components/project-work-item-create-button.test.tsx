import { WorkItemType } from '@coretask/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setupUser } from '@/test/test-utils';

import { ProjectWorkItemCreateButton } from './project-work-item-create-button';

const permissions = {
  canCreate: true,
  canCreateSection: true,
  creatableTypes: [WorkItemType.TASK, WorkItemType.TICKET],
  comingSoonTypes: [WorkItemType.MILESTONE, WorkItemType.APPROVAL],
};

vi.mock('../hooks/use-work-item-permissions', () => ({
  useWorkItemPermissions: () => permissions,
}));

const onCreate = vi.fn();
const onCreateSection = vi.fn();

const context = { projectId: 'p-1', sourceView: 'LIST' as const };

const render = (props: Partial<Parameters<typeof ProjectWorkItemCreateButton>[0]> = {}) =>
  renderWithProviders(
    <ProjectWorkItemCreateButton
      defaultType="TASK"
      context={context}
      onCreate={onCreate}
      onCreateSection={onCreateSection}
      {...props}
    />,
  );

beforeEach(() => {
  Object.assign(permissions, {
    canCreate: true,
    canCreateSection: true,
    creatableTypes: [WorkItemType.TASK, WorkItemType.TICKET],
    comingSoonTypes: [WorkItemType.MILESTONE, WorkItemType.APPROVAL],
  });
});

describe('the main segment', () => {
  it('is labelled with the project default', () => {
    render({ defaultType: 'TICKET' });

    expect(screen.getByRole('button', { name: /add ticket/i })).toBeInTheDocument();
  });

  it('creates the default type without opening the menu', () => {
    // The point of a split button: the common case is one click.
    render({ defaultType: 'TICKET' });

    fireEvent.click(screen.getByRole('button', { name: /add ticket/i }));

    expect(onCreate).toHaveBeenCalledWith('TICKET', context);
  });

  it('follows the project default when it changes', () => {
    const { rerender } = render({ defaultType: 'TASK' });
    expect(screen.getByRole('button', { name: /add task/i })).toBeInTheDocument();

    rerender(
      <ProjectWorkItemCreateButton
        defaultType="TICKET"
        context={context}
        onCreate={onCreate}
        onCreateSection={onCreateSection}
      />,
    );

    expect(screen.getByRole('button', { name: /add ticket/i })).toBeInTheDocument();
  });
});

describe('the menu', () => {
  /*
   * `userEvent`, not `fireEvent.click`.
   *
   * Radix opens the menu on `pointerdown`, and a synthetic click never fires
   * one — the menu simply never appeared. `userEvent` dispatches the real
   * pointer sequence, which is also what a person's mouse does. It hands that
   * user back, for the clicks inside the menu.
   */
  const openMenu = async () => {
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: /choose what to add/i }));
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
    return user;
  };

  it('offers every creatable type, and marks the default', async () => {
    render({ defaultType: 'TASK' });
    await openMenu();

    expect(screen.getByRole('menuitem', { name: /task/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /ticket/i })).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('creates the chosen type rather than the default', async () => {
    render({ defaultType: 'TASK' });
    const user = await openMenu();

    await user.click(screen.getByRole('menuitem', { name: /ticket/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('TICKET', context));
  });

  it('shows unbuilt types disabled and says why', async () => {
    /*
     * Not hidden. "Coming" and "never considered" look identical when a type is
     * simply absent — and offering it would create a task wearing a milestone's
     * label, which is the failure this whole upgrade is about.
     */
    render();
    await openMenu();

    const milestone = screen.getByRole('menuitem', { name: /milestone/i });

    expect(milestone).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
  });

  it('does not create anything when a disabled type is clicked', async () => {
    render();
    const user = await openMenu();

    await user.click(screen.getByRole('menuitem', { name: /milestone/i }));

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('offers Section, separately from the item types', async () => {
    render();
    const user = await openMenu();

    await user.click(screen.getByRole('menuitem', { name: /^section$/i }));

    await waitFor(() => expect(onCreateSection).toHaveBeenCalled());
  });

  it('omits Section for somebody who cannot create one', async () => {
    permissions.canCreateSection = false;
    render();
    await openMenu();

    expect(screen.queryByRole('menuitem', { name: /^section$/i })).not.toBeInTheDocument();
  });

  it('omits Section entirely when no handler is given', async () => {
    const user = setupUser();
    // The Board's column header has no use for it; passing nothing should not
    // render a menu entry that does nothing.
    renderWithProviders(
      <ProjectWorkItemCreateButton defaultType="TASK" context={context} onCreate={onCreate} />,
    );

    await user.click(screen.getByRole('button', { name: /choose what to add/i }));
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());

    expect(screen.queryByRole('menuitem', { name: /^section$/i })).not.toBeInTheDocument();
  });
});

describe('permission', () => {
  it('renders nothing at all for somebody who cannot create', () => {
    // Not a disabled button: that invites somebody to keep clicking and wonder
    // what is broken.
    permissions.canCreate = false;

    const { container } = render();

    expect(container).toBeEmptyDOMElement();
  });
});
