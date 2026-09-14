import type { AppliedAutomationTemplate, AutomationTemplate } from '@coretask/types';

import { apiClient } from '@/lib/api/client';

import type { AutomationRule } from './automations.api';

/** What `apply` answers with: the new draft in full, plus what it could not match. */
export type AppliedTemplate = Omit<AppliedAutomationTemplate, 'rule'> & { rule: AutomationRule };

const base = (workspaceId: string) => `/workspaces/${workspaceId}/automation-templates`;

/**
 * The rule library, which is workspace-wide.
 *
 * Addressed by workspace rather than project on purpose: a template belongs to
 * no project, and the same list has to appear whichever project somebody opens
 * it from.
 */
export const automationTemplatesApi = {
  list: (workspaceId: string): Promise<AutomationTemplate[]> =>
    apiClient.get<AutomationTemplate[]>(base(workspaceId)),

  /** Snapshots a rule. The template does not follow the rule afterwards. */
  save: (
    workspaceId: string,
    payload: {
      projectId: string;
      ruleId: string;
      name?: string;
      description?: string;
      /** Save the shape without this project's sections, statuses and fields. */
      clearReferences?: boolean;
    },
  ): Promise<AutomationTemplate> => apiClient.post<AutomationTemplate>(base(workspaceId), payload),

  update: (
    workspaceId: string,
    templateId: string,
    payload: { name?: string; description?: string },
  ): Promise<AutomationTemplate> =>
    apiClient.patch<AutomationTemplate>(`${base(workspaceId)}/${templateId}`, payload),

  remove: (workspaceId: string, templateId: string): Promise<{ deleted: boolean }> =>
    apiClient.delete<{ deleted: boolean }>(`${base(workspaceId)}/${templateId}`),

  /** Starts a draft in `projectId` from the template. Never a live rule. */
  apply: (
    workspaceId: string,
    templateId: string,
    payload: { projectId: string; sectionId?: string },
  ): Promise<AppliedTemplate> =>
    apiClient.post<AppliedTemplate>(`${base(workspaceId)}/${templateId}/apply`, payload),
};
