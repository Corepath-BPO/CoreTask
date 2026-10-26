import type { ProjectNote } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectNotePage } from './project-note-page';

const save = vi.fn();
let note: ProjectNote;
let canEdit = true;

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', role: 'MEMBER' } }),
}));
vi.mock('../hooks/use-projects', () => ({ useProject: () => ({ data: { id: 'p-1' } }) }));
vi.mock('../lib/project-access', () => ({ useProjectAccess: () => ({ canEdit }) }));
vi.mock('../hooks/use-project-note', () => ({
  useProjectNote: () => ({ data: note, isLoading: false }),
  useSaveProjectNote: () => ({ mutate: save, isPending: false }),
}));

// The editor is Tiptap's business; the page's is when to save what it says.
vi.mock('@/components/forms/rich-text-editor', () => ({
  RichTextEditor: ({
    initialValue,
    editable,
    onChange,
    onBlur,
  }: {
    initialValue: string;
    editable: boolean;
    onChange: (html: string | null) => void;
    onBlur: () => void;
  }) => (
    <textarea
      aria-label="Project note"
      defaultValue={initialValue}
      readOnly={!editable}
      onChange={(event) => onChange(event.target.value || null)}
      onBlur={onBlur}
    />
  ),
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectNotePage projectId="p-1" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset();
  canEdit = true;
  note = {
    body: '<p>Plan</p>',
    updatedBy: { id: 'u-1', name: 'Ada Owner' },
    updatedAt: new Date().toISOString(),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ProjectNotePage', () => {
  it('says who wrote it last, and saves once typing pauses', () => {
    renderPage();
    expect(screen.getByText(/Last edited .* by Ada Owner/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Project note'), { target: { value: '<p>Plan B</p>' } });
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('<p>Plan B</p>', expect.anything());
  });

  it('saves straight away when the editor is left, and not twice', () => {
    renderPage();
    const editor = screen.getByLabelText('Project note');
    fireEvent.change(editor, { target: { value: '<p>Now</p>' } });
    fireEvent.blur(editor);
    expect(save).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('is read-only for someone who cannot edit the project', () => {
    canEdit = false;
    note = { body: '', updatedBy: null, updatedAt: null };
    renderPage();
    expect(screen.getByLabelText('Project note')).toHaveAttribute('readonly');
    expect(screen.getByText('Nothing written yet.')).toBeInTheDocument();
  });
});
