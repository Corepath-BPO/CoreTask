import type { AutomationGraphIssue } from '@coretask/types';
import { BookmarkPlus, History, LibraryBig, MoreHorizontal, Settings, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { AutomationValidationIssues } from './automation-validation-issues';

/** What the header says about the last write. */
export type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

/** What the builder shows: the rule to edit, or what it has done. */
export type BuilderView = 'build' | 'activity';

const SAVE_LABEL: Record<Exclude<SaveState, 'idle'>, string> = {
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Unable to save',
};

/**
 * The builder's bar, laid out as Asana's rule editor is: the name and an Active
 * switch on the left, Build | Activity in the middle, and Cancel / Save with
 * the settings and a ⋯ menu on the right. See
 * `docs/architecture/automation-builder-layout.md`.
 *
 * Underneath, a rule is still a draft that is published. The switch is whether
 * the rule runs: on publishes it, off pauses it. Save keeps the draft — and on a
 * rule that is running it also puts the edits live, which is what Save means to
 * somebody used to Asana.
 *
 * Presentational. The only thing it owns is whether the name is being typed;
 * everything else it reports back to the page, which owns the rule.
 */
export function AutomationBuilderHeader({
  projectName,
  status,
  publishedVersion,
  hasUnpublishedChanges,
  name,
  onNameChange,
  view,
  onViewChange,
  activityAvailable,
  canTurnOn,
  toggling,
  onToggleLive,
  settingsOpen,
  onToggleSettings,
  save,
  saving,
  canSave,
  onSave,
  issues,
  onFocusIssue,
  onShowHistory,
  onDelete,
  onSaveToLibrary,
  canSaveToLibrary,
  onBrowseLibrary,
  canBrowseLibrary,
  onClose,
}: {
  /** Above the name, like a breadcrumb. Undefined until the project arrives. */
  projectName: string | undefined;
  status: string;
  /** The number of the version running, null until the rule is published. */
  publishedVersion: number | null;
  /** Whether the draft says something the running version does not. */
  hasUnpublishedChanges: boolean;
  name: string;
  onNameChange: (name: string) => void;
  view: BuilderView;
  onViewChange: (view: BuilderView) => void;
  /** Off for a rule never saved: it has no runs to show. */
  activityAvailable: boolean;
  /** Whether the rule can be published now: named, a trigger, no blocking problem. */
  canTurnOn: boolean;
  /** A publish or pause on its way. */
  toggling: boolean;
  /** On publishes the rule; off pauses it. */
  onToggleLive: (live: boolean) => void;
  /** Whether the rail is showing the rule's own settings rather than a step's. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
  save: SaveState;
  saving: boolean;
  canSave: boolean;
  /** Keep the draft, and on a running rule put it live. The page decides which. */
  onSave: () => void;
  issues: AutomationGraphIssue[];
  onFocusIssue: (nodeId: string) => void;
  /** Open the rule's versions. Absent until there is one. */
  onShowHistory?: () => void;
  /** Take the whole rule away. Absent on a rule never saved. */
  onDelete?: () => void;
  /** Put this rule in the workspace's library for other projects to start from. */
  onSaveToLibrary: () => void;
  /** Off until the rule has a name and a trigger — the library keeps rules, not blanks. */
  canSaveToLibrary: boolean;
  /** Open the library to start a different rule from. */
  onBrowseLibrary: () => void;
  /** Off while there are unsaved changes: choosing a template leaves this canvas. */
  canBrowseLibrary: boolean;
  /** Cancel: leave the builder. The dialog asks about unsaved work on the way out. */
  onClose: () => void;
}) {
  const live = status === 'ACTIVE';
  const state = live ? 'Active' : status === 'PAUSED' ? 'Paused' : 'Draft';

  return (
    <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          {/* A fixed line, filled or not, so the bar does not jump when the
              project arrives a moment after the rule. */}
          <p className="h-4 truncate px-2 text-xs text-muted-foreground">{projectName}</p>
          <RuleName name={name} onChange={onNameChange} />
        </div>

        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Switch
            checked={live}
            disabled={toggling || (!live && !canTurnOn)}
            onCheckedChange={(next) => onToggleLive(next)}
            aria-label={live ? 'Turn this rule off' : 'Turn this rule on'}
            title={
              !live && !canTurnOn
                ? 'Name the rule, choose its trigger and fix its problems to turn it on'
                : undefined
            }
          />
          <span className={cn(live ? 'text-foreground' : 'text-muted-foreground')}>
            {state}
            {publishedVersion !== null && (
              <span className="opacity-70"> · v{publishedVersion}</span>
            )}
          </span>
        </label>

        {/* A live rule runs its last published version; this says the draft
            holds more than that, until Save puts it live. */}
        {live && hasUnpublishedChanges && (
          <Badge variant="warning" title="Saved, and not running until you press Save">
            Unpublished changes
          </Badge>
        )}
      </div>

      <div
        role="tablist"
        aria-label="Rule"
        className="flex rounded-lg border border-border bg-muted/40 p-0.5"
      >
        <ViewTab label="Build" selected={view === 'build'} onSelect={() => onViewChange('build')} />
        <ViewTab
          label="Activity"
          selected={view === 'activity'}
          disabled={!activityAvailable}
          title={activityAvailable ? undefined : 'Save the rule to see its runs'}
          onSelect={() => onViewChange('activity')}
        />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">
        <SaveIndicator state={save} />

        {/* Beside Save, not above the canvas: this is why Save, or the switch, is off. */}
        <AutomationValidationIssues issues={issues} onFocusNode={onFocusIssue} />

        <Button variant="outline" size="sm" className="cursor-pointer" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="cursor-pointer"
          loading={saving}
          disabled={!canSave || saving}
          onClick={onSave}
          title={live ? 'Save, and put your changes live' : 'Save the draft; the rule stays off'}
        >
          Save
        </Button>

        {/* The rule's own settings: what it is called, what it is for, and
            whether other rules may set it off. */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 cursor-pointer"
          aria-label="Rule settings"
          aria-pressed={settingsOpen}
          onClick={onToggleSettings}
        >
          <Settings className="size-4" aria-hidden="true" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer"
              aria-label="More actions"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {onShowHistory && (
              <DropdownMenuItem onSelect={onShowHistory}>
                <History className="size-4" aria-hidden="true" />
                Version history
              </DropdownMenuItem>
            )}
            {/* Saves the canvas first, so the library gets what is on screen. */}
            <DropdownMenuItem disabled={!canSaveToLibrary} onSelect={onSaveToLibrary}>
              <BookmarkPlus className="size-4" aria-hidden="true" />
              Save to library
            </DropdownMenuItem>
            {/* Starting from a template leaves this canvas, so only with nothing to lose. */}
            <DropdownMenuItem disabled={!canBrowseLibrary} onSelect={onBrowseLibrary}>
              <LibraryBig className="size-4" aria-hidden="true" />
              {canBrowseLibrary ? 'Browse the rule library' : 'Browse the library (save first)'}
            </DropdownMenuItem>
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={onDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete this rule
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

/** One of Build | Activity. */
function ViewTab({
  label,
  selected,
  onSelect,
  disabled,
  title,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={cn(
        'h-7 rounded-md px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
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
