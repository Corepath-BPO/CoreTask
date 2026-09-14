import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { queryClient } from '@/lib/api/query-client';

import { automationTemplatesApi } from '../api/automation-templates.api';

import { reportRuleError } from './use-automations';

/**
 * Keyed by workspace, because that is what the library is scoped to.
 *
 * Every project's library dialog reads one cache entry, so saving a template
 * from one project shows it in the next without a refetch each has to know to
 * make.
 */
export const automationTemplateKeys = {
  all: (workspaceId: string) => ['automation-templates', workspaceId] as const,
};

export function useAutomationTemplates(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: automationTemplateKeys.all(workspaceId ?? ''),
    queryFn: () => automationTemplatesApi.list(workspaceId as string),
    // Fetched only when something is showing it: the library sits behind a
    // dialog, and a list nobody has opened is a request nobody asked for.
    enabled: Boolean(workspaceId) && enabled,
  });
}

const invalidateLibrary = (workspaceId: string | undefined) =>
  queryClient.invalidateQueries({ queryKey: automationTemplateKeys.all(workspaceId ?? '') });

export function useSaveTemplate(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: Parameters<typeof automationTemplatesApi.save>[1]) =>
      automationTemplatesApi.save(workspaceId as string, payload),
    onSuccess: async (template) => {
      toast.success(`“${template.name}” is in the rule library.`, {
        description: 'Start from it in any project of this workspace.',
      });
      await invalidateLibrary(workspaceId);
    },
    onError: (error) => reportRuleError(error, 'Could not save that rule to the library.'),
  });
}

export function useUpdateTemplate(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({
      templateId,
      ...payload
    }: { templateId: string } & Parameters<typeof automationTemplatesApi.update>[2]) =>
      automationTemplatesApi.update(workspaceId as string, templateId, payload),
    onSuccess: async () => {
      toast.success('Template updated.');
      await invalidateLibrary(workspaceId);
    },
    onError: (error) => reportRuleError(error, 'Could not update that template.'),
  });
}

export function useRemoveTemplate(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (templateId: string) =>
      automationTemplatesApi.remove(workspaceId as string, templateId),
    onSuccess: async () => {
      toast.success('Removed from the rule library.');
      await invalidateLibrary(workspaceId);
    },
    onError: (error) => reportRuleError(error, 'Could not remove that template.'),
  });
}

/**
 * Starting a draft in `projectId` from a template.
 *
 * No toast of its own: what to say depends on what could not be matched, and
 * the caller is the one that goes on to open the draft — so it says it there.
 */
export function useApplyTemplate(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ templateId, sectionId }: { templateId: string; sectionId?: string }) =>
      automationTemplatesApi.apply(workspaceId as string, templateId, {
        projectId,
        ...(sectionId ? { sectionId } : {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        // The project has a new rule; the template has a new use count.
        queryClient.invalidateQueries({ queryKey: ['automations', workspaceId, projectId] }),
        invalidateLibrary(workspaceId),
      ]);
    },
    onError: (error) => reportRuleError(error, 'Could not start a rule from that template.'),
  });
}
