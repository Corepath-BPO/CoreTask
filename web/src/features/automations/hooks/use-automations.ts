import { AutomationRuleStatus, AutomationTrigger, rulesForSection } from '@coretask/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient } from '@/lib/api/query-client';

import { automationsApi, type AutomationRule } from '../api/automations.api';

/**
 * One key family for everything automation.
 *
 * Exported so the builder uses the same prefixes the rule list does — a second
 * factory is how a save refreshes one screen and leaves the other showing what
 * was there before.
 */
export const automationKeys = {
  all: (workspaceId: string, projectId: string) => ['automations', workspaceId, projectId] as const,
  graph: (workspaceId: string, projectId: string, ruleId: string) =>
    ['automations', workspaceId, projectId, ruleId, 'graph'] as const,
  metadata: (workspaceId: string, projectId: string) =>
    ['automations', workspaceId, projectId, 'metadata'] as const,
  executions: (workspaceId: string, projectId: string, ruleId: string) =>
    ['automations', workspaceId, projectId, ruleId, 'executions'] as const,
};

/** Kept for the call sites in this file. */
const keys = automationKeys;

/** Exported for the rule library's hooks, which answer the same API in the same words. */
export function reportRuleError(error: unknown, fallback: string) {
  /*
   * Publish failures carry a list of problems, and that list is the whole
   * value of the response — "This rule is not ready" alone tells someone
   * nothing about what to fix.
   */
  if (error instanceof ApiError) {
    const problems = (error.details as { problems?: string[] } | undefined)?.problems;

    if (problems?.length) {
      toast.error(error.message, { description: problems.join(' ') });
      return;
    }

    toast.error(error.message);
    return;
  }

  toast.error(fallback);
}

export function useAutomations(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: keys.all(workspaceId ?? '', projectId),
    queryFn: () => automationsApi.list(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
  });
}

/**
 * The rules that belong under one section, for the lightning popover.
 *
 * A view of the project's rules rather than a request of its own. It used to
 * hit `?sectionId=` once the popover opened, which meant the icon could not
 * know whether the section had rules until somebody clicked it — every
 * lightning sat grey, including on sections with rules — and a board of
 * twelve sections would have cost twelve requests to find out. One project
 * query, shared with the rule list through the same key, answers all of them
 * on first paint, and a save on the builder refreshes every section at once.
 *
 * Filtered by the same helper the endpoint uses, so the popover and
 * `?sectionId=` cannot list different rules.
 */
export function useSectionAutomations(
  workspaceId: string | undefined,
  projectId: string,
  sectionId: string,
) {
  return useQuery({
    queryKey: keys.all(workspaceId ?? '', projectId),
    queryFn: () => automationsApi.list(workspaceId as string, projectId),
    select: (rules) => rulesForSection(rules, sectionId),
    enabled: Boolean(workspaceId),
  });
}

export function useRuleExecutions(
  workspaceId: string | undefined,
  projectId: string,
  ruleId: string | null,
) {
  return useQuery({
    queryKey: keys.executions(workspaceId ?? '', projectId, ruleId ?? ''),
    queryFn: () => automationsApi.executions(workspaceId as string, projectId, ruleId as string),
    enabled: Boolean(workspaceId) && Boolean(ruleId),
  });
}

/** Every mutation invalidates the whole project's rules — they are few, and a
 *  stale status on a rule list is worse than an extra request. */
function useRuleMutation<TArgs>(
  workspaceId: string | undefined,
  projectId: string,
  run: (args: TArgs) => Promise<unknown>,
  { success, failure }: { success?: string; failure: string },
) {
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      if (success) toast.success(success);
      await queryClient.invalidateQueries({ queryKey: ['automations', workspaceId, projectId] });
    },
    onError: (error) => reportRuleError(error, failure),
  });
}

export function usePublishRule(workspaceId: string | undefined, projectId: string) {
  return useRuleMutation(
    workspaceId,
    projectId,
    (ruleId: string) => automationsApi.publish(workspaceId as string, projectId, ruleId),
    { success: 'Rule published.', failure: 'Could not publish that rule.' },
  );
}

export function usePauseRule(workspaceId: string | undefined, projectId: string) {
  return useRuleMutation(
    workspaceId,
    projectId,
    (ruleId: string) => automationsApi.pause(workspaceId as string, projectId, ruleId),
    { success: 'Rule paused.', failure: 'Could not pause that rule.' },
  );
}

export function useEnableRule(workspaceId: string | undefined, projectId: string) {
  return useRuleMutation(
    workspaceId,
    projectId,
    (ruleId: string) => automationsApi.enable(workspaceId as string, projectId, ruleId),
    { success: 'Rule enabled.', failure: 'Could not enable that rule.' },
  );
}

export function useDuplicateRule(workspaceId: string | undefined, projectId: string) {
  return useRuleMutation(
    workspaceId,
    projectId,
    (ruleId: string) => automationsApi.duplicate(workspaceId as string, projectId, ruleId),
    { success: 'Copied as a draft.', failure: 'Could not duplicate that rule.' },
  );
}

export function useRemoveRule(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (ruleId: string) => automationsApi.remove(workspaceId as string, projectId, ruleId),
    onSuccess: async (result) => {
      // A published rule archives rather than deletes, and saying so avoids the
      // reasonable assumption that it is gone.
      toast.success(result.archived ? 'Rule archived.' : 'Draft deleted.');
      await queryClient.invalidateQueries({ queryKey: ['automations', workspaceId, projectId] });
    },
    onError: (error) => reportRuleError(error, 'Could not remove that rule.'),
  });
}

export function useCreateRule(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (payload: Parameters<typeof automationsApi.create>[2]) =>
      automationsApi.create(workspaceId as string, projectId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['automations', workspaceId, projectId] });
    },
    onError: (error) => reportRuleError(error, 'Could not create that rule.'),
  });
}

/** A rule somebody can run from a task's menu, under the label the menu shows. */
export interface ManualRule {
  id: string;
  label: string;
}

const toManualRules = (rules: AutomationRule[]): ManualRule[] =>
  rules
    .filter(
      (rule) =>
        rule.status === AutomationRuleStatus.ACTIVE &&
        rule.triggerType === AutomationTrigger.RUN_MANUALLY,
    )
    .map((rule) => {
      const label = rule.triggerConfig['label'];
      return { id: rule.id, label: typeof label === 'string' && label.trim() ? label : rule.name };
    });

/**
 * The live manual rules of a project — Asana's "Run rule" submenu.
 *
 * A view of the same query the rule list reads, so publishing or pausing a
 * rule there changes the menu here without a request of its own.
 */
export function useManualRules(workspaceId: string | undefined, projectId: string | null) {
  return useQuery({
    queryKey: keys.all(workspaceId ?? '', projectId ?? ''),
    queryFn: () => automationsApi.list(workspaceId as string, projectId as string),
    enabled: Boolean(workspaceId && projectId),
    select: toManualRules,
  });
}

/** Runs a manual rule on the tasks given. The rule's own changes arrive over the socket. */
export function useRunRule(workspaceId: string | undefined, projectId: string | null) {
  return useMutation({
    mutationFn: ({ rule, taskIds }: { rule: ManualRule; taskIds: string[] }) =>
      automationsApi.run(
        workspaceId as string,
        projectId as string,
        rule.id,
        taskIds,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    onSuccess: ({ queued }, { rule }) =>
      toast.success(`Running “${rule.label}” on ${queued} task${queued === 1 ? '' : 's'}.`),
    onError: (error) => reportRuleError(error, 'Could not run that rule.'),
  });
}
