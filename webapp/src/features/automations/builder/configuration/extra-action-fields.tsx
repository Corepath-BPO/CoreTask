import {
  AUTOMATION_EMAIL_RECIPIENT_LABEL,
  AUTOMATION_TEXT_VARIABLES,
  AutomationEmailRecipient,
  emailRecipientsOf,
  variableToken,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';
import { Braces } from 'lucide-react';
import { useRef } from 'react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { assignablePeople } from '@/features/tasks/lib/assignable';

import { RadioItem } from './radio-item';
import { MultiSelect } from './value-controls';

type Configure = (configuration: Record<string, unknown>) => void;

/** A Radix select cannot hold "" on an item, so "nothing chosen" gets a token. */
const NONE = 'NONE';

/**
 * Text a rule writes, with a menu that inserts variables at the cursor.
 *
 * The variables are written as `{{task.name}}` so the text stays readable in
 * the box; the menu is there so nobody has to remember the spelling.
 */
export function VariableTextField({
  id,
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const insert = (token: string) => {
    const element = input.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));

    // Back to the box, just after what was inserted, once React has written it.
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const shared = {
    id,
    ref: input,
    value,
    placeholder,
    onChange: (event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
      onChange(event.target.value),
  };

  return (
    <Field label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <div className="space-y-1.5">
        {multiline ? <Textarea rows={4} {...shared} /> : <Input {...shared} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <Braces className="mr-1 size-3.5" aria-hidden="true" />
              Insert variable
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs">Filled in when the rule runs</DropdownMenuLabel>
            {AUTOMATION_TEXT_VARIABLES.map((variable) => (
              <DropdownMenuItem
                key={variable.key}
                onSelect={() => insert(variableToken(variable.key))}
              >
                {variable.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Field>
  );
}

/** "Change completion status to…": complete or incomplete. */
export function CompletionFields({
  configuration,
  onChange,
}: {
  configuration: Record<string, unknown>;
  onChange: Configure;
}) {
  const complete = configuration['completed'] !== false;

  return (
    <Field
      label="Completion status"
      htmlFor="step-completed"
      hint="Uses the project’s Done status, or its first open one to reopen."
    >
      <Select
        value={complete ? 'COMPLETE' : 'INCOMPLETE'}
        onValueChange={(value) => onChange({ ...configuration, completed: value === 'COMPLETE' })}
      >
        <SelectTrigger id="step-completed" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <RadioItem value="COMPLETE">Complete</RadioItem>
          <RadioItem value="INCOMPLETE">Incomplete</RadioItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

/** "Create a task…": a name, and optionally where it goes and who has it. */
export function CreateTaskFields({
  configuration,
  metadata,
  onChange,
}: {
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: Configure;
}) {
  const text = (key: string) =>
    typeof configuration[key] === 'string' ? (configuration[key] as string) : '';
  const set = (key: string, value: unknown) => onChange({ ...configuration, [key]: value });

  return (
    <div className="space-y-4">
      <VariableTextField
        id="step-title"
        label="Task name"
        value={text('title')}
        onChange={(value) => set('title', value)}
        placeholder="e.g. Follow up on {{task.name}}"
      />

      <Field label="Section" htmlFor="step-create-section" hint="Left empty, the first section.">
        <Select
          value={text('sectionId') || NONE}
          onValueChange={(value) => set('sectionId', value === NONE ? undefined : value)}
        >
          <SelectTrigger id="step-create-section" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <RadioItem value={NONE}>The first section</RadioItem>
            {(metadata?.sections ?? []).map((section) => (
              <RadioItem key={section.id} value={section.id}>
                {section.name}
              </RadioItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Assignee" htmlFor="step-create-assignee">
        <Select
          value={text('assigneeId') || NONE}
          onValueChange={(value) => set('assigneeId', value === NONE ? undefined : value)}
        >
          <SelectTrigger id="step-create-assignee" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <RadioItem value={NONE}>Nobody</RadioItem>
            {/* The project's members and the owner, and whoever is named already. */}
            {assignablePeople(
              metadata?.assignees,
              metadata?.members,
              metadata?.members.find((member) => member.id === text('assigneeId')),
            ).map((member) => (
              <RadioItem key={member.id} value={member.id}>
                {member.name}
              </RadioItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="Due in (days)"
        htmlFor="step-create-due"
        hint="0 is the day the rule runs. Left empty, no due date."
      >
        <Input
          id="step-create-due"
          type="number"
          min={0}
          step={1}
          value={
            typeof configuration['dueInDays'] === 'number' ? String(configuration['dueInDays']) : ''
          }
          onChange={(event) =>
            set(
              'dueInDays',
              event.target.value === '' ? undefined : Math.trunc(Number(event.target.value)),
            )
          }
        />
      </Field>

      <VariableTextField
        id="step-create-description"
        label="Description"
        value={text('description')}
        onChange={(value) => set('description', value || undefined)}
        multiline
      />
    </div>
  );
}

/** "Add or remove collaborators": who joins the task, and who leaves it. */
export function CollaboratorFields({
  configuration,
  metadata,
  onChange,
}: {
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: Configure;
}) {
  const people = (key: string) =>
    Array.isArray(configuration[key])
      ? (configuration[key] as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
  const options = (metadata?.members ?? []).map((member) => ({
    value: member.id,
    label: member.name,
    avatarUrl: member.avatarUrl,
  }));

  return (
    <div className="space-y-4">
      <Field label="Add" htmlFor="step-collaborators-add">
        <MultiSelect
          id="step-collaborators-add"
          options={options}
          values={people('add')}
          onChange={(add) => onChange({ ...configuration, add })}
          placeholder="Choose people to add"
        />
      </Field>
      <Field label="Remove" htmlFor="step-collaborators-remove">
        <MultiSelect
          id="step-collaborators-remove"
          options={options}
          values={people('remove')}
          onChange={(remove) => onChange({ ...configuration, remove })}
          placeholder="Choose people to remove"
        />
      </Field>
    </div>
  );
}

/**
 * "Send an email": who hears, and what it says. Only people on the task —
 * the assignee, its collaborators, whoever made it — never a typed address.
 */
export function SendEmailFields({
  configuration,
  onChange,
}: {
  configuration: Record<string, unknown>;
  onChange: Configure;
}) {
  const recipients = emailRecipientsOf(configuration);
  const text = (key: string) =>
    typeof configuration[key] === 'string' ? (configuration[key] as string) : '';
  const toggle = (recipient: AutomationEmailRecipient, on: boolean) =>
    onChange({
      ...configuration,
      recipients: on
        ? [...recipients, recipient]
        : recipients.filter((entry) => entry !== recipient),
    });

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Send to</legend>
        {Object.values(AutomationEmailRecipient).map((recipient) => (
          <label key={recipient} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={recipients.includes(recipient)}
              onCheckedChange={(checked) => toggle(recipient, checked === true)}
            />
            {AUTOMATION_EMAIL_RECIPIENT_LABEL[recipient]}
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          Only people in the workspace receive it, with a link to the task.
        </p>
      </fieldset>
      <VariableTextField
        id="step-email-subject"
        label="Subject"
        value={text('subject')}
        onChange={(subject) => onChange({ ...configuration, subject })}
        placeholder="About {{task.name}}"
      />
      <VariableTextField
        id="step-email-body"
        label="Message"
        multiline
        value={text('body')}
        onChange={(body) => onChange({ ...configuration, body })}
      />
    </div>
  );
}
