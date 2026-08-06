import { AUTOMATION_STATE_COLOR, AutomationRuleStatus, TRIGGER_LABEL } from '@coretask/contracts';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, Plus, Settings2, Zap } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatRelativeTime } from '@/lib/utils';

import type { AutomationRule } from '../api/automations.api';
import { useSectionAutomations } from '../hooks/use-automations';

/**
 * What the lightning icon is telling you, worst state first.
 *
 * Colour alone never carries this — the icon's `aria-label` and the popover
 * both say it in words, because "amber vs blue at 14px" is not a distinction
 * everyone can make.
 */
function summarise(rules: AutomationRule[]): {
  tone: 'none' | 'active' | 'warning' | 'failing';
  label: string;
} {
  if (rules.length === 0) return { tone: 'none', label: 'No rules on this section' };

  if (rules.some((rule) => rule.failureCount > 0)) {
    return { tone: 'failing', label: 'A rule on this section has failed recently' };
  }

  if (rules.some((rule) => rule.status === AutomationRuleStatus.PAUSED)) {
    return { tone: 'warning', label: 'A rule on this section is paused' };
  }

  const active = rules.filter((rule) => rule.status === AutomationRuleStatus.ACTIVE).length;

  return active > 0
    ? { tone: 'active', label: `${active} active rule${active === 1 ? '' : 's'}` }
    : { tone: 'none', label: 'No active rules on this section' };
}

const TONE_CLASS: Record<string, string> = {
  none: 'text-muted-foreground',
  active: 'text-[color:var(--color-primary)]',
  warning: 'text-amber-500',
  failing: 'text-destructive',
};

/**
 * The rules attached to one board or list section.
 *
 * Fetched only once the popover opens: a board with a dozen sections would
 * otherwise fire a dozen requests nobody asked for on first paint.
 */
export function SectionAutomationPopover({
  projectId,
  sectionId,
  sectionName,
}: {
  projectId: string;
  sectionId: string;
  sectionName: string;
}) {
  const [open, setOpen] = useState(false);
  const { workspace } = useActiveWorkspace();

  const { data: rules, isLoading } = useSectionAutomations(
    workspace?.id,
    projectId,
    sectionId,
    open,
  );

  const summary = summarise(rules ?? []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          // The state is in the name, not only the colour.
          aria-label={`Automations for ${sectionName} — ${summary.label}`}
          title={summary.label}
        >
          <Zap className={cn('size-4', TONE_CLASS[summary.tone])} aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium">Rules for {sectionName}</p>
          <p className="text-xs text-muted-foreground">{summary.label}</p>
        </div>

        <div className="max-h-64 overflow-y-auto p-1">
          {isLoading ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (rules ?? []).length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Nothing runs when a task lands here yet.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {(rules ?? []).map((rule) => (
                <li key={rule.id} className="rounded-md px-2 py-1.5 hover:bg-muted">
                  <p className="truncate text-sm font-medium">{rule.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {TRIGGER_LABEL[rule.triggerType as keyof typeof TRIGGER_LABEL] ??
                      rule.triggerType}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <SemanticBadge
                      color={{
                        colorToken:
                          AUTOMATION_STATE_COLOR[
                            rule.status as keyof typeof AUTOMATION_STATE_COLOR
                          ] ?? 'gray',
                      }}
                    >
                      {rule.status.toLowerCase()}
                    </SemanticBadge>
                    <span className="text-[11px] text-muted-foreground">
                      {rule.lastRunAt
                        ? `Last run ${formatRelativeTime(rule.lastRunAt)}`
                        : 'Never run'}
                    </span>
                    {rule.failureCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {rule.failureCount}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-1 border-t border-border p-1">
          {/*
            The section travels with the link, so the builder opens already
            scoped to "when a task moves here" rather than asking again for
            something the click already said.
          */}
          <Button asChild variant="ghost" size="sm" className="flex-1 justify-start">
            <Link
              to="/projects/$projectId/automations/new"
              params={{ projectId }}
              search={{ sectionId }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add rule
            </Link>
          </Button>

          <Button asChild variant="ghost" size="sm" className="flex-1 justify-start">
            <Link to="/projects/$projectId/automations" params={{ projectId }}>
              <Settings2 className="size-4" aria-hidden="true" />
              Manage all
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
