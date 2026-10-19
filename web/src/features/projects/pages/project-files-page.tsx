import type { Attachment, ProjectFile } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import { Download, Paperclip } from 'lucide-react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AttachmentThumbnail } from '@/features/attachments/components/attachment-thumbnail';
import { useDownloadAttachment } from '@/features/attachments/hooks/use-attachments';
import { formatBytes } from '@/features/attachments/lib/format-bytes';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { formatRelativeTime } from '@/lib/utils';

import { useProjectFiles } from '../hooks/use-project-updates';

/** A project file in the shape the attachment tile draws. */
const asAttachment = (file: ProjectFile, workspaceId: string): Attachment => ({
  id: file.id,
  workspaceId,
  taskId: file.task?.id ?? null,
  ticketId: null,
  commentId: null,
  filename: file.filename,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  status: 'READY',
  uploadedBy: file.uploader ? { ...file.uploader, email: '' } : null,
  createdAt: file.createdAt,
});

/**
 * The project's Files tab — Asana's: every file attached to its tasks in one
 * grid, newest first, each with the task it belongs to.
 *
 * Read-only by design. A file is added to a task, where it has a context; this
 * is the place to find one again.
 */
export function ProjectFilesPage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: files, isLoading } = useProjectFiles(workspaceId, projectId);
  const download = useDownloadAttachment(workspaceId);

  if (isLoading || !workspaceId) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-44 w-full" />
        ))}
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <EmptyState
        icon={Paperclip}
        title="No files yet"
        description="Files attached to this project's tasks gather here."
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Files">
      {files.map((file) => (
        <li key={file.id}>
          <Card className="h-full overflow-hidden">
            <CardContent className="space-y-2 p-3">
              <AttachmentThumbnail
                workspaceId={workspaceId}
                attachment={asAttachment(file, workspaceId)}
                className="h-28 w-full"
              />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={file.filename}>
                    {file.filename}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.sizeBytes)} · {formatRelativeTime(file.createdAt)}
                    {file.uploader ? ` · ${file.uploader.name}` : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Download ${file.filename}`}
                  disabled={download.isPending}
                  onClick={() => download.mutate(file.id)}
                >
                  <Download />
                </Button>
              </div>
              {file.task && (
                <Link
                  to="/projects/$projectId/list"
                  params={{ projectId }}
                  search={{ task: file.task.id }}
                  className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  On “{file.task.title}”
                </Link>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
