import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { toInstant, toIsoCalendarDate, ymd, type Schedule } from '@/lib/utils';

import { TaskDatePopover } from './task-date-popover';

const DAY = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const none: Schedule = { startDate: null, startAt: null, dueDate: null, dueAt: null };

const today = new Date();
const todayKey = ymd(today);
const todayIso = toIsoCalendarDate(todayKey);

function renderPicker(schedule: Schedule = none, props: { dateOnly?: boolean } = {}) {
  const onSave = vi.fn();
  render(
    <TaskDatePopover schedule={schedule} onSave={onSave} open onOpenChange={() => {}} {...props}>
      <button type="button">Due</button>
    </TaskDatePopover>,
  );
  return { onSave };
}

describe('TaskDatePopover', () => {
  it('saves a picked day as a calendar date with no time', async () => {
    const { onSave } = renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: DAY.format(today) }));

    expect(onSave).toHaveBeenCalledWith({ dueDate: todayIso, dueAt: null });
  });

  it('fills the start once the Start field is chosen, then moves on to the due', async () => {
    const { onSave } = renderPicker({ ...none, dueDate: todayIso });

    fireEvent.click(await screen.findByRole('button', { name: 'Start date' }));
    fireEvent.click(screen.getByRole('button', { name: DAY.format(today) }));

    // Same day as the due, so the due is left alone.
    expect(onSave).toHaveBeenCalledWith({ startDate: todayIso, startAt: null });
    expect(screen.getByRole('button', { name: 'Due date' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('turns the due date into a moment when a time is added', async () => {
    const { onSave } = renderPicker({ ...none, dueDate: todayIso });

    fireEvent.click(await screen.findByRole('button', { name: 'Add time' }));
    fireEvent.change(screen.getByLabelText('Due time'), { target: { value: '15:00' } });

    expect(onSave).toHaveBeenCalledWith({
      dueDate: todayIso,
      dueAt: toInstant(todayKey, '15:00'),
    });
  });

  it('removes the time from both ends at once', async () => {
    const { onSave } = renderPicker({
      startDate: todayIso,
      startAt: toInstant(todayKey, '09:00'),
      dueDate: todayIso,
      dueAt: toInstant(todayKey, '15:00'),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Remove time' }));

    expect(onSave).toHaveBeenCalledWith({ dueAt: null, startAt: null });
  });

  it('clears the whole schedule', async () => {
    const { onSave } = renderPicker({ ...none, startDate: todayIso, dueDate: todayIso });

    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));

    expect(onSave).toHaveBeenCalledWith({
      startDate: null,
      startAt: null,
      dueDate: null,
      dueAt: null,
    });
  });

  it('offers neither a start nor a time for a date-only item', async () => {
    renderPicker({ ...none, dueDate: todayIso }, { dateOnly: true });

    expect(await screen.findByRole('button', { name: 'Due date' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start date' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add time' })).not.toBeInTheDocument();
  });

  it('keeps recurring honest: present, disabled, and marked Soon', async () => {
    renderPicker();

    const repeat = await screen.findByRole('button', { name: /Set to repeat/ });
    expect(repeat).toBeDisabled();
    expect(repeat).toHaveTextContent('Soon');
  });
});
