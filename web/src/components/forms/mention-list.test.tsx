import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MentionList } from './mention-list';

const items = [
  { id: 'u-1', name: 'Ada Lovelace', email: 'ada@example.com', avatarUrl: null },
  { id: 'u-2', name: 'Grace Hopper', email: 'grace@example.com', avatarUrl: null },
];

describe('MentionList', () => {
  it('marks the highlighted person and picks on mouse down, before any blur can land', () => {
    const onPick = vi.fn();
    render(<MentionList items={items} highlighted={1} onPick={onPick} onHighlight={vi.fn()} />);

    const options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.mouseDown(options[0] as HTMLElement);
    expect(onPick).toHaveBeenCalledWith(items[0]);
  });
});
