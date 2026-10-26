import { formatMention } from '@coretask/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommentBody } from './comment-body';

vi.mock('@/features/attachments/hooks/use-attachment-view-url', () => ({
  useAttachmentViewUrl: () => ({ data: undefined, isError: false, refetch: vi.fn() }),
}));

const ADA = '019fc880-0000-7000-8000-00000000aaaa';
const GRACE = '019fc880-0000-7000-8000-00000000bbbb';

describe('CommentBody', () => {
  it('renders stored markup as the structure it describes', () => {
    render(<CommentBody body="<p>Read <strong>this</strong></p><ul><li>one</li></ul>" />);

    expect(screen.getByText('this').tagName).toBe('STRONG');
    expect(screen.getByText('one').closest('li')).not.toBeNull();
  });

  it('draws a chip for a mention', () => {
    const { container } = render(
      <CommentBody body={`<p>Hey <span data-mention="${ADA}">@Ada Lovelace</span></p>`} />,
    );

    const chip = container.querySelector('span[data-mention]');
    expect(chip?.getAttribute('data-mention')).toBe(ADA);
    expect(chip?.textContent).toBe('@Ada Lovelace');
  });

  it('tints a mention of the reader, and nobody else', () => {
    const { container } = render(
      <CommentBody
        body={`<p><span data-mention="${ADA}">@Ada</span> and <span data-mention="${GRACE}">@Grace</span></p>`}
        currentUserId={ADA}
      />,
    );

    const chips = [...container.querySelectorAll('span[data-mention]')];
    expect(chips[0]?.hasAttribute('data-me')).toBe(true);
    expect(chips[1]?.hasAttribute('data-me')).toBe(false);
  });

  /** A row from before comments were rich text still reads as a chip. */
  it('converts a legacy token body on the way in', () => {
    const { container } = render(
      <CommentBody body={`Ping ${formatMention(ADA, 'Ada Lovelace')} please\nsecond line`} />,
    );

    const chip = container.querySelector('span[data-mention]');
    expect(chip?.getAttribute('data-mention')).toBe(ADA);
    expect(chip?.textContent).toBe('@Ada Lovelace');
    expect(container.textContent).not.toContain('](');
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });
});
