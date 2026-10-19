import { ApiRoutes } from '@coretask/contracts';

import { http } from '@/lib/api/client';

/** The file name a `Content-Disposition` header gives, if it gives one. */
export function filenameFrom(disposition: string | undefined, fallback: string): string {
  return /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? fallback;
}

/**
 * Downloads a project's CSV export. Fetched with the session's token rather
 * than by navigating, because the route needs it; then handed to the browser
 * as a file.
 */
export async function downloadProjectCsv(workspaceId: string, projectId: string): Promise<void> {
  const response = await http.get<Blob>(ApiRoutes.projectExportCsv(workspaceId, projectId), {
    responseType: 'blob',
  });
  const href = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = href;
  link.download = filenameFrom(
    response.headers['content-disposition'] as string | undefined,
    'project.csv',
  );
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has handed the file over.
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
