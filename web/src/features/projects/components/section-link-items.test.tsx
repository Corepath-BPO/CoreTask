import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { sectionLink } from '../lib/section-link';
import { SectionLinkItems } from './section-link-items';

const PROJECT = '0198c9a1-2b3c-7d4e-89ab-0123456789ab';
const SECTION = '0198c9a1-2b3c-7d4e-89ab-0123456789cd';

function renderMenu() {
  const user = userEvent.setup();
  // `userEvent.setup()` installs its own clipboard; the spy has to come after.
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Section options</DropdownMenuTrigger>
      <DropdownMenuContent>
        <SectionLinkItems projectId={PROJECT} sectionId={SECTION} view="list" />
      </DropdownMenuContent>
    </DropdownMenu>,
  );

  return { user, writeText };
}

describe('SectionLinkItems', () => {
  it('builds a link that lands on the section in the given view', () => {
    expect(sectionLink(PROJECT, 'board', SECTION)).toBe(
      `${window.location.origin}/projects/${PROJECT}/board?section=${SECTION}`,
    );
  });

  it('copies the bare id, for pasting into a tool', async () => {
    const { user, writeText } = renderMenu();

    await user.click(screen.getByRole('button', { name: 'Section options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy section ID' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECTION));
  });

  it('copies a full link that names the section', async () => {
    const { user, writeText } = renderMenu();

    await user.click(screen.getByRole('button', { name: 'Section options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy link to section' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/projects/${PROJECT}/list?section=${SECTION}`,
      ),
    );
  });
});
