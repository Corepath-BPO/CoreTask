import { formatMention } from '@coretask/contracts';
import type { UserRef } from '@coretask/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CommentBody, segmentCommentBody } from './comment-body';

const ADA = '019fc880-0000-7000-8000-00000000aaaa';
const GRACE = '019fc880-0000-7000-8000-00000000bbbb';

const ada: UserRef = { id: ADA, name: 'Ada Lovelace', email: 'ada@example.com', avatarUrl: null };
const grace: UserRef = {
  id: GRACE,
  name: 'Grace Hopper',
  email: 'grace@example.com',
  avatarUrl: null,
};

describe('segmentCommentBody', () => {
  it('returns one text segment for a body without mentions', () => {
    expect(segmentCommentBody('Nothing special here', [])).toEqual([
      { kind: 'text', value: 'Nothing special here' },
    ]);
  });

  it('splits text around a mention', () => {
    const body = `Hey ${formatMention(ADA, 'Ada Lovelace')} look`;

    expect(segmentCommentBody(body, [ada])).toEqual([
      { kind: 'text', value: 'Hey ' },
      { kind: 'mention', userId: ADA, label: 'Ada Lovelace', resolved: true },
      { kind: 'text', value: ' look' },
    ]);
  });

  /** A renamed member should read as their current name, not the stored label. */
  it('prefers the resolved name over the stored label', () => {
    const body = `@[Ada L.](${ADA})`;
    const segments = segmentCommentBody(body, [ada]);

    expect(segments[0]).toMatchObject({ label: 'Ada Lovelace', resolved: true });
  });

  it('falls back to the label when the user no longer resolves', () => {
    const body = `@[Departed Person](${GRACE})`;
    const segments = segmentCommentBody(body, []);

    expect(segments[0]).toMatchObject({ label: 'Departed Person', resolved: false });
  });

  it('handles several mentions and adjacent tokens', () => {
    const body = `${formatMention(ADA, 'Ada')}${formatMention(GRACE, 'Grace')}`;
    const segments = segmentCommentBody(body, [ada, grace]);

    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.kind === 'mention')).toBe(true);
  });

  it('keeps a trailing mention without inventing an empty text segment', () => {
    const body = `Thanks ${formatMention(ADA, 'Ada')}`;
    const segments = segmentCommentBody(body, [ada]);

    expect(segments).toHaveLength(2);
    expect(segments[1]?.kind).toBe('mention');
  });

  /**
   * The shared pattern carries the global flag and is therefore stateful. A
   * fresh `RegExp` per call is what stops a re-render from skipping matches.
   */
  it('gives the same answer when called repeatedly', () => {
    const body = `${formatMention(ADA, 'Ada')} and ${formatMention(GRACE, 'Grace')}`;

    const first = segmentCommentBody(body, [ada, grace]);
    const second = segmentCommentBody(body, [ada, grace]);
    const third = segmentCommentBody(body, [ada, grace]);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.filter((segment) => segment.kind === 'mention')).toHaveLength(2);
  });
});

describe('CommentBody', () => {
  it('renders mentions as chips with an @ prefix', () => {
    render(<CommentBody body={`Hi ${formatMention(ADA, 'Ada Lovelace')}`} mentions={[ada]} />);

    expect(screen.getByText('@Ada Lovelace')).toBeInTheDocument();
  });

  it('marks a mention of the reader differently from anyone else', () => {
    const body = `${formatMention(ADA, 'Ada')} ${formatMention(GRACE, 'Grace')}`;
    const { container } = render(
      <CommentBody body={body} mentions={[ada, grace]} currentUserId={ADA} />,
    );

    const mine = container.querySelector(`[data-mention="${ADA}"]`);
    const theirs = container.querySelector(`[data-mention="${GRACE}"]`);

    expect(mine?.className).not.toBe(theirs?.className);
    expect(mine?.className).toContain('text-primary');
  });

  it('renders plain text untouched', () => {
    render(<CommentBody body="No mentions, just words" mentions={[]} />);
    expect(screen.getByText('No mentions, just words')).toBeInTheDocument();
  });

  /** Tokens are markup, not content — none of it should leak into the output. */
  it('never shows raw token syntax', () => {
    const body = `Hi ${formatMention(ADA, 'Ada Lovelace')}`;
    const { container } = render(<CommentBody body={body} mentions={[ada]} />);

    expect(container.textContent).not.toContain(ADA);
    expect(container.textContent).not.toContain('](');
  });
});
