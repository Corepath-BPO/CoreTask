import type { AutomationGraphIssue } from '@coretask/types';
import { Save, Settings, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { AutomationValidationIssues } from './automation-validation-issues';

/** What the header says about the last write, where a Save button used to be. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_LABEL: Record<Exclude<SaveState, 'idle'>, string> = {
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Unable to save',
};

const STATUS_TONE: Record<string, 'muted' | 'success' | 'warning' | 'destructive'> = {
  DRAFT: 'muted',
  ACTIVE: 'success',
  PAUSED: 'warning',
  DISABLED: 'muted',
  ARCHIVED: 'muted',
};

/**
 * The whole of the builder's chrome, in one bar.
 *
 * It used to be two: this, and a row of Change trigger / Add action / Add branch
 * underneath. Every one of those already exists on the canvas — the trigger card
 * opens the trigger, the "+ Do this…" placeholder opens the action list, the "…"
 * on a connector splits the rule — so the row was a second way to do things
 * somebody was already looking at, and it charged the drawing a strip of height
 * for the privilege. A canvas needs room more than it needs a menu bar.
 *
 * Presentational. The only thing it owns is whether the name is being typed;
 * everything else it reports back to the page, which owns the rule.
 */
export function AutomationBuilderHeader({
  projectName,
  status,
  name,
  onNameChange,
  settingsOpen,
  onToggleSettings,
  save,
  saving,
  canSave,
  onSave,
  issues,
  onFocusIssue,
  publishing,
  canPublish,
  onPublish,
  onClose,
}: {
  /** Above the name, like a breadcrumb. Undefined until the project arrives. */
  projectName: string | undefined;
  status: string;
  name: string;
  onNameChange: (name: string) => void;
  /** Whether the rail is showing the rule's own settings rather than a step's. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
  save: SaveState;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  issues: AutomationGraphIssue[];
  onFocusIssue: (nodeId: string) => void;
  publishing: boolean;
  canPublish: boolean;
  onPublish: () => void;
  onClose: () => void;
}) {
  return (
    // `shrink-0`, because the canvas below it is the flex child that grows: a
    // header allowed to give up height would be squeezed by its own contents.
    <header className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-2.5">
      <div className="min-w-0 flex-1">
        {/*
          A fixed line, filled or not.

          The project is a second request, so leaving the row out until it lands
          made the whole header — and the canvas under it — jump down a line a
          moment after the rule appeared.
        */}
        <p className="h-4 truncate px-2 text-xs text-muted-foreground">{projectName}</p>

        <div className="flex min-w-0 items-center gap-2">
          <RuleName name={name} onChange={onNameChange} />

          <Badge variant={STATUS_TONE[status] ?? 'muted'} className="gap-1.5">
            {/* `bg-current` so the dot is whatever the badge already is, rather
                than a second colour to keep in step with the tone map. */}
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {status.charAt(0) + status.slice(1).toLowerCase()}
          </Badge>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <SaveIndicator state={save} />

        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          loading={saving}
          disabled={!canSave || saving}
          onClick={onSave}
        >
          <Save className="size-4" aria-hidden="true" />
          Save draft
        </Button>

        {/* The rule's own settings — what it is called, what it is for, and
            whether other rules may set it off. */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 cursor-pointer"
          aria-label="Rule settings"
          aria-pressed={settingsOpen}
          onClick={onToggleSettings}
        >
          {/* A cog rather than sliders: this opens the rule's own settings, and
              sliders read as "adjust what is on screen". */}
          <Settings className="size-4" aria-hidden="true" />
        </Button>

        {/* Beside Publish, not above the canvas: this is the explanation for the
            button next to it being off. */}
        <AutomationValidationIssues issues={issues} onFocusNode={onFocusIssue} />

        <Button
          size="sm"
          className="cursor-pointer"
          loading={publishing}
          disabled={!canPublish || publishing}
          onClick={onPublish}
        >
          Publish rule
        </Button>

        {/* Leaving is leaving, wherever it is pressed from: the dialog asks
            about unsaved work on its way out, so this does not have to. */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 cursor-pointer"
          aria-label="Close rule builder"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}

/**
 * The rule's name, edited where it is written.
 *
 * A heading until somebody presses it, rather than an input sitting in the
 * header permanently. A field with a border on it says "fill this in" every time
 * the page opens, when almost every visit is to change a step and not the title
 * — and it makes the one line that says what the rule *is* look like a form
 * control rather than the name of the thing on screen.
 *
 * A button becomes the input, so the swap costs nothing to reach: a button is
 * already focusable and already answers to Enter and Space.
 */
function RuleName({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);

  /*
   * Reverting and committing both end in a blur, and they have to be told apart.
   *
   * Escape unmounts the input, which the browser may follow with a blur — and
   * blur means commit, so without this the revert would be overwritten by the
   * value it had just thrown away.
   */
  const reverted = useRef(false);

  const begin = () => {
    reverted.current = false;
    setDraft(name);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);

    if (reverted.current) {
      reverted.current = false;
      return;
    }

    onChange(draft);
  };

  // Selected, not just focused: renaming is far more often replacing the whole
  // name than appending to it, and a caret at the end makes that a chore.
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (editing) {
    return (
      <Input
        ref={input}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            return;
          }

          if (event.key !== 'Escape') return;

          reverted.current = true;
          setEditing(false);
        }}
        aria-label="Rule name"
        aria-invalid={draft.trim() === ''}
        placeholder="Name this rule"
        /*
         * Claims Escape, so the dialog around it does not read the same press
         * as "leave the builder" — see the wrapper's `onEscapeKeyDown`. A marker
         * rather than `stopPropagation`, because the dialog listens on the
         * document in the capture phase and has already acted by the time
         * anything down here is asked.
         */
        data-escape-handled=""
        className="h-8 w-96 px-2 text-lg font-semibold md:text-lg"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={begin}
      /*
       * The name is inside the label, not replaced by it.
       *
       * Somebody navigating by voice asks for what they can see, so a control
       * announced only as "Rename" would not answer to the words on it.
       */
      aria-label={name ? `Rule name: ${name}` : 'Name this rule'}
      className={cn(
        'min-w-0 max-w-[32rem] cursor-pointer truncate rounded-md px-2 py-0.5 text-left text-lg font-semibold transition-colors',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        name ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {name || 'Name this rule'}
    </button>
  );
}

/**
 * How the last save went, said quietly.
 *
 * The region is mounted whether or not it has anything in it: a live region has
 * to exist before its text does or the first change goes unannounced, and one
 * that appeared on the first save would also shove the row of buttons sideways
 * at the moment somebody pressed one.
 */
function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('text-xs', state === 'error' ? 'text-destructive' : 'text-muted-foreground')}
    >
      {state === 'idle' ? '' : SAVE_LABEL[state]}
    </span>
  );
}
