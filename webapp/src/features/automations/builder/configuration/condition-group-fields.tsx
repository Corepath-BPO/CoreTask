import {
  AI_CHECK_FIELD,
  ConditionMatch,
  MAX_CONDITION_GROUP_DEPTH,
  groupMatch,
  isConditionGroup,
} from '@coretask/contracts';
import type { AutomationCatalogEntry, AutomationMetadata } from '@coretask/types';
import { ListPlus, Plus, X } from 'lucide-react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { ComparisonFields } from './comparison-fields';
import { conditionFromCatalogueEntry } from './condition-value';
import { RadioItem } from './radio-item';

type Configuration = Record<string, unknown>;

/**
 * A "Check if" step: one comparison, or a group of them.
 *
 * One comparison is the form it always was, with a way to ask a second
 * question beside it. Asking one turns the step into a group — "all of these"
 * by default, which is what two conditions meant before groups — and the group
 * can be switched to "any of these", or hold a group of its own for
 * `A and (B or C)`. See `automation-condition-groups` in the contracts for the
 * shape, which the runner and the validator read the same way.
 *
 * Removing the second-to-last comparison of the outer group makes the step one
 * comparison again, so a step only looks like a group while it is one.
 */
export function ConditionStepFields({
  configuration,
  metadata,
  subject,
  onChange,
}: {
  configuration: Configuration;
  metadata: AutomationMetadata | undefined;
  /** Whether the rule is about tasks or tickets — which fields it can ask about. */
  subject: 'TASK' | 'TICKET';
  onChange: (configuration: Configuration) => void;
}) {
  if (!isConditionGroup(configuration)) {
    return (
      <>
        <ComparisonFields configuration={configuration} metadata={metadata} onChange={onChange} />

        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="cursor-pointer px-2 text-muted-foreground"
            onClick={() => onChange({ match: ConditionMatch.ALL, conditions: [configuration, {}] })}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add another condition
          </Button>
        </div>
      </>
    );
  }

  return (
    <GroupEditor
      group={configuration}
      depth={1}
      path="group"
      metadata={metadata}
      subject={subject}
      onChange={(next) => {
        // A group of one comparison is one comparison.
        const entries = next['conditions'] as Configuration[];
        const only = entries[0];
        if (entries.length === 1 && only && !isConditionGroup(only)) {
          onChange(only);
          return;
        }
        onChange(next);
      }}
    />
  );
}

const MATCH_LABEL: Record<ConditionMatch, string> = {
  ALL: 'All of these are true',
  ANY: 'Any of these is true',
};

/** The word between two entries, which is the relationship the reader sees. */
const JOINER: Record<ConditionMatch, string> = { ALL: 'and', ANY: 'or' };

function GroupEditor({
  group,
  depth,
  path,
  metadata,
  subject,
  onChange,
  onRemove,
}: {
  group: Configuration;
  /** 1 for the step's own group. */
  depth: number;
  /** Distinguishes this group's controls from every other group's. */
  path: string;
  metadata: AutomationMetadata | undefined;
  subject: 'TASK' | 'TICKET';
  onChange: (group: Configuration) => void;
  /** Present on a group inside a group: the way to take it out again. */
  onRemove?: () => void;
}) {
  const match = groupMatch(group);
  const entries = (group['conditions'] as Configuration[]) ?? [];

  const setEntries = (next: Configuration[]) => onChange({ ...group, conditions: next });
  const replace = (index: number, entry: Configuration) =>
    setEntries(entries.map((existing, at) => (at === index ? entry : existing)));
  const remove = (index: number) => setEntries(entries.filter((_, at) => at !== index));

  return (
    <div
      role="group"
      aria-label={depth === 1 ? 'Conditions' : 'Group of conditions'}
      className={cn('grid gap-3', depth > 1 && 'rounded-lg border border-border bg-muted/30 p-3')}
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label={depth === 1 ? 'Check that' : 'In this group'} htmlFor={`${path}-match`}>
            <Select value={match} onValueChange={(next) => onChange({ ...group, match: next })}>
              <SelectTrigger id={`${path}-match`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <RadioItem value={ConditionMatch.ALL}>{MATCH_LABEL.ALL}</RadioItem>
                <RadioItem value={ConditionMatch.ANY}>{MATCH_LABEL.ANY}</RadioItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
            aria-label="Remove this group"
            onClick={onRemove}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      <ol className="grid gap-2">
        {entries.map((entry, index) => (
          <li key={index} className="grid gap-2">
            {index > 0 && (
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {JOINER[match]}
              </span>
            )}

            {isConditionGroup(entry) ? (
              <GroupEditor
                group={entry}
                depth={depth + 1}
                path={`${path}-${index}`}
                metadata={metadata}
                subject={subject}
                onChange={(next) => replace(index, next)}
                onRemove={() => remove(index)}
              />
            ) : (
              <ComparisonEntry
                comparison={entry}
                number={index + 1}
                path={`${path}-${index}`}
                metadata={metadata}
                subject={subject}
                onChange={(next) => replace(index, next)}
                onRemove={() => remove(index)}
              />
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="cursor-pointer px-2 text-muted-foreground"
          onClick={() => setEntries([...entries, {}])}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add condition
        </Button>

        {/* A group inside this one, asking the other way round by default —
            "all of these, and any of those" is what nesting is usually for. */}
        {depth < MAX_CONDITION_GROUP_DEPTH && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="cursor-pointer px-2 text-muted-foreground"
            onClick={() =>
              setEntries([
                ...entries,
                {
                  match: match === ConditionMatch.ALL ? ConditionMatch.ANY : ConditionMatch.ALL,
                  conditions: [{}],
                },
              ])
            }
          >
            <ListPlus className="size-3.5" aria-hidden="true" />
            Add group
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * One comparison inside a group: which field, then the comparison form.
 *
 * The field is a list here rather than the catalogue panel a branch opens,
 * because the panel replaces the whole step — and this is one line of it.
 */
function ComparisonEntry({
  comparison,
  number,
  path,
  metadata,
  subject,
  onChange,
  onRemove,
}: {
  comparison: Configuration;
  number: number;
  path: string;
  metadata: AutomationMetadata | undefined;
  subject: 'TASK' | 'TICKET';
  onChange: (comparison: Configuration) => void;
  onRemove: () => void;
}) {
  const choices = fieldChoices(metadata, subject);
  const field = typeof comparison['field'] === 'string' ? comparison['field'] : '';

  return (
    <div className="grid gap-3 rounded-lg border border-border p-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label={`Condition ${number}`} htmlFor={`${path}-field`}>
            <Select
              value={choices.some((entry) => entry.subtype === field) ? field : ''}
              onValueChange={(next) => {
                const entry = choices.find((candidate) => candidate.subtype === next);
                // A new field makes the old comparison and value meaningless.
                if (entry) onChange(conditionFromCatalogueEntry(entry));
              }}
            >
              <SelectTrigger id={`${path}-field`} className="w-full">
                <SelectValue placeholder="Choose what to check" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((entry) => (
                  <RadioItem key={entry.subtype} value={entry.subtype}>
                    {entry.label}
                  </RadioItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
          aria-label={`Remove condition ${number}`}
          onClick={onRemove}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {field !== '' && (
        <ComparisonFields
          configuration={comparison}
          metadata={metadata}
          onChange={onChange}
          idPrefix={`${path}-`}
        />
      )}
    </div>
  );
}

/**
 * What a comparison in a group can be about: the condition catalogue, less
 * what it cannot run, what is about the other kind of rule, and the AI check
 * — which asks a model, and is a branch of its own so its answer is logged as
 * the step's.
 */
function fieldChoices(
  metadata: AutomationMetadata | undefined,
  subject: 'TASK' | 'TICKET',
): AutomationCatalogEntry[] {
  return (metadata?.conditions ?? []).filter(
    (entry) =>
      entry.available &&
      entry.subtype !== AI_CHECK_FIELD &&
      (entry.subjects ?? ['TASK']).includes(subject),
  );
}
