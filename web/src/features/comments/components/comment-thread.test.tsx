import { WorkspaceRole } from '@coretask/contracts';
import type { Comment } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth.store';

import { CommentThread } from './comment-thread';

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();

vi.mock('../api/comments.api', () => ({
  commentsApi: {
    list: (...args: unknown[]) => list(...args),
    create: (...args: unknown[]) => create(...args),
    update: (...args: unknown[]) => update(...args),
    remove: (...args: unknown[]) => remove(...args),
  },
}));

const ME = '019fc880-0000-7000-8000-00000000aaaa';
const SOMEONE_ELSE = '019fc880-0000-7000-8000-00000000bbbb';
const WORKSPACE = '019fc880-0000-7000-8000-000000000000';

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: '019fc880-0000-7000-8000-00000000c001',
    workspaceId: WORKSPACE,
    body: 'Reproduced on staging',
    authorId: ME,
    author: { id: ME, name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null },
    taskId: '019fc880-0000-7000-8000-00000000t001',
    ticketId: null,
    editedAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function renderThread(role: WorkspaceRole = WorkspaceRole.MEMBER) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  return render(
    <QueryClientProvider client={client}>
      <CommentThread
        workspaceId={WORKSPACE}
        parent={{ kind: 'task', id: '019fc880-0000-7000-8000-00000000t001' }}
        role={role}
      />
    </QueryClientProvider>,
  );
}

describe('CommentThread', () => {
  beforeEach(() => {
    list.mockReset();
    create.mockReset();
    update.mockReset();
    remove.mockReset();

    list.mockResolvedValue({ items: [], meta: { page: 1, limit: 50, total: 0, totalPages: 0 } });
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: ME,
        email: 'demo@coretask.dev',
        name: 'Demo Owner',
        avatarUrl: null,
        timezone: 'UTC',
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('renders an empty thread without pretending it failed', async () => {
    renderThread();
    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeInTheDocument());
  });

  it('shows each comment with its author', async () => {
    list.mockResolvedValue({
      items: [comment(), comment({ id: 'c2', body: 'Second', createdAt: '2026-08-01T11:00:00Z' })],
      meta: { page: 1, limit: 50, total: 2, totalPages: 1 },
    });

    renderThread();

    await waitFor(() => expect(screen.getByText('Reproduced on staging')).toBeInTheDocument());
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getAllByText('Demo Owner')).toHaveLength(2);
  });

  it('marks an edited comment', async () => {
    list.mockResolvedValue({
      items: [comment({ editedAt: '2026-08-01T12:00:00.000Z' })],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    renderThread();
    await waitFor(() => expect(screen.getByText('(edited)')).toBeInTheDocument());
  });

  it('posts a comment and clears the box', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue(comment({ body: 'Posted' }));

    renderThread();
    await waitFor(() => expect(screen.getByLabelText(/write a comment/i)).toBeInTheDocument());

    const box = screen.getByLabelText(/write a comment/i);
    await user.type(box, 'Posted');
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[2]).toEqual({ body: 'Posted' });
    await waitFor(() => expect(box).toHaveValue(''));
  });

  /** Losing what someone typed because the request failed is unforgivable. */
  it('keeps the draft when posting fails', async () => {
    const user = userEvent.setup();
    create.mockRejectedValue(new Error('offline'));

    renderThread();
    await waitFor(() => expect(screen.getByLabelText(/write a comment/i)).toBeInTheDocument());

    const box = screen.getByLabelText(/write a comment/i);
    await user.type(box, 'Hard-won words');
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(box).toHaveValue('Hard-won words');
  });

  it('will not post whitespace', async () => {
    const user = userEvent.setup();

    renderThread();
    await waitFor(() => expect(screen.getByLabelText(/write a comment/i)).toBeInTheDocument());

    await user.type(screen.getByLabelText(/write a comment/i), '   ');

    expect(screen.getByRole('button', { name: /^comment$/i })).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it('offers edit and delete on your own comment', async () => {
    list.mockResolvedValue({
      items: [comment()],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    renderThread();

    await waitFor(() => expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('offers neither on someone else’s comment when you are a member', async () => {
    list.mockResolvedValue({
      items: [
        comment({
          authorId: SOMEONE_ELSE,
          author: {
            id: SOMEONE_ELSE,
            name: 'Maya Okafor',
            email: 'maya@coretask.dev',
            avatarUrl: null,
          },
        }),
      ],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    renderThread(WorkspaceRole.MEMBER);

    await waitFor(() => expect(screen.getByText('Maya Okafor')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  /** Moderation is delete-only: a manager removes, but never rewrites. */
  it('offers delete but not edit on someone else’s comment when you are a manager', async () => {
    list.mockResolvedValue({
      items: [
        comment({
          authorId: SOMEONE_ELSE,
          author: {
            id: SOMEONE_ELSE,
            name: 'Maya Okafor',
            email: 'maya@coretask.dev',
            avatarUrl: null,
          },
        }),
      ],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    renderThread(WorkspaceRole.MANAGER);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('hides the composer from a guest but still shows the thread', async () => {
    list.mockResolvedValue({
      items: [comment()],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    renderThread(WorkspaceRole.GUEST);

    await waitFor(() => expect(screen.getByText('Reproduced on staging')).toBeInTheDocument());
    expect(screen.queryByLabelText(/write a comment/i)).not.toBeInTheDocument();
  });

  it('edits in place and sends only the new body', async () => {
    const user = userEvent.setup();
    list.mockResolvedValue({
      items: [comment()],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
    update.mockResolvedValue(comment({ body: 'Revised', editedAt: '2026-08-01T12:00:00Z' }));

    renderThread();
    await waitFor(() => expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const editor = screen.getByLabelText(/edit comment/i);
    await user.clear(editor);
    await user.type(editor, 'Revised');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[2]).toEqual({ body: 'Revised' });
  });

  it('does not call the API when an edit changes nothing', async () => {
    const user = userEvent.setup();
    list.mockResolvedValue({
      items: [comment()],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    renderThread();
    await waitFor(() => expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.queryByLabelText(/edit comment/i)).not.toBeInTheDocument());
    expect(update).not.toHaveBeenCalled();
  });

  it('abandons an edit without sending it', async () => {
    const user = userEvent.setup();
    list.mockResolvedValue({
      items: [comment()],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    renderThread();
    await waitFor(() => expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.clear(screen.getByLabelText(/edit comment/i));
    await user.type(screen.getByLabelText(/edit comment/i), 'Discard me');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText('Reproduced on staging')).toBeInTheDocument();
  });

  it('survives an author whose account has been removed', async () => {
    list.mockResolvedValue({
      items: [comment({ author: null, authorId: SOMEONE_ELSE })],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    renderThread();
    await waitFor(() => expect(screen.getByText('Removed account')).toBeInTheDocument());
  });
});
