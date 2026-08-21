import { TRIGGER_LABEL, type AutomationTrigger } from '@coretask/contracts';
import type {
  AutomationCatalogEntry,
  AutomationMetadata,
  AutomationRuleGraph,
} from '@coretask/types';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { PanelRightClose, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { branchRows, type CanvasNode } from '../lib/graph-edits';
import { nodeCategory, summarise } from '../lib/node-summary';

import { catalogueIcon } from './catalogue-icons';
import { summariseCondition } from './condition-value';
import { NodeConfigFields } from './node-config-fields';
import { useRailDismiss, useRailFocus } from './rail-behaviour';
import { RuleSettingsPanel, type RuleSettings } from './rule-settings-panel';

/**
 * Which of the three catalogues the panel is showing.
 *
 * Stated by whoever opened it rather than inferred from the entries. Triggers
 * used to be told apart by their subtypes — every trigger is a member of
 * `AUTOMATION_TRIGGERS` and no action ever is — but conditions broke that:
 * their subtypes are field keys, and the action list carries plenty of subtypes
 * that are not executable actions either, so no property of the rows separates
 * the two. The click that opened the panel always knew, which makes saying so
 * both cheaper and impossible to get wrong.
 */
export type CatalogueKind = 'triggers' | 'conditions' | 'actions';

/**
 * What the rail is showing, if anything.
 *
 * One panel with two jobs, because they are two halves of the same act: a step
 * is chosen and then it is set up, and moving between a popover for the first
 * and a drawer for the second makes one task feel like two.
 */
export type RailMode =
  | { kind: 'closed' }
  | { kind: 'configure'; nodeId: string }
  | {
      kind: 'choose';
      catalogue: CatalogueKind;
      title: string;
      description: string;
      entries: AutomationCatalogEntry[];
    }
  | { kind: 'settings' };

interface Props {
  mode: RailMode;
  nodes: CanvasNode[];
  metadata: AutomationMetadata | undefined;
  onClose: () => void;
  onChange: (nodeId: string, configuration: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
  /*
   * The whole entry, not just its name.
   *
   * The custom-field rows all share one subtype and differ only by the field
   * they name, so passing the subtype alone threw away which field "Change
   * Effort to…" meant and left the form asking again for something the click
   * had already said.
   */
  onChoose: (entry: AutomationCatalogEntry) => void;
  rule: AutomationRuleGraph;
  settings: RuleSettings;
  onSettingsChange: (next: Partial<RuleSettings>) => void;
}

/**
 * The panel beside the rule.
 *
 * Beside rather than over: a step only makes sense in the shape it sits in, and
 * a sheet that covers the canvas takes away the thing that explains what is
 * being edited. It also stays put — an overlay that opens and closes on every
 * selection makes the whole page flinch each time somebody clicks a card.
 *
 * Beside stops working somewhere around a thousand pixels, though — see the
 * classes below — and past that it lies over the canvas instead, because a
 * shared row narrow enough leaves the rule too small to be the context it was
 * being kept for.
 *
 * `complementary` rather than `dialog`, even though it is dismissed like one.
 * A dialog role promises modality — that the rest of the screen is inert and
 * focus is held inside — and that is exactly what this panel must not do, since
 * the whole point is to keep clicking cards on the canvas while it is open.
 */
export function NodeConfigRail({
  mode,
  nodes,
  metadata,
  onClose,
  onChange,
  onDelete,
  onChoose,
  rule,
  settings,
  onSettingsChange,
}: Props) {
  const panel = useRef<HTMLElement>(null);
  const open = mode.kind !== 'closed';

  useRailFocus(panel, open, mode.kind === 'configure' ? mode.nodeId : mode.kind);
  useRailDismiss(panel, open, onClose);

  if (mode.kind === 'closed') return null;

  return (
    <aside
      ref={panel}
      // Focusable only on purpose, so opening the panel can put the keyboard
      // in it; a ring around the whole column would be noise.
      tabIndex={-1}
      // Named for what it is showing: "Step settings" while a step is open is
      // wrong when the panel holds the rule's own settings.
      aria-label={mode.kind === 'settings' ? 'Rule settings' : 'Step settings'}
      className={cn(
        /*
         * Wide enough for a form, held in one place.
         *
         * 360px was a column two words wide once a label, a select and its
         * chevron had taken their share — every summary wrapped and the
         * catalogue read as a stack of fragments. Declared once as a variable
         * because the offset below has to be exactly it, and two numbers that
         * must agree eventually stop agreeing.
         */
        '[--rail-width:28rem] max-lg:[--rail-width:min(28rem,calc(100vw-3rem))]',
        /*
         * A surface of its own, so the panel is a place rather than an edge.
         *
         * The canvas is `background` and so was this, which left a 1px border
         * doing all the separating — at a glance the form looked like it was
         * floating on the canvas rather than sitting beside it.
         *
         * Two tokens because no single one separates in both themes. `card` is
         * the same white as `background` in the light theme and would have
         * vanished there; `muted` in the dark theme is 10% brighter than the
         * page and reads as a different application. Measured against the
         * canvas, this pair lands about 3–4% either side in both — recessed
         * against a white page, raised against a dark one, which is the way
         * round each theme expects.
         */
        'flex w-(--rail-width) shrink-0 flex-col overflow-hidden border-l border-border',
        'bg-muted dark:bg-card',
        'outline-none',
        /*
         * Over the canvas rather than beside it, once beside stops working.
         *
         * Below `lg` the row cannot hold both: at 768px sharing it left the
         * rule 408px, which React Flow answers by zooming out to its floor,
         * and a workflow drawn at 0.3× is a row of grey smudges. Pulling the
         * panel back by its own width takes it out of the flex line entirely,
         * so the canvas keeps the full width and can still be panned out from
         * under the panel — the rule stays legible, which is the thing the
         * panel is there to explain.
         */
        'max-lg:z-10 max-lg:ml-[calc(var(--rail-width)*-1)] max-lg:shadow-xl',
        /*
         * Arrives, rather than being there suddenly.
         *
         * Only a nudge and only on the way in. The width itself is never
         * animated: the canvas measures its container to place nodes and refits
         * whenever that changes, so a panel that grew over 150ms would ask it to
         * lay the whole rule out again on every frame of the growing.
         *
         * The element is not rebuilt when the panel changes what it is showing,
         * so this plays on opening and not on every click of a card.
         */
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-150',
      )}
    >
      {mode.kind === 'settings' ? (
        <>
          <RailHeader title="Settings" onClose={onClose} />
          <RuleSettingsPanel rule={rule} settings={settings} onChange={onSettingsChange} />
        </>
      ) : mode.kind === 'choose' ? (
        <ChoosePanel
          catalogue={mode.catalogue}
          title={mode.title}
          description={mode.description}
          entries={mode.entries}
          onClose={onClose}
          onChoose={onChoose}
        />
      ) : (
        /*
         * Not keyed by node.
         *
         * Nothing under here holds state of its own — every field is driven by
         * the node it is handed — so a key bought nothing and cost a teardown:
         * clicking a second card unmounted the whole form and built it again,
         * which threw away the caret, the scroll position, and any select that
         * happened to be open. Reconciled in place it simply changes what it
         * says.
         */
        <ConfigurePanel
          node={nodes.find((node) => node.id === mode.nodeId) ?? null}
          /*
           * Which branch this is, since the breadcrumb names it.
           *
           * Only the first branch is the rule's "Check if"; the panel for any
           * later one has to agree with the card that opened it, or the same
           * step is called two things a click apart.
           */
          alternative={branchRows(nodes).findIndex((row) => row.id === mode.nodeId) > 0}
          metadata={metadata}
          onClose={onClose}
          onChange={onChange}
          onDelete={onDelete}
        />
      )}
    </aside>
  );
}

function RailHeader({
  eyebrow,
  title,
  hint,
  onClose,
  onDelete,
}: {
  /** Where this sits — the kind of step. Above the title, like a breadcrumb. */
  eyebrow?: string;
  title: string;
  /** What this panel is for. Below the title, because it explains it. */
  hint?: string;
  onClose: () => void;
  onDelete?: () => void;
}) {
  return (
    // `shrink-0`: it is the one part of the panel that must stay put, and a
    // flex child squashed by a long body is a heading that scrolls away.
    <header className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="truncate text-xs text-muted-foreground">{eyebrow}</p>}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>

      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 cursor-pointer text-muted-foreground hover:text-destructive"
          aria-label="Delete this step"
          onClick={onDelete}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="size-8 cursor-pointer text-muted-foreground"
        aria-label="Close settings"
        onClick={onClose}
      >
        <PanelRightClose className="size-4" aria-hidden="true" />
      </Button>
    </header>
  );
}

function ConfigurePanel({
  node,
  alternative,
  metadata,
  onClose,
  onChange,
  onDelete,
}: {
  node: CanvasNode | null;
  /** True for a branch after the first, which reads as "Otherwise if". */
  alternative: boolean;
  metadata: AutomationMetadata | undefined;
  onClose: () => void;
  onChange: (nodeId: string, configuration: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
}) {
  const body = useRef<HTMLDivElement>(null);

  /*
   * Back to the top when the step changes, and only then.
   *
   * The panel is reconciled in place now rather than rebuilt, so a form left
   * scrolled halfway down stays halfway down when somebody clicks a different
   * card — which reads as a panel that did not notice. Keyed on the id so
   * typing into a field can never scroll the form out from under the cursor.
   */
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [node?.id]);

  if (!node) return null;

  const category = nodeCategory(node, { alternative });

  return (
    <>
      <RailHeader
        /* A breadcrumb, not a heading: "When… /" says where in the rule this
           step sits, and the title below says which step it is. */
        eyebrow={`${category}… /`}
        title={inspectorTitle(node, metadata)}
        onClose={onClose}
        /*
         * Every step but the trigger. A rule with no trigger is not a rule, and
         * the way to change what starts one is to pick a different trigger
         * rather than to be left holding a rule that cannot start at all.
         */
        {...(node.type === 'TRIGGER' ? {} : { onDelete: () => onDelete(node.id) })}
      />

      <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid gap-4">
          <NodeConfigFields
            node={node}
            metadata={metadata}
            onChange={(configuration) => onChange(node.id, configuration)}
          />
        </div>
      </div>
    </>
  );
}

/**
 * What the panel is about, in its own words.
 *
 * The breadcrumb above already names the kind of step, so this is the
 * particular one. The trigger loses the "When" it would otherwise say twice —
 * "When… / When a task is moved to a section" is a heading stuttering at
 * somebody — and a condition reads as the sentence it currently makes, so
 * changing the operator in the form below changes the heading above it.
 */
function inspectorTitle(node: CanvasNode, metadata: AutomationMetadata | undefined): string {
  if (node.type === 'TRIGGER') {
    if (node.subtype === '') return 'Choose what starts this rule';

    const label = TRIGGER_LABEL[node.subtype as AutomationTrigger] ?? node.subtype;
    const trimmed = label.replace(/^When /, '');

    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  if (node.type === 'CONDITION' || node.type === 'BRANCH') {
    // Without the value: it lives in the control immediately below.
    return summariseCondition(node.configuration, metadata, false);
  }

  return summarise(node, metadata);
}

/** Which half of the action catalogue is showing. */
type CatalogueTab = 'actions' | 'external';

/**
 * Each catalogue's own subtitle, now that they are more than lists.
 *
 * The header, the tabs and the grouped rows are one design, and the sentence
 * under the title is part of it rather than something the page that opened the
 * panel should be deciding. Triggers are absent because theirs depends on what
 * opened it — changing a rule's trigger and choosing one for the first time are
 * not the same sentence — so that one stays the caller's.
 */
const CATALOGUE_HINT: Partial<Record<CatalogueKind, string>> = {
  actions: 'Add an action that occurs as a result of the rule.',
  conditions: 'Choose what this branch checks before its actions run.',
};

/** What the search box calls the things it searches. */
const CATALOGUE_NOUN: Record<CatalogueKind, string> = {
  triggers: 'triggers',
  conditions: 'conditions',
  actions: 'actions',
};

/**
 * Choosing what a step does.
 *
 * Searchable rather than a long menu: there are eleven actions today and there
 * will be more, and a list somebody has to read end to end stops being a list
 * once it passes about seven.
 *
 * Entries that cannot run are shown disabled rather than filtered out. Absence
 * reads as "never considered"; a greyed row with a reason reads as "not yet",
 * which is the truth and saves somebody searching for it twice. The External
 * actions tab is the same convention applied to a whole surface: it is there,
 * and it says it is not ready, rather than being quietly removed so nobody asks.
 */
function ChoosePanel({
  catalogue,
  title,
  description,
  entries,
  onClose,
  onChoose,
}: {
  catalogue: CatalogueKind;
  title: string;
  description: string;
  entries: AutomationCatalogEntry[];
  onClose: () => void;
  onChoose: (entry: AutomationCatalogEntry) => void;
}) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<CatalogueTab>('actions');

  /*
   * Only the action catalogue has a second surface.
   *
   * "External conditions" is not a thing anybody has asked for, and an empty
   * tab beside a list of conditions would be answering a question nobody put.
   */
  const tabbed = catalogue === 'actions';
  const noun = CATALOGUE_NOUN[catalogue];

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();

    /*
     * Matched on everything a person might type.
     *
     * The category and the field name are the two somebody reaches for first —
     * "priority" is a custom field before it is a word in any label, and
     * searching a catalogue for the group heading printed above the row and
     * finding nothing reads as a broken search.
     */
    const matches = entries.filter(
      (entry) =>
        needle === '' ||
        entry.label.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle) ||
        entry.category.toLowerCase().includes(needle) ||
        (entry.fieldName ?? '').toLowerCase().includes(needle),
    );

    // Grouped by the category the API assigns, so the order is the server's
    // rather than whatever the array happened to be in.
    const byGroup = new Map<string, AutomationCatalogEntry[]>();

    for (const entry of matches) {
      const group = entry.category;
      byGroup.set(group, [...(byGroup.get(group) ?? []), entry]);
    }

    return [...byGroup.entries()];
  }, [entries, query]);

  /*
   * The list says it is one.
   *
   * Every row already carried `role="option"`, but an option outside a listbox
   * is owned by nothing, and a screen reader that cannot find the owner reads
   * the rows as plain buttons — losing both the count and the position in it,
   * which is the only thing telling somebody how much catalogue is left below
   * the fold.
   */
  const list = (
    <div role="listbox" aria-label={title} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {groups.length === 0 && (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">
          Nothing matches “{query}”.
        </p>
      )}

      {groups.map(([group, groupEntries]) => (
        <div key={group} role="group" aria-label={group} className="mb-2">
          <p aria-hidden="true" className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {group}
          </p>

          {groupEntries.map((entry) => (
            <CatalogueRow key={entry.subtype} entry={entry} onChoose={onChoose} />
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <RailHeader title={title} hint={CATALOGUE_HINT[catalogue] ?? description} onClose={onClose} />

      {/* `shrink-0` for the same reason as the heading: the search is how a
          long catalogue is navigated, so it cannot be the thing that scrolls
          away when the list gets long. */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${noun}`}
            aria-label={`Search ${noun}`}
            className="pl-8"
            /* Off on the tab with nothing to search. Hidden instead would move
               the tabs up and down as somebody switched between them, and a box
               that quietly ignores typing is the worse of the two. */
            disabled={tab === 'external'}
            autoFocus
          />
        </div>
      </div>

      {!tabbed ? (
        list
      ) : (
        <TabsPrimitive.Root
          value={tab}
          onValueChange={(next) => setTab(next as CatalogueTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsPrimitive.List className="flex shrink-0 gap-4 border-b border-border px-4">
            <CatalogueTabTrigger value="actions">Actions</CatalogueTabTrigger>
            <CatalogueTabTrigger value="external">External actions</CatalogueTabTrigger>
          </TabsPrimitive.List>

          <TabsPrimitive.Content
            value="actions"
            className="flex min-h-0 flex-1 flex-col outline-none"
          >
            {list}
          </TabsPrimitive.Content>

          {/*
            A sentence, and nothing else.

            No external action is implemented, so anything else here would be a
            row that looks like an integration and is not one. The tab exists so
            that "can this talk to anything else?" has an answer other than
            silence.
          */}
          <TabsPrimitive.Content value="external" className="px-4 py-6 outline-none">
            <p className="text-sm text-muted-foreground">
              External actions will be available later.
            </p>
          </TabsPrimitive.Content>
        </TabsPrimitive.Root>
      )}
    </>
  );
}

function CatalogueTabTrigger({ value, children }: { value: CatalogueTab; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      // `-mb-px` so the active underline sits on the list's own border rather
      // than under it, which otherwise draws two lines a pixel apart.
      className={cn(
        '-mb-px cursor-pointer border-b-2 border-transparent px-1 py-2 text-sm font-medium',
        'text-muted-foreground transition-colors hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        'data-[state=active]:border-primary data-[state=active]:text-foreground',
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

/**
 * One offer in the catalogue.
 *
 * An unavailable row is dimmed by its label and its glyph rather than as a
 * whole, because the reason underneath is the half that makes showing it kinder
 * than hiding it — and a reason at half opacity is one nobody reads.
 */
function CatalogueRow({
  entry,
  onChoose,
}: {
  entry: AutomationCatalogEntry;
  onChoose: (entry: AutomationCatalogEntry) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      disabled={!entry.available}
      onClick={() => onChoose(entry)}
      className={cn(
        'flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        entry.available ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed',
      )}
    >
      {/* A tile, not a bare glyph: at 32px the shape is decoration beside the
          label rather than something competing with it for the row. */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
          !entry.available && 'opacity-60',
        )}
      >
        {catalogueIcon(entry.subtype)}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'text-sm font-medium',
            entry.available ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <CatalogueRowLabel entry={entry} />
        </span>

        {/* Only when it adds something. A description equal to the label is two
            lines saying one thing. */}
        {entry.description && entry.description !== entry.label && (
          <span className="text-xs text-muted-foreground">{entry.description}</span>
        )}

        {!entry.available && entry.reason && (
          <span data-slot="catalogue-reason" className="text-xs italic text-muted-foreground">
            {entry.reason}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * The row's wording, with the field it names set apart from it.
 *
 * "Change Priority to…" in one weight is a sentence to read; the same line with
 * the field as a token is a shape to recognise, which is what makes a list of
 * twenty generated entries scannable. The name is looked for inside the label
 * so a server that baked it in and one that supplies it beside the wording both
 * render the same thing.
 */
function CatalogueRowLabel({ entry }: { entry: AutomationCatalogEntry }) {
  const name = entry.fieldName;
  if (!name) return <>{entry.label}</>;

  const at = entry.label.indexOf(name);
  const token = (
    <span
      data-slot="catalogue-field"
      className="mx-0.5 rounded bg-muted px-1 py-0.5 text-xs font-medium text-foreground"
    >
      {name}
    </span>
  );

  if (at < 0) {
    return (
      <>
        {entry.label} {token}
      </>
    );
  }

  return (
    <>
      {entry.label.slice(0, at)}
      {token}
      {entry.label.slice(at + name.length)}
    </>
  );
}
