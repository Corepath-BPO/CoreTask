import { NODE_CATEGORY_LABEL, type AutomationNodeType } from '@coretask/contracts';
import type {
  AutomationCatalogEntry,
  AutomationMetadata,
  AutomationRuleGraph,
} from '@coretask/types';
import { PanelRightClose, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { CanvasNode } from '../lib/graph-edits';
import { summarise } from '../lib/node-summary';

import { NodeConfigFields } from './node-config-fields';
import { useRailDismiss, useRailFocus } from './rail-behaviour';
import { RuleSettingsPanel, type RuleSettings } from './rule-settings-panel';

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
  | { kind: 'choose'; title: string; description: string; entries: AutomationCatalogEntry[] }
  | { kind: 'settings' };

interface Props {
  mode: RailMode;
  nodes: CanvasNode[];
  metadata: AutomationMetadata | undefined;
  onClose: () => void;
  onChange: (nodeId: string, configuration: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
  onChoose: (subtype: string) => void;
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
        'flex w-(--rail-width) shrink-0 flex-col overflow-hidden border-l border-border bg-background',
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
  metadata,
  onClose,
  onChange,
  onDelete,
}: {
  node: CanvasNode | null;
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

  const category = NODE_CATEGORY_LABEL[node.type as AutomationNodeType] ?? 'Step';

  return (
    <>
      <RailHeader
        eyebrow={category}
        title={summarise(node, metadata)}
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
 * Choosing what a step does.
 *
 * Searchable rather than a long menu: there are eleven actions today and there
 * will be more, and a list somebody has to read end to end stops being a list
 * once it passes about seven.
 *
 * Entries that cannot run are shown disabled rather than filtered out. Absence
 * reads as "never considered"; a greyed row with a reason reads as "not yet",
 * which is the truth and saves somebody searching for it twice.
 */
function ChoosePanel({
  title,
  description,
  entries,
  onClose,
  onChoose,
}: {
  title: string;
  description: string;
  entries: AutomationCatalogEntry[];
  onClose: () => void;
  onChoose: (subtype: string) => void;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const matches = entries.filter(
      (entry) =>
        needle === '' ||
        entry.label.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle),
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

  return (
    <>
      <RailHeader title={title} hint={description} onClose={onClose} />

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
            placeholder="Search actions"
            aria-label="Search actions"
            className="pl-8"
            autoFocus
          />
        </div>
      </div>

      {/*
        The list says it is one.

        Every row already carried `role="option"`, but an option outside a
        listbox is owned by nothing, and a screen reader that cannot find the
        owner reads the rows as plain buttons — losing both the count and the
        position in it, which is the only thing telling somebody how much
        catalogue is left below the fold.
      */}
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
              <button
                key={entry.subtype}
                type="button"
                role="option"
                aria-selected={false}
                disabled={!entry.available}
                onClick={() => onChoose(entry.subtype)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                  entry.available
                    ? 'cursor-pointer hover:bg-muted'
                    : 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="text-sm font-medium text-foreground">{entry.label}</span>
                {/* Only when it adds something. A description equal to the
                    label is two lines saying one thing. */}
                {entry.description && entry.description !== entry.label && (
                  <span className="text-xs text-muted-foreground">{entry.description}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
