import { CustomFieldType } from '@coretask/contracts';
import type { TaskOtherFieldValue } from '@coretask/types';
import { ChevronRight } from 'lucide-react';

import { FieldTypeIcon } from '@/features/projects/components/field-picker/field-type-icon';
import { useTaskOtherFields } from '@/features/projects/hooks/use-project-views';
import { formatDate } from '@/lib/utils/format';

interface TaskOtherFieldsProps {
  workspaceId: string | undefined;
  taskId: string;
}

/**
 * Values the task holds for fields none of its projects shows, collapsed
 * under the project's own. Asana keeps a field's value on a task that moved
 * on from the project it came from; this keeps those visible here without
 * making them columns of a project that never used them. Read only.
 */
export function TaskOtherFields({ workspaceId, taskId }: TaskOtherFieldsProps) {
  const { data: others = [] } = useTaskOtherFields(workspaceId, taskId);
  if (others.length === 0) return null;

  return (
    <details className="group rounded-md border border-border/60">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight
          className="size-3.5 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        Fields from other projects ({others.length})
      </summary>
      <dl className="divide-y divide-border/60 border-t border-border/60">
        {others.map((entry) => (
          <div key={entry.field.id} className="flex items-start gap-3 px-3 py-1.5 text-sm">
            <dt className="flex w-44 shrink-0 items-center gap-2 text-muted-foreground">
              <FieldTypeIcon type={entry.field.type} className="size-3.5 shrink-0" />
              <span className="truncate" title={entry.field.name}>
                {entry.field.name}
              </span>
            </dt>
            <dd className="min-w-0 break-words">{display(entry)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function display(entry: TaskOtherFieldValue): string {
  if (entry.field.type === CustomFieldType.DATE) {
    return formatDate(entry.label, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return entry.label;
}
