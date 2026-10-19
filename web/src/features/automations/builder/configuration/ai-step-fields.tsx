import {
  AI_FIELD_TYPES,
  AI_INSTRUCTIONS_MAX,
  AI_PERMISSION_LABEL,
  AI_PERMISSIONS,
  AI_QUESTION_MAX,
  aiActionProblem,
  aiCheckProblem,
  aiFieldPermission,
  aiPermissionsOf,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';

import { Field } from '@/components/forms/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

type Configure = (configuration: Record<string, unknown>) => void;

/**
 * "Use AI…": what to do, and what AI may change to do it.
 *
 * The ticks are the whole of what the model is offered — it is never shown a
 * change it may not make — and each tick it is offered picks from this
 * project's own sections, statuses, people or options rather than typing a
 * value. Custom fields are offered one by one, the kinds AI can fill in only.
 */
export function AiActionFields({
  configuration,
  metadata,
  onChange,
}: {
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: Configure;
}) {
  const allowed = aiPermissionsOf(configuration);
  const instructions =
    typeof configuration['instructions'] === 'string' ? configuration['instructions'] : '';
  const problem = aiActionProblem(configuration);
  const fields = (metadata?.customFields ?? []).filter((field) =>
    (AI_FIELD_TYPES as readonly string[]).includes(field.type),
  );

  const toggle = (permission: string, on: boolean) =>
    onChange({
      ...configuration,
      allow: on ? [...allowed, permission] : allowed.filter((entry) => entry !== permission),
    });

  const box = (permission: string, label: string) => (
    <label key={permission} className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox
        checked={allowed.includes(permission)}
        onCheckedChange={(checked) => toggle(permission, checked === true)}
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-4">
      <Field
        label="Instructions"
        htmlFor="step-ai-instructions"
        error={
          instructions !== '' && problem && !problem.startsWith('Choose') ? problem : undefined
        }
      >
        <Textarea
          id="step-ai-instructions"
          value={instructions}
          maxLength={AI_INSTRUCTIONS_MAX}
          rows={5}
          placeholder="e.g. Read the request. If it is about a repair, set Request type to Repair, make it urgent when something is broken, and comment with what the tenant needs."
          onChange={(event) => onChange({ ...configuration, instructions: event.target.value })}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">AI may</legend>
        {AI_PERMISSIONS.map((permission) => box(permission, AI_PERMISSION_LABEL[permission]))}
        {fields.map((field) => box(aiFieldPermission(field.id), `Fill in ${field.name}`))}
        {allowed.length === 0 && (
          <p className="text-xs text-destructive">Choose at least one thing AI may change.</p>
        )}
      </fieldset>

      <p className="text-xs text-muted-foreground">
        AI reads the task — its fields, description, subtasks and recent comments — and makes only
        the changes ticked here. The rule’s history says what it changed and why.
      </p>
    </div>
  );
}

/** "Check with AI": a yes-or-no question about the task. */
export function AiCheckFields({
  configuration,
  onChange,
}: {
  configuration: Record<string, unknown>;
  onChange: Configure;
}) {
  const question = typeof configuration['question'] === 'string' ? configuration['question'] : '';
  const problem = question === '' ? null : aiCheckProblem(configuration);

  return (
    <div className="space-y-4">
      <Field label="Question" htmlFor="step-ai-question" error={problem ?? undefined}>
        <Textarea
          id="step-ai-question"
          value={question}
          maxLength={AI_QUESTION_MAX}
          rows={3}
          placeholder="e.g. Is the tenant reporting something broken?"
          onChange={(event) => onChange({ ...configuration, question: event.target.value })}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        The rule goes on only if AI answers yes. When the task doesn’t say enough to be sure, it
        answers no.
      </p>
    </div>
  );
}
