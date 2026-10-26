import {
  FORM_CHOICE_KINDS,
  FORM_DESCRIPTION_MAX,
  FORM_NAME_MAX,
  FORM_OPTION_MAX,
  FORM_QUESTION_KINDS,
  FORM_QUESTION_KIND_LABEL,
  FORM_QUESTION_LABEL_MAX,
  FormQuestionKind,
  MAX_FORM_OPTIONS,
  MAX_FORM_QUESTIONS,
} from '@coretask/contracts';
import type { FormQuestion, ProjectForm, ProjectFormDraft } from '@coretask/types';
import { ClipboardList, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { CopyButton } from '@/components/common/copy-button';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { formLink, useDeleteForm, useProjectForms, useSaveForm } from '../../hooks/use-forms';
import { useProject } from '../../hooks/use-projects';

const FIRST_SECTION = 'FIRST_SECTION';

const newQuestion = (): FormQuestion => ({
  id: crypto.randomUUID(),
  label: '',
  kind: FormQuestionKind.SHORT_TEXT,
  required: false,
});

/**
 * Customize › Forms: intake forms anyone with the link can fill in.
 *
 * Every submission becomes a task in the project — a tenant's maintenance
 * request lands as work in the right section rather than as an email someone
 * has to retype. Each form asks for a title and details, then its own
 * questions; the answers are written into the task's description.
 */
export function CustomizeFormsSection({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string | undefined;
  projectId: string;
  canEdit: boolean;
}) {
  const { data: forms, isLoading } = useProjectForms(canEdit ? workspaceId : undefined, projectId);
  const save = useSaveForm(workspaceId, projectId);
  const remove = useDeleteForm(workspaceId, projectId);
  const [editing, setEditing] = useState<ProjectForm | 'new' | null>(null);

  if (!canEdit) {
    return (
      <p className="text-sm text-muted-foreground">
        Forms turn responses into tasks in this project. Ask a project editor for a form’s link.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Share a link; every response becomes a task in this project.
      </p>

      <Button size="sm" onClick={() => setEditing('new')}>
        <Plus />
        New form
      </Button>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !forms || forms.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
          <ClipboardList className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No forms yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {forms.map((form) => (
            <li key={form.id} className="space-y-2 rounded-lg border px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{form.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {form.submissionCount === 0
                      ? 'No responses yet'
                      : `${form.submissionCount} response${form.submissionCount === 1 ? '' : 's'}`}
                    {form.questions.length > 0 &&
                      ` · ${form.questions.length} question${form.questions.length === 1 ? '' : 's'}`}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {form.isActive ? 'Taking responses' : 'Closed'}
                  <Switch
                    checked={form.isActive}
                    disabled={save.isPending}
                    aria-label={`Take responses on ${form.name}`}
                    onCheckedChange={(isActive) =>
                      save.mutate({ formId: form.id, draft: { isActive } })
                    }
                  />
                </label>
              </div>
              <div className="flex items-center gap-1">
                <CopyButton
                  value={formLink(form.token)}
                  label={`Copy the link to ${form.name}`}
                  successMessage="Form link copied"
                  size="sm"
                />
                <Button asChild size="sm" variant="ghost">
                  <a href={formLink(form.token)} target="_blank" rel="noreferrer">
                    <ExternalLink />
                    Open
                  </a>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(form)}>
                  Edit
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete the form ${form.name}`}
                  className="ml-auto"
                  onClick={() => remove.mutate(form.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'New form' : 'Edit form'}</DialogTitle>
            <DialogDescription>
              Every form asks for a title and details; add the questions this one needs.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <FormEditor
              workspaceId={workspaceId}
              projectId={projectId}
              form={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FormEditor({
  workspaceId,
  projectId,
  form,
  onDone,
}: {
  workspaceId: string | undefined;
  projectId: string;
  form: ProjectForm | null;
  onDone: () => void;
}) {
  const save = useSaveForm(workspaceId, projectId);
  const { data: project } = useProject(workspaceId, projectId);

  const [name, setName] = useState(form?.name ?? '');
  const [description, setDescription] = useState(form?.description ?? '');
  const [sectionId, setSectionId] = useState(form?.sectionId ?? FIRST_SECTION);
  const [questions, setQuestions] = useState<FormQuestion[]>(form?.questions ?? []);

  // A question added by the button takes the caret, so typing lands in it.
  const [focusNew, setFocusNew] = useState(false);

  const ready = name.trim() !== '' && !save.isPending;

  const change = (index: number, patch: Partial<FormQuestion>) =>
    setQuestions((current) =>
      current.map((question, at) => (at === index ? { ...question, ...patch } : question)),
    );

  const submit = () => {
    if (!ready) return;
    const draft: ProjectFormDraft = {
      name: name.trim(),
      description: description.trim() || null,
      sectionId: sectionId === FIRST_SECTION ? null : sectionId,
      questions: questions
        .map((question) => ({ ...question, label: question.label.trim() }))
        .filter((question) => question.label !== ''),
    };
    save.mutate({ ...(form ? { formId: form.id } : {}), draft }, { onSuccess: onDone });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field label="Form name" htmlFor="form-name">
        <Input
          id="form-name"
          value={name}
          maxLength={FORM_NAME_MAX}
          placeholder="e.g. Maintenance request"
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Description" htmlFor="form-description">
        <Textarea
          id="form-description"
          rows={2}
          value={description}
          maxLength={FORM_DESCRIPTION_MAX}
          placeholder="What submitters see above the questions"
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field label="Add responses to" htmlFor="form-section">
        <Select
          value={sectionId}
          onValueChange={(next) => {
            // '' arrives while the project's sections load; keep what was chosen.
            if (next) setSectionId(next);
          }}
        >
          <SelectTrigger id="form-section" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FIRST_SECTION}>The first section</SelectItem>
            {(project?.sections ?? []).map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">Questions</p>
        {questions.map((question, index) => (
          <div key={question.id} className="space-y-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Question ${index + 1}`}
                autoFocus={focusNew && index === questions.length - 1}
                value={question.label}
                maxLength={FORM_QUESTION_LABEL_MAX}
                placeholder="e.g. Unit number"
                onChange={(event) => change(index, { label: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove question ${index + 1}`}
                onClick={() => setQuestions((current) => current.filter((_, at) => at !== index))}
              >
                <X />
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Select
                value={question.kind}
                onValueChange={(kind) => {
                  // Radix sends '' when its options change; that is not a choice.
                  if (kind) change(index, { kind: kind as FormQuestionKind });
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={`Answer type for question ${index + 1}`}
                  className="w-40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORM_QUESTION_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {FORM_QUESTION_KIND_LABEL[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={question.required}
                  onCheckedChange={(checked) => change(index, { required: checked === true })}
                />
                Required
              </label>
            </div>
            {FORM_CHOICE_KINDS.includes(question.kind) && (
              <Textarea
                rows={3}
                aria-label={`Options for question ${index + 1}`}
                placeholder={'One option per line\ne.g. Plumbing\nElectrical'}
                value={(question.options ?? []).join('\n')}
                onChange={(event) =>
                  change(index, {
                    options: event.target.value
                      .split('\n')
                      .slice(0, MAX_FORM_OPTIONS)
                      .map((line) => line.slice(0, FORM_OPTION_MAX)),
                  })
                }
              />
            )}
          </div>
        ))}
        {questions.length < MAX_FORM_QUESTIONS && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFocusNew(true);
              setQuestions((current) => [...current, newQuestion()]);
            }}
          >
            <Plus />
            Add question
          </Button>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready}>
          Save form
        </Button>
      </DialogFooter>
    </form>
  );
}
