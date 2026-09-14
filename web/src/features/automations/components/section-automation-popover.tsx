import {
  AUTOMATION_STATE_COLOR,
  AutomationRuleStatus,
  TRIGGER_LABEL,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, LibraryBig, Plus, Settings2, Zap } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatRelativeTime } from '@/lib/utils';

import type { AutomationRule } from '../api/automations.api';
import { useSectionAutomations } from '../hooks/use-automations';

import { RuleLibraryDialog } from './rule-library-dialog';

/**
 * What the lightning icon is telling you, worst state first.
 *
 * Colour alone never carries this — the icon's `aria-label` and the popover
 * both say it in words, because "amber vs blue at 14px" is not a distinction
 * everyone can make.
 */
function summarise(rules: AutomationRule[]): {
  tone: 'none' | 'idle' | 'active' | 'warning' | 'failing';
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

  if (active > 0) {
    return { tone: 'active', label: `${active} active rule${active === 1 ? '' : 's'}` };
  }

  // Drafts only. Still the section's rules — they are listed and the icon
  // stays — but nothing is running, and the label should not suggest it is.
  return {
    tone: 'idle',
    label: `${rules.length} rule${rules.length === 1 ? '' : 's'}, none active yet`,
  };
}

const TONE_CLASS: Record<string, string> = {
  none: 'text-muted-foreground',
  idle: 'text-muted-foreground',
  active: 'text-[color:var(--color-primary)]',
  warning: 'text-amber-500',
  failing: 'text-destructive',
};

/**
 * The rules that belong under one board or list section.
 *
 * Asana's section lightning, and it behaves the same way: a section with rules
 * shows the icon all the time, in the colour of how the rules are doing, and a
 * section without any shows it only on hover, where "Add rule" lives. That
 * needs the answer before anybody clicks — so the rules come from the
 * project's one rule query rather than a request made when the popover opens,
 * which is what left every lightning grey until it was clicked.
 *
 * Which rules are the section's is `rulesForSection`'s answer, the same the
 * endpoint gives: scoped by the trigger, or by a "Section is…" check — so a rule
 * started from this menu stays here after its trigger is changed.
 *
 * The hover reveal relies on a `group` class on the header that renders this.
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
  /*
   * Held here rather than inside the popover: the dialog has to outlive the
   * menu that opened it, and anything rendered under `PopoverContent` goes
   * when the popover closes.
   */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const { workspace } = useActiveWorkspace();
  const canManage = hasAtLeastRole(
    (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole,
    WorkspaceRole.MANAGER,
  );

  const { data: rules, isLoading } = useSectionAutomations(workspace?.id, projectId, sectionId);

  const summary = summarise(rules ?? []);
  const hasRules = (rules ?? []).length > 0;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'size-7',
              /*
               * A section with nothing on it keeps its lightning for the hover,
               * as Asana does — a row of grey bolts says every section has rules
               * when none does. Opacity rather than mounting on hover so the
               * control stays in the tab order and a keyboard can still find it.
               */
              !hasRules &&
                'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
            )}
            // The state is in the name, not only the colour.
            aria-label={`Automations for ${sectionName} - ${summary.label}`}
            title={summary.label}
          >
            <Zap
              className={cn('size-4', TONE_CLASS[summary.tone])}
              // Filled once the section has rules, the way Asana marks one.
              fill={hasRules ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
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
            ) : !hasRules ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No rules on this section yet.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {(rules ?? []).map((rule) => (
                  <li key={rule.id} className="rounded-md px-2 py-1.5 hover:bg-muted">
                    {canManage ? (
                      <Link
                        to="/projects/$projectId/automations/$ruleId"
                        params={{ projectId, ruleId: rule.id }}
                        className="block truncate text-sm font-medium hover:underline"
                        onClick={() => setOpen(false)}
                      >
                        {rule.name}
                      </Link>
                    ) : (
                      <p className="truncate text-sm font-medium">{rule.name}</p>
                    )}
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
            {canManage && (
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
            )}

            {/* The same section, carried into a template: one that watches a
              section watches this one. The menu closes first so the dialog
              is the only thing open. */}
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 justify-start"
                onClick={() => {
                  setOpen(false);
                  setLibraryOpen(true);
                }}
              >
                <LibraryBig className="size-4" aria-hidden="true" />
                From library
              </Button>
            )}

            <Button asChild variant="ghost" size="sm" className="flex-1 justify-start">
              <Link to="/projects/$projectId/automations" params={{ projectId }}>
                <Settings2 className="size-4" aria-hidden="true" />
                Manage all
              </Link>
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <RuleLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        workspaceId={workspace?.id}
        projectId={projectId}
        canManage={canManage}
        sectionId={sectionId}
        sectionName={sectionName}
      />
    </>
  );
}
