import type { AutomationMetadata } from '@coretask/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';
import { ChecklistFields, TeamFields } from './team-and-checklist-fields';

const metadata = {
  teams: [
    { id: 'team-1', name: 'Maintenance', color: '#0ea5e9' },
    { id: 'team-2', name: 'Leasing', color: '#a855f7' },
  ],
} as AutomationMetadata;

describe('TeamFields', () => {
  it('writes the chosen team, or a deliberate clear', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    const { rerender } = render(
      <TeamFields configuration={{}} metadata={metadata} onChange={onChange} />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Team' }));
    await user.click(screen.getByRole('option', { name: 'Leasing' }));
    expect(onChange).toHaveBeenLastCalledWith({ teamId: 'team-2' });

    rerender(
      <TeamFields configuration={{ teamId: 'team-2' }} metadata={metadata} onChange={onChange} />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Team' }));
    await user.click(screen.getByRole('option', { name: 'No team — clear it' }));
    // The team is dropped, not left beside the clear.
    expect(onChange).toHaveBeenLastCalledWith({ clear: true });
  });

  it('says where to make a team when the workspace has none', () => {
    render(
      <TeamFields
        configuration={{}}
        metadata={{ teams: [] } as unknown as AutomationMetadata}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/has no teams yet/)).toBeInTheDocument();
  });
});

describe('ChecklistFields', () => {
  it('stores the items one per line, blanks and all, while somebody types', () => {
    const onChange = vi.fn();
    render(
      <ChecklistFields configuration={{ name: 'Move-in', items: ['Keys'] }} onChange={onChange} />,
    );

    const items = screen.getByRole('textbox', { name: 'Items' });
    expect(items).toHaveValue('Keys');

    fireEvent.change(items, { target: { value: 'Keys\n\nMeters' } });
    expect(onChange).toHaveBeenLastCalledWith({ name: 'Move-in', items: ['Keys', '', 'Meters'] });
  });
});
