import type { AutomationRuleGraph } from '@coretask/types';
import { useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const NAME_LIMIT = 120;
const DESCRIPTION_LIMIT = 500;

/** What the panel can change about the rule as a whole. */
export interface RuleSettings {
  name: string;
  description: string;
  allowChaining: boolean;
}

/**
 * The rule itself, rather than any one step.
 *
 * Its own panel because these are answers about the whole thing — what it is
 * called, what it is for, whether other rules may set it off — and none of them
 * belong to a step on the canvas. Putting them in the header instead would mean
 * a row of controls competing with the rule for attention while somebody builds
 * it, which is the opposite of what a canvas is for.
 */
export function RuleSettingsPanel({
  rule,
  settings,
  onChange,
}: {
  rule: AutomationRuleGraph;
  settings: RuleSettings;
  onChange: (next: Partial<RuleSettings>) => void;
}) {
  const [tab, setTab] = useState<'general' | 'permissions'>('general');

  return (
    <>
      {/* `shrink-0`, like the heading above it: the way between the two halves
          of this panel cannot be the part that scrolls out of reach. */}
      <div
        role="tablist"
        aria-label="Rule settings"
        className="flex shrink-0 border-b border-border px-2"
      >
        {(['general', 'permissions'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            onClick={() => setTab(entry)}
            className={cn(
              'cursor-pointer border-b-2 px-3 py-2 text-sm capitalize transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              tab === entry
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {entry}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === 'general' ? (
          <div className="grid gap-5">
            <Owner rule={rule} />

            <div className="grid gap-1.5">
              <Label htmlFor="rule-name">Title</Label>
              <Input
                id="rule-name"
                value={settings.name}
                maxLength={NAME_LIMIT}
                onChange={(event) => onChange({ name: event.target.value })}
                placeholder="Name this rule"
                aria-invalid={settings.name.trim() === ''}
              />
              <Counter used={settings.name.length} limit={NAME_LIMIT} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="rule-description">Description</Label>
              <Textarea
                id="rule-description"
                rows={3}
                value={settings.description}
                maxLength={DESCRIPTION_LIMIT}
                onChange={(event) => onChange({ description: event.target.value })}
                placeholder="What does this rule do?"
              />
              <Counter used={settings.description.length} limit={DESCRIPTION_LIMIT} />
            </div>

            <div className="grid gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Controls
              </h3>

              {/*
                Only what the engine actually honours.

                The runner already knows how deep into a chain an event is, so
                this one is a real question it can answer: above zero means
                another rule caused it. A control that looked like it did
                something and did not would be worse than not offering it.
              */}
              <Toggle
                label="Trigger via other rules"
                hint="Let this rule run on changes another rule made, not only on what people do."
                checked={settings.allowChaining}
                onChange={(allowChaining) => onChange({ allowChaining })}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-5">
            <Owner rule={rule} />

            <p className="text-sm text-muted-foreground">
              Managers and owners of this workspace can edit, publish and delete this rule. Everyone
              else can see it and what it has done.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function Owner({ rule }: { rule: AutomationRuleGraph }) {
  return (
    <div className="grid gap-1.5">
      <Label>Rule owner</Label>

      {rule.createdBy ? (
        <div className="flex items-center gap-2">
          <Avatar className="size-6">
            {rule.createdBy.avatarUrl && <AvatarImage src={rule.createdBy.avatarUrl} alt="" />}
            <AvatarFallback>{rule.createdBy.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="truncate text-sm text-foreground">{rule.createdBy.name}</span>
        </div>
      ) : (
        // The account was removed, or the rule has not been saved yet. Said in
        // words rather than shown as a blank row, which reads as broken.
        <p className="text-sm text-muted-foreground">
          {rule.id === '' ? 'You, once this rule is saved.' : 'The person who made this has left.'}
        </p>
      )}
    </div>
  );
}

function Counter({ used, limit }: { used: number; limit: number }) {
  return (
    <p className="text-right text-xs text-muted-foreground">
      {used}/{limit} characters
    </p>
  );
}

/**
 * A switch, built from a button.
 *
 * `role="switch"` with `aria-checked` is what a screen reader needs, and a
 * button is already focusable and operable by Space and Enter — so this needs
 * no library and cannot drift from what assistive tech expects.
 */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-4 rounded-full bg-background shadow-sm transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
    </div>
  );
}
