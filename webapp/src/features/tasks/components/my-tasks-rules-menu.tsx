import { ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';

import { useMyTasksRules, useSetMyTasksRules } from '../hooks/use-my-task-placements';

/**
 * My Tasks' auto-sort — Asana's auto-promote rules: what moves itself into
 * Do today and Do next week as its due date comes up. A task moved by hand
 * today stays put until tomorrow.
 */
export function MyTasksRulesMenu({ workspaceId }: { workspaceId: string }) {
  const { data: rules } = useMyTasksRules(workspaceId);
  const setRules = useSetMyTasksRules(workspaceId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <ListChecks />
          Auto-sort
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-medium">Auto-sort My Tasks</p>
          <p className="text-xs text-muted-foreground">
            Tasks move themselves as their due dates come up. One you moved by hand today stays
            where you put it.
          </p>
        </div>
        <label className="flex items-start justify-between gap-3 text-sm">
          <span>
            Move tasks due today, or overdue, to <strong>Do today</strong>
          </span>
          <Switch
            aria-label="Move tasks due today to Do today"
            checked={rules?.dueToday ?? true}
            onCheckedChange={(dueToday) => setRules.mutate({ dueToday })}
          />
        </label>
        <label className="flex items-start justify-between gap-3 text-sm">
          <span>
            Move tasks due in the next 7 days to <strong>Do next week</strong>
          </span>
          <Switch
            aria-label="Move tasks due this week to Do next week"
            checked={rules?.dueThisWeek ?? false}
            onCheckedChange={(dueThisWeek) => setRules.mutate({ dueThisWeek })}
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}
