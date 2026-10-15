import {
  AUTOMATION_VALUE_TOKEN_LABEL,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  isDateTrigger,
  isTokenValue,
  tokensForFieldType,
  AUTOMATION_DELAY_UNITS,
  AUTOMATION_DELAY_UNIT_LABEL,
  AutomationDelayUnit,
  delayProblem,
  AI_CHECK_FIELD,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';
import { ChevronDown, X } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn, humanizeEnum } from '@/lib/utils';

import type { CanvasNode } from '../lib/graph-edits';

import { AiActionFields, AiDraftUpdateFields, AiCheckFields } from './ai-step-fields';
import { ComparisonFields } from './comparison-fields';
import { ConditionStepFields } from './condition-group-fields';
import {
  applyTriggerForm,
  applyTriggerSections,
  formsForTrigger,
  readTriggerForm,
  readTriggerSections,
} from './trigger-forms';
import {
  CollaboratorFields,
  CompletionFields,
  CreateTaskFields,
  SendEmailFields,
  VariableTextField,
} from './extra-action-fields';
import { RadioItem } from './radio-item';
import { SendWebhookFields } from './send-webhook-fields';
import {
  DateTriggerFields,
  ManualTriggerFields,
  ScheduleTriggerFields,
} from './timed-trigger-fields';
import { ChecklistFields, TeamFields } from './team-and-checklist-fields';
import { SubtaskListFields } from './subtask-list-fields';
import { MultiSelect, OptionFace, type ChoiceOption } from './value-controls';

/*
 * Nothing chosen is an empty string, not a token.
 *
 * A sentinel like `__none__` matches no item, and a controlled Radix select
 * holding a value it cannot find renders blank — so every one of these showed
 * an empty box where its placeholder should have been, and a form that has not
 * been filled in looked like one that had been filled in with nothing.
 *
 * An empty string is what Radix reads as "no selection", which is exactly the
 * state being described, and it shows the placeholder.
 */

/**
 * "A specific date", as a value the select can hold.
 *
 * Not an empty string, which is what these selects use for "nothing chosen" —
 * picking a literal date *is* an answer, and an empty value would show the
 * placeholder as though the question were still open.
 */
const LITERAL_VALUE = 'LITERAL';

/**
 * The settings one step needs, and nothing else.
 *
 * No save button: every change is applied as it is made, the same way moving a
 * node on the canvas is. Nothing here reaches the database until the rule is
 * saved, so a second commit step would only be a chance to lose an edit by
 * clicking away — and the card behind the panel updating as you type is what
 * tells you the change landed.
 */
export function NodeConfigFields({
  node,
  metadata,
  subject = 'TASK',
  onChange,
}: {
  node: CanvasNode;
  metadata: AutomationMetadata | undefined;
  /** What the rule is about — which fields a condition group may ask about. */
  subject?: 'TASK' | 'TICKET';
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  if (node.type === 'TRIGGER') {
    return (
      <TriggerFields
        subtype={node.subtype}
        configuration={node.configuration}
        metadata={metadata}
        onChange={onChange}
      />
    );
  }

  // How long a Wait step waits.
  if (node.type === 'DELAY') {
    return <DelayFields configuration={node.configuration} onChange={onChange} />;
  }

  /* A branch holds the comparison that chooses its arm, so it is configured
     exactly as a condition is — one decision, one node. */
  if (
    (node.type === 'CONDITION' || node.type === 'BRANCH') &&
    node.configuration['field'] === AI_CHECK_FIELD
  ) {
    return <AiCheckFields configuration={node.configuration} onChange={onChange} />;
  }

  // A condition may grow into a group; a legacy split holds one comparison.
  if (node.type === 'CONDITION') {
    return (
      <ConditionStepFields
        configuration={node.configuration}
        metadata={metadata}
        subject={subject}
        onChange={onChange}
      />
    );
  }

  if (node.type === 'BRANCH') {
    return (
      <ComparisonFields
        configuration={node.configuration}
        metadata={metadata}
        onChange={onChange}
      />
    );
  }

  return (
    <ActionFields
      subtype={node.subtype}
      configuration={node.configuration}
      metadata={metadata}
      onChange={onChange}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* When                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How the event that starts a rule is narrowed.
 *
 * One question — "Choose an option" — and a second only when the answer needs
 * one. A move can be watched four ways and the difference between them is the
 * whole point of the panel: "any move", "into this one", "into anything but
 * this one", "into any of these". Offering a bare section picker, as this used
 * to, could express exactly the second of the four.
 */
function TriggerFields({
  subtype,
  configuration,
  metadata,
  onChange,
}: {
  subtype: string;
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const forms = formsForTrigger(subtype, metadata);
  const form = readTriggerForm(configuration, forms);

  // The triggers that are not edits each have their own few questions.
  if (subtype === 'RUN_MANUALLY') {
    return <ManualTriggerFields configuration={configuration} onChange={onChange} />;
  }
  if (subtype === 'SCHEDULED_TIME') {
    return (
      <ScheduleTriggerFields
        configuration={configuration}
        metadata={metadata}
        onChange={onChange}
      />
    );
  }
  if (isDateTrigger(subtype)) {
    return (
      <DateTriggerFields
        subtype={subtype}
        configuration={configuration}
        metadata={metadata}
        onChange={onChange}
      />
    );
  }

  // Any change of a ticket's status, or a change to one status.
  if (subtype === 'TICKET_STATUS_CHANGED') {
    return <TicketStatusTriggerFields configuration={configuration} onChange={onChange} />;
  }

  // Which field to watch — or every field, which is what no fieldId stores and
  // what every rule saved before the narrowing existed still means.
  if (subtype === 'CUSTOM_FIELD_CHANGED') {
    return (
      <CustomFieldTriggerFields
        configuration={configuration}
        metadata={metadata}
        onChange={onChange}
      />
    );
  }

  // Most triggers fire on the whole project. A form of disabled controls would
  // make somebody read it before finding out there was nothing to answer.
  if (forms.length === 0 || !form) {
    return (
      <p className="text-sm text-muted-foreground">
        This trigger fires for the whole project, so there is nothing to set.
      </p>
    );
  }

  const options: ChoiceOption[] = (metadata?.sections ?? []).map((section) => ({
    value: section.id,
    label: section.name,
  }));
  const chosen = readTriggerSections(configuration);

  const choose = (next: string) => {
    const picked = forms.find((entry) => entry.form === next);
    if (picked) onChange(applyTriggerForm(configuration, picked));
  };

  return (
    <>
      {/*
        All four are offered, and the unavailable ones say so once chosen.

        The convention everywhere else in this panel is disabled-with-a-reason,
        and here it would empty the panel of the thing it exists for: three of
        these four are the difference between "moved anywhere" and "moved out of
        review", and greying half of them leaves a control that can express only
        what a bare section picker already could. The reason is shown under the
        field instead, so nobody publishes a rule expecting the engine to run a
        form it cannot yet.
      */}
      <Field
        label="Choose an option"
        htmlFor="trigger-form"
        hint={form.available ? undefined : (form.reason ?? undefined)}
      >
        <Select value={form.form} onValueChange={choose}>
          <SelectTrigger id="trigger-form" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {forms.map((entry) => (
              <RadioItem key={entry.form} value={entry.form}>
                {entry.label}
              </RadioItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Only the forms that name a section ask for one; "Section is changed"
          watches every move and has nothing left to answer. */}
      {form.needsValue &&
        (form.multiple ? (
          /* The wording is the specification's, and it says "column/section"
             because a section is a board column and a list group depending on
             which view somebody came from — naming only one of them makes the
             field look like it belongs to the other view. */
          <Field label="Choose one or more options for column/section" htmlFor="trigger-sections">
            <MultiSelect
              id="trigger-sections"
              options={options}
              values={chosen}
              onChange={(next) => onChange(applyTriggerSections(configuration, form, next))}
              placeholder="Choose sections"
            />
          </Field>
        ) : (
          <Field label="Choose a column/section" htmlFor="trigger-section">
            <Select
              value={chosen[0] ?? ''}
              onValueChange={(next) => onChange(applyTriggerSections(configuration, form, [next]))}
            >
              <SelectTrigger id="trigger-section" className="w-full">
                <SelectValue placeholder="Choose a column/section" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <RadioItem key={option.value} value={option.value}>
                    {option.label}
                  </RadioItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ))}
    </>
  );
}

/*
 * A Radix select cannot hold `value=""` on an item, and "watch every field" is
 * an answer somebody must be able to give — so it gets a token of its own,
 * translated to an absent `fieldId` at the write.
 */
const ANY_FIELD = 'ANY';

/** Which custom field a CUSTOM_FIELD_CHANGED trigger watches, if not all. */
function CustomFieldTriggerFields({
  configuration,
  metadata,
  onChange,
}: {
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const fieldId = typeof configuration['fieldId'] === 'string' ? configuration['fieldId'] : '';

  return (
    <Field label="Field" htmlFor="trigger-field">
      <Select
        value={fieldId === '' ? ANY_FIELD : fieldId}
        onValueChange={(next) =>
          onChange({ ...configuration, fieldId: next === ANY_FIELD ? undefined : next })
        }
      >
        <SelectTrigger id="trigger-field" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <RadioItem value={ANY_FIELD}>Any custom field</RadioItem>
          {(metadata?.customFields ?? []).map((field) => (
            <RadioItem key={field.id} value={field.id}>
              {field.name}
            </RadioItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Do this                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What an action needs, chosen by its subtype.
 *
 * Only the fields that subtype actually uses. A form showing every possible
 * setting and disabling most of them makes somebody read the whole thing to
 * find the two that matter.
 */
function ActionFields({
  subtype,
  configuration,
  metadata,
  onChange,
}: {
  subtype: string;
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const read = (key: string): string => {
    const value = configuration[key];
    return typeof value === 'string' ? value : '';
  };

  const set = (key: string, value: unknown) => onChange({ ...configuration, [key]: value });

  // Numbers are stored as numbers — the runner does `Number(config.daysFromNow)`
  // and the validator checks the kind — and typed as text.
  const readNumber = (key: string): string => {
    const value = configuration[key];
    return typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  };
  const setNumber = (key: string, raw: string) =>
    onChange({ ...configuration, [key]: raw === '' ? undefined : Number(raw) });

  const picker = (
    key: string,
    label: string,
    options: { id: string; name: string; colorToken?: string }[] | undefined,
    placeholder: string,
  ) => (
    <Field label={label} htmlFor={`step-${key}`}>
      <Select value={read(key)} onValueChange={(value) => set(key, value)}>
        <SelectTrigger id={`step-${key}`} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {(options ?? []).map((option) => (
            <RadioItem key={option.id} value={option.id}>
              <OptionFace
                option={{
                  value: option.id,
                  label: option.name,
                  ...(option.colorToken ? { colorToken: option.colorToken } : {}),
                }}
              />
            </RadioItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  switch (subtype) {
    case 'ASSIGN_USER':
      return picker(
        'userId',
        'Assign to',
        metadata?.members.map((member) => ({ id: member.id, name: member.name })),
        'Choose somebody',
      );

    case 'MOVE_TO_SECTION':
      return picker('sectionId', 'Section', metadata?.sections, 'Choose a section');

    // A ticket's own values, not the project's statuses and priorities.
    case 'SET_TICKET_STATUS':
      return picker(
        'status',
        'Ticket status',
        TICKET_STATUSES.map((value) => ({ id: value, name: humanizeEnum(value) })),
        'Choose a status',
      );

    case 'SET_TICKET_PRIORITY':
      return picker(
        'priority',
        'Ticket priority',
        TICKET_PRIORITIES.map((value) => ({ id: value, name: humanizeEnum(value) })),
        'Choose a priority',
      );

    case 'MOVE_TO_PROJECT':
      return (
        <MoveToProjectFields
          configuration={configuration}
          metadata={metadata}
          onChange={onChange}
        />
      );

    /*
     * `status`, not `statusDefinitionId`.
     *
     * The runner reads `status`, so a rule built here wrote a key nothing read
     * and set the status to an empty string on every run. The short name is the
     * canonical one because the value is a status *id* — a definition's uuid
     * where a workspace has defined its own, and a legacy enum name where it
     * has not — so the longer name would be wrong for half of them.
     */
    case 'UPDATE_STATUS':
      return picker('status', 'Status', metadata?.statuses, 'Choose a status');

    case 'UPDATE_PRIORITY':
      return picker('priority', 'Priority', metadata?.priorities, 'Choose a priority');

    case 'SET_CUSTOM_FIELD':
      return (
        <CustomFieldAction
          config={configuration}
          metadata={metadata}
          set={set}
          read={read}
          onChange={onChange}
        />
      );

    /*
     * A count of days, not a date: "due in three days" stays meaningful for as
     * long as the rule exists, where a fixed date is stale the week after. The
     * due-date step had no form at all, so the action could only ever set
     * today.
     */
    case 'SET_DUE_DATE':
    case 'SET_START_DATE':
      return (
        <Field
          label="Days from now"
          htmlFor="step-daysFromNow"
          hint="0 sets it to the day the rule runs."
        >
          <Input
            id="step-daysFromNow"
            type="number"
            min={0}
            step={1}
            value={readNumber('daysFromNow')}
            onChange={(event) => setNumber('daysFromNow', event.target.value)}
          />
        </Field>
      );

    case 'SET_ESTIMATE':
      return (
        <Field label="Minutes" htmlFor="step-minutes">
          <Input
            id="step-minutes"
            type="number"
            min={0}
            step={1}
            value={readNumber('minutes')}
            onChange={(event) => setNumber('minutes', event.target.value)}
          />
        </Field>
      );

    case 'ADD_COMMENT':
      return (
        <VariableTextField
          id="step-body"
          label="Comment"
          value={read('body')}
          onChange={(value) => set('body', value)}
          placeholder="What should it say?"
          multiline
        />
      );

    case 'SET_COMPLETION':
      return <CompletionFields configuration={configuration} onChange={onChange} />;

    case 'REMOVE_FROM_PROJECT':
      return (
        <p className="text-sm text-muted-foreground">
          The task leaves this project, with its subtasks. It keeps its assignee, so it stays in
          their My Tasks.
        </p>
      );

    case 'CREATE_TASK':
      return (
        <CreateTaskFields configuration={configuration} metadata={metadata} onChange={onChange} />
      );

    case 'ADD_REMOVE_COLLABORATORS':
      return (
        <CollaboratorFields configuration={configuration} metadata={metadata} onChange={onChange} />
      );

    case 'SET_TASK_NAME':
      return (
        <VariableTextField
          id="step-text"
          label="New name"
          value={read('text')}
          onChange={(value) => set('text', value)}
          placeholder="e.g. [Review] {{task.name}}"
        />
      );

    case 'SET_TASK_DESCRIPTION':
      return (
        <VariableTextField
          id="step-text"
          label="Description"
          value={read('text')}
          onChange={(value) => set('text', value)}
          hint="Replaces the description. Left empty, it clears it."
          multiline
        />
      );

    case 'CREATE_SUBTASK':
      return (
        <SubtaskListFields configuration={configuration} metadata={metadata} onChange={onChange} />
      );

    case 'ASSIGN_TEAM':
      return <TeamFields configuration={configuration} metadata={metadata} onChange={onChange} />;

    case 'CREATE_CHECKLIST':
      return <ChecklistFields configuration={configuration} onChange={onChange} />;

    case 'SEND_WEBHOOK':
      return (
        <SendWebhookFields configuration={configuration} metadata={metadata} onChange={onChange} />
      );

    case 'SEND_EMAIL':
      return <SendEmailFields configuration={configuration} onChange={onChange} />;

    case 'AI_ACTION':
      return (
        <AiActionFields configuration={configuration} metadata={metadata} onChange={onChange} />
      );

    case 'AI_DRAFT_UPDATE':
      return <AiDraftUpdateFields configuration={configuration} onChange={onChange} />;

    default:
      return <p className="text-sm text-muted-foreground">This step has nothing to configure.</p>;
  }
}

/** "Choose an option": move the task there, or add it there as well. */
const MOVE_OPTION = 'MOVE';
const ADD_OPTION = 'ADD';

/**
 * Moving a task to another project: which one, and which of its sections.
 *
 * Laid out as the same panel is in Asana — an option, a project, a section —
 * because that is the shape somebody arriving from there expects to find.
 * "Move" takes the task out of this project; "Add" (stored as `mode: 'ADD'`)
 * leaves it here and puts it in the other project too, in the section chosen.
 *
 * The section list follows the chosen project, and changing the project clears
 * the section: a section id means nothing in another project, and keeping it
 * would leave the form reading answered while storing something the runner
 * refuses. No section chosen is a real answer — the project's first — and the
 * hint says so rather than leaving the empty box to look unfinished.
 */
function MoveToProjectFields({
  configuration,
  metadata,
  onChange,
}: {
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);

  const read = (key: string): string => {
    const value = configuration[key];
    return typeof value === 'string' ? value : '';
  };

  const projects = metadata?.projects ?? [];
  const project = projects.find((entry) => entry.id === read('projectId'));

  const chooseProject = (projectId: string | undefined) => {
    onChange({ ...configuration, projectId, targetSectionId: undefined });
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <Field label="Choose an option" htmlFor="step-move-option">
        <Select
          value={read('mode') === ADD_OPTION ? ADD_OPTION : MOVE_OPTION}
          onValueChange={(value) => {
            // Radix answers a reset with an empty value; that is not a choice.
            if (!value) return;
            const { mode: _mode, ...rest } = configuration;
            onChange(value === ADD_OPTION ? { ...rest, mode: ADD_OPTION } : rest);
          }}
        >
          <SelectTrigger id="step-move-option" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <RadioItem value={MOVE_OPTION}>Move task to another project</RadioItem>
            <RadioItem value={ADD_OPTION}>
              <span className="flex flex-col">
                <span>Add task to another project</span>
                <span className="text-xs italic text-muted-foreground">
                  It stays in this project and shows in that one too.
                </span>
              </span>
            </RadioItem>
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="Choose a project"
        htmlFor="step-projectId"
        hint={
          projects.length === 0
            ? 'There is no other project in this workspace to move to.'
            : undefined
        }
      >
        {/* The clear control sits beside the trigger rather than inside it —
            a button inside a button is not a thing a browser will honour. */}
        <div className="relative">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                id="step-projectId"
                role="combobox"
                aria-expanded={open}
                aria-controls="step-projectId-list"
                className={cn(
                  'flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none transition-[border-color,box-shadow]',
                  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25',
                  project ? 'pr-9' : 'text-muted-foreground',
                )}
              >
                {project ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-left text-foreground">
                      {project.name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-left">Choose a project</span>
                    <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
                  </>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
              <Command>
                <CommandInput placeholder="Search projects…" />
                <CommandList id="step-projectId-list">
                  <CommandEmpty>No project matches.</CommandEmpty>
                  {projects.map((entry) => (
                    // The id rides along in the value so two projects with one
                    // name stay two rows; the search still matches on the name.
                    <CommandItem
                      key={entry.id}
                      value={`${entry.name} ${entry.id}`}
                      onSelect={() => chooseProject(entry.id)}
                    >
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="truncate">{entry.name}</span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {project && (
            <button
              type="button"
              aria-label="Clear project"
              onClick={() => chooseProject(undefined)}
              className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </Field>

      <Field
        label="Choose a column/section"
        htmlFor="step-targetSectionId"
        hint="Left blank, the task lands in the project’s first section."
      >
        <Select
          value={read('targetSectionId')}
          onValueChange={(value) => onChange({ ...configuration, targetSectionId: value })}
          disabled={!project}
        >
          <SelectTrigger id="step-targetSectionId" className="w-full">
            <SelectValue placeholder="First section" />
          </SelectTrigger>
          <SelectContent>
            {(project?.sections ?? []).map((section) => (
              <RadioItem key={section.id} value={section.id}>
                {section.name}
              </RadioItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/**
 * Setting a custom field: which one, and what to.
 *
 * Two questions rather than one, because a rule may be built from the catalogue
 * — where the row already names the field — or from a step somebody inserted,
 * where nothing has been chosen yet. The picker is shown either way rather than
 * hidden once filled, so the field is visible on the form that sets it and can
 * be corrected without deleting the step.
 *
 * The value control follows the field's type, and each one produces exactly the
 * shape the runner stores for that type. A control that produced a string for a
 * number field would write `NaN` and report success.
 */
function CustomFieldAction({
  config,
  metadata,
  set,
  read,
  onChange,
}: {
  config: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  set: (key: string, value: unknown) => void;
  read: (key: string) => string;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const fields = metadata?.customFields ?? [];
  // Canonical name first, then the one this was written under before the
  // builder and the runner agreed — see `LEGACY_ACTION_KEYS` on the API side.
  const fieldId = read('fieldId') || read('customFieldId');
  const field = fields.find((entry) => entry.id === fieldId);

  const options: ChoiceOption[] = (field?.options ?? []).map((option) => ({
    value: option.id,
    label: option.label,
    ...(option.colorToken ? { colorToken: option.colorToken } : {}),
  }));

  const raw = config['value'];
  const asList = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' && raw ? [raw] : [];

  return (
    <>
      <Field label="Field" htmlFor="step-custom-field">
        <Select
          value={fieldId}
          onValueChange={(value) =>
            /*
             * One write, and the old value goes with it.
             *
             * A value belongs to the field it was chosen from — an option id
             * from one select field means nothing in another, and a date is not
             * a number. Keeping it would leave the form looking answered while
             * storing something the runner cannot use.
             */
            onChange({ ...config, fieldId: value, customFieldId: undefined, value: undefined })
          }
        >
          <SelectTrigger id="step-custom-field" className="w-full">
            <SelectValue placeholder="Choose a field" />
          </SelectTrigger>
          <SelectContent>
            {fields.map((entry) => (
              <RadioItem key={entry.id} value={entry.id}>
                {entry.name}
              </RadioItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/*
        A date can be one somebody picks or one the rule works out when it runs.

        Asked before the value rather than beside it, because the two answers
        need different controls and a date input holding "the date this rule is
        triggered" has nowhere to put it. Only dates offer this — a token in a
        number or a text field is nonsense, which is why `tokensForFieldType`
        decides rather than this component.
      */}
      {field && tokensForFieldType(field.type).length > 0 && (
        <Field label="Set it to" htmlFor="step-custom-mode">
          <Select
            value={isTokenValue(raw) ? raw.token : LITERAL_VALUE}
            onValueChange={(next) =>
              set('value', next === LITERAL_VALUE ? undefined : { token: next })
            }
          >
            <SelectTrigger id="step-custom-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <RadioItem value={LITERAL_VALUE}>A specific date</RadioItem>
              {tokensForFieldType(field.type).map((token) => (
                <RadioItem key={token} value={token}>
                  {AUTOMATION_VALUE_TOKEN_LABEL[token]}
                </RadioItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {/* A computed date has already been answered; the input below would ask
          for a second date that nothing reads. */}
      {field && !isTokenValue(raw) && (
        <Field label="Value" htmlFor="step-custom-value">
          {field.type === 'CHECKBOX' ? (
            <Select
              value={raw === true ? 'true' : raw === false ? 'false' : ''}
              onValueChange={(value) => set('value', value === 'true')}
            >
              <SelectTrigger id="step-custom-value" className="w-full">
                <SelectValue placeholder="Checked or not" />
              </SelectTrigger>
              <SelectContent>
                <RadioItem value="true">Checked</RadioItem>
                <RadioItem value="false">Not checked</RadioItem>
              </SelectContent>
            </Select>
          ) : field.type === 'MULTI_SELECT' ? (
            <MultiSelect
              id="step-custom-value"
              options={options}
              values={asList}
              onChange={(next) => set('value', next)}
              placeholder="Choose options"
            />
          ) : field.type === 'SINGLE_SELECT' ? (
            <Select value={read('value')} onValueChange={(value) => set('value', value)}>
              <SelectTrigger id="step-custom-value" className="w-full">
                <SelectValue placeholder="Choose an option" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <RadioItem key={option.value} value={option.value}>
                    <OptionFace option={option} />
                  </RadioItem>
                ))}
              </SelectContent>
            </Select>
          ) : field.type === 'PEOPLE' ? (
            <MultiSelect
              id="step-custom-value"
              options={(metadata?.members ?? []).map((member) => ({
                value: member.id,
                label: member.name,
              }))}
              values={asList}
              onChange={(next) => set('value', next)}
              placeholder="Choose people"
            />
          ) : (
            <Input
              id="step-custom-value"
              // The runner coerces by type, so the control has to produce what
              // that coercion expects — a date string, a number, or text.
              type={isNumeric(field.type) ? 'number' : field.type === 'DATE' ? 'date' : 'text'}
              value={typeof raw === 'number' ? String(raw) : read('value')}
              onChange={(event) =>
                set(
                  'value',
                  isNumeric(field.type)
                    ? event.target.value === ''
                      ? undefined
                      : Number(event.target.value)
                    : event.target.value,
                )
              }
            />
          )}
        </Field>
      )}
    </>
  );
}

/** A rating is a bounded whole number; the runner stores and compares it as one. */
function isNumeric(type: string): boolean {
  return type === 'NUMBER' || type === 'RATING';
}

const ANY_STATUS = '__any__';

/** "Ticket status changes": to any status, or to one — "when a ticket is resolved". */
function TicketStatusTriggerFields({
  configuration,
  onChange,
}: {
  configuration: Record<string, unknown>;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const status =
    typeof configuration['status'] === 'string' && configuration['status'] !== ''
      ? configuration['status']
      : ANY_STATUS;

  return (
    <Field
      label="When the status changes to"
      htmlFor="trigger-ticket-status"
      hint="Any status fires on every change."
    >
      <Select
        value={status}
        onValueChange={(next) => {
          // Radix answers a reset with an empty value; that is not a choice.
          if (!next) return;
          onChange(next === ANY_STATUS ? {} : { status: next });
        }}
      >
        <SelectTrigger id="trigger-ticket-status" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <RadioItem value={ANY_STATUS}>Any status</RadioItem>
          {TICKET_STATUSES.map((value) => (
            <RadioItem key={value} value={value}>
              {humanizeEnum(value)}
            </RadioItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * "Wait…": how many minutes, hours or days before what follows runs. What
 * follows is judged on the task as it is by then, so a condition after the
 * wait is how a rule says "if it is still open".
 */
function DelayFields({
  configuration,
  onChange,
}: {
  configuration: Record<string, unknown>;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const unit = AUTOMATION_DELAY_UNITS.includes(configuration['unit'] as AutomationDelayUnit)
    ? (configuration['unit'] as AutomationDelayUnit)
    : AutomationDelayUnit.DAYS;
  const amount = typeof configuration['amount'] === 'number' ? configuration['amount'] : '';
  const problem = delayProblem(configuration);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wait for" htmlFor="step-delay-amount" error={problem ?? undefined}>
          <Input
            id="step-delay-amount"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange({
                ...configuration,
                unit,
                amount: event.target.value === '' || Number.isNaN(next) ? undefined : next,
              });
            }}
          />
        </Field>
        <Field label="Unit" htmlFor="step-delay-unit">
          <Select
            value={unit}
            onValueChange={(next) => {
              // Radix answers a reset with an empty value; that is not a choice.
              if (next) onChange({ ...configuration, unit: next });
            }}
          >
            <SelectTrigger id="step-delay-unit" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTOMATION_DELAY_UNITS.map((entry) => (
                <RadioItem key={entry} value={entry}>
                  {AUTOMATION_DELAY_UNIT_LABEL[entry]}
                </RadioItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Steps after this run once the time has passed, checked against the task as it is then — add
        a condition after it to act only if something is still true.
      </p>
    </div>
  );
}
