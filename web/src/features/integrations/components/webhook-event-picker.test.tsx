import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WebhookEventPicker } from './webhook-event-picker';

describe('WebhookEventPicker', () => {
  it('groups the events the way the docs describe them', () => {
    render(<WebhookEventPicker value={[]} onChange={vi.fn()} />);

    for (const group of ['Tasks', 'Comments', 'Tickets', 'Custom fields']) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Task completed')).toBeInTheDocument();
    expect(screen.getByLabelText('Comment added')).toBeInTheDocument();
  });

  /** Saved lists compare equal only if the order never depends on click order. */
  it('emits selections in the canonical order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WebhookEventPicker value={['task.completed']} onChange={onChange} />);

    await user.click(screen.getByLabelText('Task created'));
    expect(onChange).toHaveBeenCalledWith(['task.created', 'task.completed']);

    await user.click(screen.getByLabelText('Task completed'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('selects and clears a whole group at once', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<WebhookEventPicker value={[]} onChange={onChange} />);

    const buttons = screen.getAllByRole('button', { name: 'Select all' });
    // Groups render in order: Tasks, Comments, Tickets, Custom fields.
    await user.click(buttons[2] as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(['ticket.created', 'ticket.status_changed']);

    rerender(
      <WebhookEventPicker
        value={['ticket.created', 'ticket.status_changed']}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
