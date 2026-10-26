import type { PortfolioStatusUpdate } from '@coretask/types';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { PortfolioStatusDialog } from './portfolio-status-dialog';
import { PortfolioStatusHistory } from './portfolio-status-history';
import { StatusUpdateMenu } from './status-update';

const post = vi.fn();
const remove = vi.fn();
let updates: PortfolioStatusUpdate[] = [];

vi.mock('../hooks/use-portfolio-status', () => ({
  usePostPortfolioStatus: () => ({ mutate: post, isPending: false }),
  usePortfolioStatusUpdates: () => ({ data: updates }),
  useDeletePortfolioStatus: () => ({ mutate: remove }),
}));

const update = (over: Partial<PortfolioStatusUpdate>): PortfolioStatusUpdate => ({
  id: 'su-1',
  portfolioId: 'pf-1',
  status: 'ON_TRACK',
  title: 'Week 42',
  summary: null,
  nextSteps: null,
  author: { id: 'u-1', name: 'Ada Owner', avatarUrl: null },
  createdAt: '2026-10-14T09:00:00.000Z',
  ...over,
});

beforeEach(() => {
  post.mockReset();
  remove.mockReset();
  updates = [];
});

describe('PortfolioStatusDialog', () => {
  it('posts the status picked, with a title, summary and next steps', async () => {
    const user = setupUser();
    render(
      <PortfolioStatusDialog
        workspaceId="ws-1"
        portfolio={{ id: 'pf-1', name: 'Leasing programme' }}
        initialStatus="at_risk"
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('radio', { name: 'At risk' })).toHaveAttribute('aria-checked', 'true');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toContain(
      'Leasing programme - ',
    );
    await user.click(screen.getByRole('radio', { name: 'Off track' }));
    await user.type(screen.getByLabelText('Summary'), 'Two buildings behind.');
    await user.click(screen.getByRole('button', { name: 'Post status' }));

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'off_track', summary: 'Two buildings behind.' }),
      expect.anything(),
    );
  });
});

describe('PortfolioStatusHistory', () => {
  it('shows the newest prominently, folds the rest, and deletes where allowed', async () => {
    const user = setupUser();
    updates = [
      update({ id: 'su-2', title: 'Week 42', summary: 'Back on track.', nextSteps: 'Sign leases' }),
      update({
        id: 'su-1',
        status: 'AT_RISK',
        title: 'Week 41',
        author: { id: 'u-2', name: 'Bea', avatarUrl: null },
      }),
    ];
    render(
      <PortfolioStatusHistory
        workspaceId="ws-1"
        portfolioId="pf-1"
        canDelete={(entry) => entry.author?.id === 'u-1'}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Portfolio status' })).toBeVisible();
    expect(screen.getByText('Back on track.')).toBeVisible();
    expect(screen.getByText('1 earlier update')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Delete “Week 41”' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Delete “Week 42”' }));
    expect(remove).toHaveBeenCalledWith('su-2');
  });

  it('shows nothing before the first update', () => {
    const { container } = render(
      <PortfolioStatusHistory workspaceId="ws-1" portfolioId="pf-1" canDelete={() => false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('StatusUpdateMenu', () => {
  it('asks for an update, and offers only that to someone who cannot post one', async () => {
    const user = setupUser();
    const onRequest = vi.fn();
    render(<StatusUpdateMenu onPick={() => {}} onRequest={onRequest} canPick={false} />);

    await user.click(screen.getByRole('button', { name: /Update status/ }));
    expect(screen.queryByRole('menuitem', { name: 'On track' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Request status update' }));
    expect(onRequest).toHaveBeenCalled();
  });

  it('leaves the request out when there is nobody to ask', async () => {
    const user = setupUser();
    render(<StatusUpdateMenu onPick={() => {}} />);

    await user.click(screen.getByRole('button', { name: /Update status/ }));
    expect(screen.getByRole('menuitem', { name: 'On track' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Request status update' })).toBeNull();
  });
});
