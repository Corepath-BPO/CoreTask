import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RatingCell } from './rating-cell';

describe('RatingCell', () => {
  it('sets a rating with one click', () => {
    const onCommit = vi.fn();
    render(<RatingCell value={null} max={5} canEdit label="Confidence" onCommit={onCommit} />);

    fireEvent.click(screen.getByRole('radio', { name: '3 of 5' }));

    expect(onCommit).toHaveBeenCalledWith(3);
  });

  it('clears the rating when the current star is clicked again', () => {
    // The only way a row of stars can say "no rating".
    const onCommit = vi.fn();
    render(<RatingCell value={3} max={5} canEdit label="Confidence" onCommit={onCommit} />);

    fireEvent.click(screen.getByRole('radio', { name: '3 of 5' }));

    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it('offers as many stars as the field has', () => {
    render(<RatingCell value={null} max={7} canEdit label="Confidence" onCommit={vi.fn()} />);

    expect(screen.getAllByRole('radio')).toHaveLength(7);
  });

  it('moves with the arrow keys, stopping at the ends', () => {
    const onCommit = vi.fn();
    render(<RatingCell value={5} max={5} canEdit label="Confidence" onCommit={onCommit} />);

    const group = screen.getByRole('radiogroup', { name: 'Confidence' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith(5);

    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenLastCalledWith(4);
  });

  it('reads, but does not edit, for somebody who may not', () => {
    render(<RatingCell value={2} max={5} canEdit={false} label="Confidence" onCommit={vi.fn()} />);

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Confidence: 2 of 5' })).toBeInTheDocument();
  });
});
