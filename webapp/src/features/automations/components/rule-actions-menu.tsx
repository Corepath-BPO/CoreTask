import { AutomationRuleStatus } from '@coretask/contracts';
import {
  BookmarkPlus,
  Copy,
  History,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
  Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import type { AutomationRule } from '../api/automations.api';
import type { RuleActions } from '../hooks/use-rule-actions';

/** A rule's ⋯ menu. The list decides where the button sits and when it shows. */
export function RuleActionsMenu({
  rule,
  actions,
  className,
}: {
  rule: AutomationRule;
  actions: RuleActions;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-7', className)}
          aria-label={`Actions for ${rule.name}`}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => actions.edit(rule)}>
          <Pencil className="size-4" aria-hidden="true" />
          Edit rule
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.showHistory(rule)}>
          <History className="size-4" aria-hidden="true" />
          Run history
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {rule.status === AutomationRuleStatus.DRAFT && (
          <DropdownMenuItem onSelect={() => actions.publish(rule)}>
            <Upload className="size-4" aria-hidden="true" />
            Publish
          </DropdownMenuItem>
        )}
        {rule.status === AutomationRuleStatus.ACTIVE && (
          <DropdownMenuItem onSelect={() => actions.pause(rule)}>
            <Pause className="size-4" aria-hidden="true" />
            Pause
          </DropdownMenuItem>
        )}
        {rule.status === AutomationRuleStatus.PAUSED && (
          <DropdownMenuItem onSelect={() => actions.resume(rule)}>
            <Play className="size-4" aria-hidden="true" />
            Resume
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => actions.duplicate(rule)}>
          <Copy className="size-4" aria-hidden="true" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.saveToLibrary(rule)}>
          <BookmarkPlus className="size-4" aria-hidden="true" />
          Save to library
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(rule)}>
          <Trash2 className="size-4" aria-hidden="true" />
          {/* Named for what actually happens, which depends on whether the
              rule has ever run. */}
          {rule.runCount > 0 ? 'Archive' : 'Delete'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
