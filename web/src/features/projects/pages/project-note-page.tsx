import { useEffect, useRef, useState } from 'react';

import { RichTextEditor } from '@/components/forms/rich-text-editor';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { formatRelativeTime } from '@/lib/utils/format';

import { useProjectNote, useSaveProjectNote } from '../hooks/use-project-note';
import { useProject } from '../hooks/use-projects';
import { useProjectAccess } from '../lib/project-access';

/** How long typing has to pause before the note saves itself. */
const SAVE_DELAY_MS = 1_000;

/**
 * The project's Note tab — Asana's project page: one document for the whole
 * project, a brief or a plan or meeting notes. Editors write it and it saves
 * itself after a pause and when they click away; everyone else reads it.
 */
export function ProjectNotePage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: project } = useProject(workspaceId, projectId);
  const access = useProjectAccess(project);
  const { data: note, isLoading } = useProjectNote(workspaceId, projectId);
  const save = useSaveProjectNote(workspaceId, projectId);

  const [dirty, setDirty] = useState(false);
  const latest = useRef<string | null>(null);
  const lastSaved = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (note && !dirty) lastSaved.current = note.body;
  }, [note, dirty]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const body = latest.current ?? '';
    if (body === lastSaved.current) {
      setDirty(false);
      return;
    }
    lastSaved.current = body;
    save.mutate(body, { onSettled: () => setDirty(false) });
  };

  // A save still waiting when the tab changes still happens.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => flushRef.current(), []);

  if (isLoading || !note) return <Skeleton className="h-72 w-full" />;

  const status =
    dirty || save.isPending
      ? 'Saving…'
      : note.updatedAt
        ? `Last edited ${formatRelativeTime(note.updatedAt)}${note.updatedBy ? ` by ${note.updatedBy.name}` : ''}`
        : access.canEdit
          ? 'Nobody has written anything yet.'
          : 'Nothing written yet.';

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2">
      <p className="text-right text-xs text-muted-foreground" aria-live="polite">
        {status}
      </p>
      <RichTextEditor
        initialValue={note.body}
        workspaceId={workspaceId}
        editable={access.canEdit}
        toolbar="always"
        minHeightClassName="min-h-[24rem]"
        ariaLabel="Project note"
        placeholder="A brief, a plan, decisions, links — whatever the project needs written down."
        onChange={(html) => {
          latest.current = html ?? '';
          setDirty(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, SAVE_DELAY_MS);
        }}
        onBlur={() => {
          if (timer.current) flush();
        }}
      />
    </div>
  );
}
