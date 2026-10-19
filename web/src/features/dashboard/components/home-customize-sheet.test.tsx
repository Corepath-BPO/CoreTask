import type { HomeWidget } from '@coretask/contracts';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HomeCustomizeSheet } from './home-customize-sheet';
import { NotepadWidget } from './home-widgets';

const renderSheet = (widgets: HomeWidget[]) => {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <HomeCustomizeSheet
      open
      onOpenChange={vi.fn()}
      widgets={widgets}
      onChange={onChange}
      onReset={onReset}
    />,
  );
  return { onChange, onReset };
};

describe('HomeCustomizeSheet', () => {
  it('moves, hides and adds widgets, and resets', async () => {
    const user = userEvent.setup();
    const { onChange, onReset } = renderSheet(['TASK_OVERVIEW', 'ASSIGNED', 'UPCOMING']);

    await user.click(screen.getByRole('button', { name: 'Move Assigned to you up' }));
    expect(onChange).toHaveBeenLastCalledWith(['ASSIGNED', 'TASK_OVERVIEW', 'UPCOMING']);

    await user.click(screen.getByRole('button', { name: 'Hide Upcoming deadlines' }));
    expect(onChange).toHaveBeenLastCalledWith(['TASK_OVERVIEW', 'ASSIGNED']);

    await user.click(screen.getByRole('button', { name: 'Add Private notepad' }));
    expect(onChange).toHaveBeenLastCalledWith(['TASK_OVERVIEW', 'ASSIGNED', 'UPCOMING', 'NOTEPAD']);

    // The ends cannot move past themselves.
    expect(screen.getByRole('button', { name: 'Move Task overview up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Upcoming deadlines down' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(onReset).toHaveBeenCalled();
  });
});

describe('NotepadWidget', () => {
  it('saves after a pause in typing, and once more on leaving the box', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const onSave = vi.fn();
      render(<NotepadWidget notepad="" onSave={onSave} />);

      await user.type(screen.getByRole('textbox', { name: 'Private notepad' }), 'Call');
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByText('Saving…')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenLastCalledWith('Call');
      expect(screen.getByText('Saved')).toBeInTheDocument();

      // Leaving without changes saves nothing more.
      await user.tab();
      expect(onSave).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
