import type { AutomationTemplate } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';

import { describeUnresolved } from '../lib/template-summary';

import { useApplyTemplate } from './use-automation-templates';

/**
 * Starts a draft in this project from a saved template, and opens it.
 *
 * Shared by the rule library and the Add automation page, which offer the same
 * templates and should say the same thing about what came across.
 */
export function useStartFromTemplate(
  workspaceId: string | undefined,
  projectId: string,
  sectionId?: string,
) {
  const navigate = useNavigate();
  const apply = useApplyTemplate(workspaceId, projectId);
  const [startingId, setStartingId] = useState<string | null>(null);

  const start = (template: AutomationTemplate, onStarted?: () => void) => {
    setStartingId(template.id);

    apply.mutate(
      { templateId: template.id, ...(sectionId ? { sectionId } : {}) },
      {
        onSuccess: (applied) => {
          onStarted?.();

          /*
           * Said here rather than in the mutation, because what to say depends
           * on the answer. A clean match is a draft to look over; an unmatched
           * section is a draft with a blank in it, and the blank is the news.
           */
          const gaps = describeUnresolved(applied.unresolved);
          if (gaps) {
            toast.warning(`Started “${template.name}” as a draft.`, {
              description: gaps,
              duration: 12_000,
            });
          } else {
            toast.success(`Started “${template.name}” as a draft.`, {
              description: 'Check it over, then publish it when it reads right.',
            });
          }

          void navigate({
            to: '/projects/$projectId/automations/$ruleId',
            params: { projectId, ruleId: applied.rule.id },
            search: {},
          });
        },
        onSettled: () => setStartingId(null),
      },
    );
  };

  return { start, startingId, isPending: apply.isPending };
}
