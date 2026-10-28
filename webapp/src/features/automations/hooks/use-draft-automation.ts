import type { AutomationDraft, DraftAutomationPayload } from '@coretask/types';
import { useMutation } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';

/**
 * Longer than the client's usual 20 s: the server waits on a model, and once
 * more after a pause when the model is busy.
 */
const DRAFT_TIMEOUT_MS = 75_000;

/**
 * A rule drafted from a sentence, for the builder to open unsaved.
 *
 * Nothing is created, so nothing is invalidated. A failure is the caller's to
 * show: the Add automation page says it under the box the sentence was typed
 * in, rather than in a toast that would cover the gallery.
 */
export function useDraftAutomation(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (payload: DraftAutomationPayload) =>
      apiClient.post<AutomationDraft>(
        `/workspaces/${workspaceId as string}/projects/${projectId}/automations/draft`,
        payload,
        { timeout: DRAFT_TIMEOUT_MS },
      ),
  });
}
