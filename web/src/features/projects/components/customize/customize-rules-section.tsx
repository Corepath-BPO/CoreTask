import { AUTOMATION_STATE_COLOR, TRIGGER_LABEL } from '@coretask/contracts';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { AutomationRule } from '@/features/automations/api/automations.api';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';

/**
 * The project's rules, listed inside the Customize panel.
 *
 * A directory rather than a second rule editor: each row hands off to the
 * builder, which already owns editing, and creating starts the same "new rule"
 * canvas the Automations tab starts. Both destinations navigate with a fresh
 * search, which drops `?customize=` — the panel gives way to the canvas.
 */
export function CustomizeRulesSection({
  projectId,
  rules,
  isLoading,
  canManage,
}: {
  projectId: string;
  rules: AutomationRule[] | undefined;
  isLoading: boolean;
  canManage: boolean;
}) {
  const navigate = useNavigate();

  const openRule = (ruleId: string) =>
    void navigate({
      to: '/projects/$projectId/automations/$ruleId',
      params: { projectId, ruleId },
      search: {},
    });

  const newRule = () =>
    void navigate({
      to: '/projects/$projectId/automations/new',
      params: { projectId },
      search: {},
    });

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Rules react to what happens on this project and act without anyone remembering to.
      </p>

      {isLoading &&
        Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}

      {!isLoading && (rules ?? []).length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No rules yet.
        </p>
      )}

      {(rules ?? []).map((rule) => (
        <button
          key={rule.id}
          type="button"
          onClick={() => openRule(rule.id)}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <Zap className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{rule.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {TRIGGER_LABEL[rule.triggerType as keyof typeof TRIGGER_LABEL] ?? rule.triggerType}
            </span>
          </span>
          <SemanticBadge
            color={{
              colorToken:
                AUTOMATION_STATE_COLOR[rule.status as keyof typeof AUTOMATION_STATE_COLOR] ??
                'gray',
            }}
          >
            {rule.status.toLowerCase()}
          </SemanticBadge>
        </button>
      ))}

      {canManage && (
        <Button variant="outline" size="sm" className="w-full" onClick={newRule}>
          <Plus />
          New rule
        </Button>
      )}
    </div>
  );
}
