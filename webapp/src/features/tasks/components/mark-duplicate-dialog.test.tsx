import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { MarkDuplicateDialog } from './mark-duplicate-dialog';

const mark = vi.fn();

vi.mock('@/features/search/hooks/use-search', () => ({
  useSearch: (_workspaceId: string, term: string) => ({
    isFetching: false,
    data: term
      ? {
          tasks: [
            { id: 't-1', title: 'Kitchen sink leaking', isCompleted: false, project: null },
            {
              id: 't-2',
              title: 'Leak under the sink',
              isCompleted: false,
              project: { id: 'p-1', name: 'Maintenance', color: '#f00' },
            },
          ],
        }
      : undefined,
  }),
}));
vi.mock('../hooks/use-task-duplicates', () => ({
  useMarkDuplicate: () => ({ mutate: mark, isPending: false }),
}));

beforeEach(() => mark.mockReset());

describe('MarkDuplicateDialog', () => {
  it('finds the original, leaves this task out, and marks it', async () => {
    const user = setupUser();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MarkDuplicateDialog workspaceId="ws-1" taskId="t-1" onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );

    const confirm = screen.getByRole('button', { name: 'Mark as duplicate' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Find the original task'), 'sink');
    expect(screen.queryByText('Kitchen sink leaking')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Leak under the sink/ }));
    await user.click(confirm);
    expect(mark).toHaveBeenCalledWith('t-2', expect.anything());
  });
});
