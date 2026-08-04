import type { AutomationRuleStatus } from '@coretask/contracts';

import { apiClient } from '@/lib/api/client';

export interface AutomationNode {
  id: string;
  nodeType: string;
  subtype: string;
  configuration: Record<string, unknown>;
  position: number;
}

export interface AutomationRule {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: AutomationRuleStatus;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  nodes: AutomationNode[];
  createdBy: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  runCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationExecution {
  id: string;
  status: string;
  triggerType: string;
  skippedReason: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string;
  logs: {
    id: string;
    subtype: string;
    succeeded: boolean;
    message: string | null;
  }[];
}

const base = (workspaceId: string, projectId: string) =>
  `/workspaces/${workspaceId}/projects/${projectId}/automations`;

export const automationsApi = {
  /** `sectionId` narrows to rules whose trigger watches that section. */
  list: (workspaceId: string, projectId: string, sectionId?: string): Promise<AutomationRule[]> =>
    apiClient.get<AutomationRule[]>(base(workspaceId, projectId), {
      params: sectionId ? { sectionId } : undefined,
    }),

  get: (workspaceId: string, projectId: string, ruleId: string): Promise<AutomationRule> =>
    apiClient.get<AutomationRule>(`${base(workspaceId, projectId)}/${ruleId}`),

  create: (
    workspaceId: string,
    projectId: string,
    payload: {
      name: string;
      triggerType: string;
      description?: string;
      triggerConfig?: Record<string, unknown>;
      nodes?: { nodeType: string; subtype: string; configuration?: Record<string, unknown> }[];
    },
  ): Promise<AutomationRule> =>
    apiClient.post<AutomationRule>(base(workspaceId, projectId), payload),

  publish: (workspaceId: string, projectId: string, ruleId: string): Promise<AutomationRule> =>
    apiClient.post<AutomationRule>(`${base(workspaceId, projectId)}/${ruleId}/publish`, {}),

  pause: (workspaceId: string, projectId: string, ruleId: string): Promise<AutomationRule> =>
    apiClient.post<AutomationRule>(`${base(workspaceId, projectId)}/${ruleId}/pause`, {}),

  enable: (workspaceId: string, projectId: string, ruleId: string): Promise<AutomationRule> =>
    apiClient.post<AutomationRule>(`${base(workspaceId, projectId)}/${ruleId}/enable`, {}),

  duplicate: (workspaceId: string, projectId: string, ruleId: string): Promise<AutomationRule> =>
    apiClient.post<AutomationRule>(`${base(workspaceId, projectId)}/${ruleId}/duplicate`, {}),

  remove: (
    workspaceId: string,
    projectId: string,
    ruleId: string,
  ): Promise<{ deleted: boolean; archived: boolean }> =>
    apiClient.delete<{ deleted: boolean; archived: boolean }>(
      `${base(workspaceId, projectId)}/${ruleId}`,
    ),

  executions: (
    workspaceId: string,
    projectId: string,
    ruleId: string,
  ): Promise<AutomationExecution[]> =>
    apiClient.get<AutomationExecution[]>(`${base(workspaceId, projectId)}/${ruleId}/executions`),
};
