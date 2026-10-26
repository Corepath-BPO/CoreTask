import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_VALUES,
  STATUS_TEMPLATE_NAME_MAX,
  STATUS_UPDATE_TEXT_MAX,
  type ProjectStatusValue,
} from '@coretask/contracts';
import type { StatusTemplate, StatusTemplateDraft } from '@coretask/types';
import { CircleDot, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

import {
  useDeleteStatusTemplate,
  useSaveStatusTemplate,
  useStatusTemplates,
} from '../../hooks/use-status-templates';

const KEEP_STATUS = 'KEEP';

/**
 * Customize › Status templates: where a status update starts.
 *
 * The composer's "Use a template" menu fills the status, Summary and Next
 * steps from one of these — the weekly update a team writes in the same shape
 * every Friday, without retyping the headings.
 */
export function CustomizeStatusTemplatesSection({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string | undefined;
  projectId: string;
  canEdit: boolean;
}) {
  const { data: templates, isLoading } = useStatusTemplates(workspaceId, projectId);
  const remove = useDeleteStatusTemplate(workspaceId, projectId);
  const [editing, setEditing] = useState<StatusTemplate | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Starting points for a status update, offered under “Use a template” when someone sets the
        project’s status.
      </p>

      {canEdit && (
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus />
          New template
        </Button>
      )}

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !templates || templates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
          <CircleDot className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No status templates yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {templates.map((template) => (
            <li key={template.id} className="space-y-2 rounded-lg border px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{template.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {template.summary ?? template.nextSteps ?? 'No text yet'}
                  </p>
                </div>
                {template.status && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {PROJECT_STATUS_LABEL[template.status]}
                  </Badge>
                )}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(template)}>
                    Edit
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete the status template ${template.name}`}
                    className="ml-auto"
                    onClick={() => remove.mutate(template.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing === 'new' ? 'New status template' : 'Edit status template'}
            </DialogTitle>
            <DialogDescription>
              What the status update starts with. Its author can change any of it before posting.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <StatusTemplateForm
              workspaceId={workspaceId}
              projectId={projectId}
              template={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusTemplateForm({
  workspaceId,
  projectId,
  template,
  onDone,
}: {
  workspaceId: string | undefined;
  projectId: string;
  template: StatusTemplate | null;
  onDone: () => void;
}) {
  const save = useSaveStatusTemplate(workspaceId, projectId);
  const [name, setName] = useState(template?.name ?? '');
  const [status, setStatus] = useState<string>(template?.status ?? KEEP_STATUS);
  const [summary, setSummary] = useState(template?.summary ?? '');
  const [nextSteps, setNextSteps] = useState(template?.nextSteps ?? '');

  const ready = name.trim() !== '' && !save.isPending;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        const draft: StatusTemplateDraft = {
          name: name.trim(),
          status: status === KEEP_STATUS ? null : (status as ProjectStatusValue),
          summary: summary.trim() || null,
          nextSteps: nextSteps.trim() || null,
        };
        save.mutate(
          { ...(template ? { templateId: template.id } : {}), draft },
          { onSuccess: onDone },
        );
      }}
    >
      <Field label="Template name" htmlFor="status-template-name">
        <Input
          id="status-template-name"
          value={name}
          maxLength={STATUS_TEMPLATE_NAME_MAX}
          placeholder="e.g. Weekly update"
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Start on status" htmlFor="status-template-status">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger id="status-template-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={KEEP_STATUS}>Whatever was picked</SelectItem>
            {PROJECT_STATUS_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {PROJECT_STATUS_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Summary" htmlFor="status-template-summary">
        <Textarea
          id="status-template-summary"
          rows={4}
          value={summary}
          maxLength={STATUS_UPDATE_TEXT_MAX}
          placeholder={'What we finished:\n- \n\nWhat is blocked:\n- '}
          onChange={(event) => setSummary(event.target.value)}
        />
      </Field>
      <Field label="Next steps" htmlFor="status-template-next">
        <Textarea
          id="status-template-next"
          rows={3}
          value={nextSteps}
          maxLength={STATUS_UPDATE_TEXT_MAX}
          onChange={(event) => setNextSteps(event.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready}>
          Save template
        </Button>
      </DialogFooter>
    </form>
  );
}
