import { MAX_CHECKLIST_ITEMS } from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';

import { Field } from '@/components/forms/field';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { VariableTextField } from './extra-action-fields';
import { RadioItem } from './radio-item';

type Configuration = Record<string, unknown>;

/*
 * "No team" as a value the select can hold: Radix reads an empty string as
 * nothing chosen, and clearing the team is a choice.
 */
const CLEAR = '__clear__';

/**
 * Which team becomes responsible for the task — or "no team", to clear it.
 *
 * The two answers are stored apart (`teamId`, or `clear: true`) so that a step
 * nobody has answered yet is told from one that deliberately clears.
 */
export function TeamFields({
  configuration,
  metadata,
  onChange,
}: {
  configuration: Configuration;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Configuration) => void;
}) {
  const teams = metadata?.teams ?? [];
  const teamId = typeof configuration['teamId'] === 'string' ? configuration['teamId'] : '';
  const value = configuration['clear'] === true ? CLEAR : teamId;

  return (
    <Field
      label="Team"
      htmlFor="step-teamId"
      {...(teams.length === 0
        ? { hint: 'This workspace has no teams yet. Create one under Teams.' }
        : {})}
    >
      <Select
        value={value}
        onValueChange={(next) => onChange(next === CLEAR ? { clear: true } : { teamId: next })}
      >
        <SelectTrigger id="step-teamId" className="w-full">
          <SelectValue placeholder="Choose a team" />
        </SelectTrigger>
        <SelectContent>
          {teams.map((team) => (
            <RadioItem key={team.id} value={team.id}>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: team.color }}
                />
                {team.name}
              </span>
            </RadioItem>
          ))}
          <RadioItem value={CLEAR}>No team — clear it</RadioItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * The checklist a step adds: its name, and its items one per line.
 *
 * One line per item because a checklist is usually pasted from somewhere — a
 * move-in list, a launch list — and a row of inputs makes that thirty clicks.
 * The lines are stored as typed, blanks included, so the box does not jump
 * while somebody is writing; `checklistOf` drops the blanks wherever the step
 * is read.
 */
export function ChecklistFields({
  configuration,
  onChange,
}: {
  configuration: Configuration;
  onChange: (configuration: Configuration) => void;
}) {
  const name = typeof configuration['name'] === 'string' ? configuration['name'] : '';
  const items = Array.isArray(configuration['items'])
    ? (configuration['items'] as unknown[]).map((item) => (typeof item === 'string' ? item : ''))
    : [];

  return (
    <>
      <VariableTextField
        id="step-name"
        label="Checklist name"
        value={name}
        onChange={(next) => onChange({ ...configuration, name: next })}
        placeholder="e.g. Move-in inspection"
      />

      <Field
        label="Items"
        htmlFor="step-items"
        hint={`One per line, up to ${MAX_CHECKLIST_ITEMS}. Each starts unticked.`}
      >
        <Textarea
          id="step-items"
          rows={6}
          value={items.join('\n')}
          onChange={(event) =>
            onChange({ ...configuration, items: event.target.value.split('\n') })
          }
          placeholder={'Keys handed over\nMeter readings taken\nSmoke alarms tested'}
        />
      </Field>
    </>
  );
}
