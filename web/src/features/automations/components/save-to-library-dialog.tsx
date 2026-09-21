import { BookmarkPlus } from 'lucide-react';
import { useState } from 'react';

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { useSaveTemplate, useUpdateTemplate } from '../hooks/use-automation-templates';
import { describeReferences, type RuleReference } from '../lib/template-references';

/**
 * What the form is about: a rule going into the library, or a template already
 * in it being renamed. One dialog for both because the fields are the same and
 * so is the question — what should this be called where other projects see it?
 */
export type LibraryTarget =
  | {
      kind: 'rule';
      projectId: string;
      ruleId: string;
      name: string;
      description: string | null;
      /** What the rule names in this project, so the form can offer to blank it. */
      references?: RuleReference[];
    }
  | { kind: 'template'; templateId: string; name: string; description: string | null };

export function SaveToLibraryDialog({
  workspaceId,
  target,
  onOpenChange,
}: {
  workspaceId: string | undefined;
  /** Null when closed. */
  target: LibraryTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/*
          Keyed on the target so the fields start from *this* rule's name.

          Kept as inner state rather than derived on every render: the person
          typing owns the field from the first keystroke, and a rename that
          re-read the rule's name mid-edit would overwrite what they typed.
        */}
        {target && (
          <LibraryForm
            key={target.kind === 'rule' ? `rule:${target.ruleId}` : `template:${target.templateId}`}
            workspaceId={workspaceId}
            target={target}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LibraryForm({
  workspaceId,
  target,
  onDone,
}: {
  workspaceId: string | undefined;
  target: LibraryTarget;
  onDone: () => void;
}) {
  const [name, setName] = useState(target.name);
  const [description, setDescription] = useState(target.description ?? '');
  /*
   * Whether the template keeps this project's answers or asks for its own.
   *
   * Defaults to keeping them: a template applied where the same names exist
   * — most sibling projects — then lands complete, and the blanks only appear
   * where they must. Blanking is the choice for a rule meant as a shape.
   */
  const [clearReferences, setClearReferences] = useState(false);
  const references = target.kind === 'rule' ? (target.references ?? []) : [];

  const save = useSaveTemplate(workspaceId);
  const update = useUpdateTemplate(workspaceId);
  const pending = save.isPending || update.isPending;
  const trimmed = name.trim();

  const submit = () => {
    if (trimmed === '' || pending) return;

    const fields = { name: trimmed, description: description.trim() };
    const options = { onSuccess: onDone };

    if (target.kind === 'rule') {
      save.mutate(
        {
          projectId: target.projectId,
          ruleId: target.ruleId,
          ...fields,
          ...(references.length > 0 ? { clearReferences } : {}),
        },
        options,
      );
    } else {
      update.mutate({ templateId: target.templateId, ...fields }, options);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <BookmarkPlus className="size-4 text-primary" aria-hidden="true" />
          {target.kind === 'rule' ? 'Save to the rule library' : 'Edit template'}
        </DialogTitle>
        <DialogDescription>
          {target.kind === 'rule'
            ? 'A copy of this rule as it is now, for any project in this workspace to start from. Changing the rule later does not change the template.'
            : 'The name and description other projects see in the library.'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="library-template-name">Template name</Label>
        <Input
          id="library-template-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          autoFocus
          aria-invalid={trimmed === ''}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="library-template-description">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="library-template-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="When to use it, and what it expects the project to have."
        />
      </div>

      {references.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">When another project uses it</legend>
          <p className="text-xs text-muted-foreground">
            This rule names {describeReferences(references)}.
          </p>

          <ReferenceChoice
            checked={!clearReferences}
            onChoose={() => setClearReferences(false)}
            title="Keep them"
            detail="Matched by name in the other project, and left blank only where there is no match."
          />
          <ReferenceChoice
            checked={clearReferences}
            onChoose={() => setClearReferences(true)}
            title="Leave them blank"
            detail="The template asks for its own section, status or field wherever it is used."
          />
        </fieldset>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={trimmed === '' || pending}>
          {target.kind === 'rule' ? 'Save to library' : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * One of the two answers, as a row with a radio.
 *
 * A native radio inside its label rather than a select: there are two answers,
 * both need a sentence of explanation, and a control that shows both at once is
 * the only one that lets somebody read the difference before choosing.
 */
function ReferenceChoice({
  checked,
  onChoose,
  title,
  detail,
}: {
  checked: boolean;
  onChoose: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors',
        checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
      )}
    >
      <input
        type="radio"
        name="library-references"
        checked={checked}
        onChange={onChoose}
        className="mt-0.5 size-4 shrink-0 accent-[color:var(--color-primary)]"
      />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
