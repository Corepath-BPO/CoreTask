import {
  ACTION_LABEL,
  AI_DRAFT_PROMPT_MAX,
  TRIGGER_LABEL,
  type AutomationAction,
} from '@coretask/contracts';
import type { AutomationTemplate } from '@coretask/types';
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowUp, Loader2, LockKeyhole, Search, Sparkles, X, Zap } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useProject } from '@/features/projects/hooks/use-projects';
import { useProjectAccess } from '@/features/projects/lib/project-access';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { ApiError } from '@/lib/api/api-error';

import { useAutomationMetadata } from '../builder/hooks/use-automation-graph';
import { useAutomationTemplates } from '../hooks/use-automation-templates';
import { useDraftAutomation } from '../hooks/use-draft-automation';
import { useStartFromTemplate } from '../hooks/use-start-from-template';
import { rankByWords } from '../lib/gallery-search';
import { STARTER_TEMPLATES, type StarterTemplate } from '../lib/starter-templates';
import { summariseTemplate } from '../lib/template-summary';

import { ActionIcon } from './action-icon';
import { TriggerIcon } from './trigger-icon';

const PROMPT = 'What do you want to automate?';

const starterText = (starter: StarterTemplate) =>
  [
    starter.name,
    starter.description,
    TRIGGER_LABEL[starter.trigger],
    ...starter.steps.map((step) => ACTION_LABEL[step.subtype as AutomationAction] ?? ''),
  ].join(' ');

/** The first thing a template does, for its card's second icon. */
const firstAction = (template: AutomationTemplate) =>
  template.nodes.find((node) => node.nodeType === 'ACTION')?.subtype;

/**
 * Adding a rule, laid out as Asana's "Add automation" page: what do you want
 * to automate, Start from scratch, and a gallery of rules to begin from.
 *
 * The box does two things with what is typed. As it is typed, it ranks the
 * starters and the workspace's saved rules by the words they share, so
 * "assign tasks when they move to a section" brings "Assign whoever owns a
 * section" to the top. Sent, it asks AI to write the rule, as Asana's box
 * does — offered only where the server has a model set up — and opens the
 * builder on what came back. Nothing is created here: a starter or a drafted
 * rule opens in the builder unsaved; a saved rule becomes a draft in this
 * project, as from the library.
 *
 * Over the whole screen and on its own address, like the builder. Closing
 * goes back to wherever it was opened from.
 */
export function AddAutomationDialog({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: project } = useProject(workspaceId, projectId);
  const canManage = useProjectAccess(project).canManage;

  const templates = useAutomationTemplates(workspaceId, canManage);
  const startFrom = useStartFromTemplate(workspaceId, projectId);
  // The builder's own metadata, which it reads next anyway; `ai` says whether
  // this server can draft a rule at all.
  const { data: metadata } = useAutomationMetadata(workspaceId, projectId);
  const canDraft = metadata?.capabilities?.ai === true;
  const drafting = useDraftAutomation(workspaceId, projectId);
  const [query, setQuery] = useState('');
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const close = () => {
    if (canGoBack) router.history.back();
    else
      void navigate({ to: '/projects/$projectId/automations', params: { projectId }, search: {} });
  };

  const openBuilder = (starter?: string) =>
    void navigate({
      to: '/projects/$projectId/automations/new',
      params: { projectId },
      search: starter ? { starter } : {},
    });

  /*
   * The sentence, drafted into a rule and opened in the builder unsaved. The
   * draft rides in the history entry rather than the address — it is the whole
   * rule — and anything the sentence asked for that did not make it in is said
   * as the builder opens, since the canvas cannot show what is missing.
   */
  const draftRule = () => {
    const prompt = query.trim();
    if (!canDraft || prompt === '' || drafting.isPending) return;

    drafting.mutate(
      { prompt },
      {
        onSuccess: (draft) => {
          if (draft.notes.length > 0) {
            toast.warning('Some of that is not in the rule.', {
              description: draft.notes.join(' '),
              duration: 12_000,
            });
          }
          void navigate({
            to: '/projects/$projectId/automations/new',
            params: { projectId },
            search: {},
            state: { automationDraft: draft },
          });
        },
      },
    );
  };

  const draftError = drafting.isError
    ? drafting.error instanceof ApiError
      ? drafting.error.message
      : 'The rule could not be drafted. Try again.'
    : null;

  const saved = useMemo(
    () =>
      (templates.data ?? []).map((template) => ({
        template,
        summary: summariseTemplate(template),
      })),
    [templates.data],
  );

  const starters = rankByWords(STARTER_TEMPLATES, query, starterText);
  const savedShown = rankByWords(saved, query, ({ template, summary }) =>
    [
      template.name,
      template.description ?? '',
      summary.trigger,
      ...summary.steps.map((step) => step.label),
      template.sourceProject?.name ?? '',
    ].join(' '),
  );

  const searching = query.trim() !== '';
  const savedReady = !templates.isLoading && !templates.isError;
  const nothingFound = searching && starters.length === 0 && savedReady && savedShown.length === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="left-0 top-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        onOpenAutoFocus={(event) => {
          // Straight into the question, as Asana does, not onto the close button.
          if (!promptRef.current) return;
          event.preventDefault();
          promptRef.current.focus();
        }}
      >
        <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border px-4 py-2.5">
          <span />
          <DialogTitle className="text-base font-semibold">Add automation</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 cursor-pointer justify-self-end"
            aria-label="Close"
            onClick={close}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
            {project === undefined ? (
              <Skeleton className="mx-auto h-40 w-full max-w-xl rounded-xl" />
            ) : !canManage ? (
              <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
                <LockKeyhole className="size-6 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Only the people who manage this project can add automations to it.
                </p>
                <Button variant="outline" size="sm" onClick={close}>
                  Close
                </Button>
              </div>
            ) : (
              <>
                <section className="mx-auto flex max-w-xl flex-col items-center text-center">
                  <Zap className="size-8 text-primary" aria-hidden="true" />
                  <h2 className="mt-3 text-xl font-semibold">{PROMPT}</h2>

                  <div className="mt-5 w-full rounded-xl border border-border bg-card p-3 text-left transition-shadow focus-within:ring-[3px] focus-within:ring-ring/40">
                    <textarea
                      ref={promptRef}
                      value={query}
                      rows={2}
                      maxLength={AI_DRAFT_PROMPT_MAX}
                      aria-label={PROMPT}
                      placeholder={
                        canDraft
                          ? 'When a task moves to Week 1, assign it to Sam'
                          : 'Assign tasks when they move to a section'
                      }
                      onChange={(event) => {
                        setQuery(event.target.value);
                        // What was wrong was about the last sentence, not this one.
                        if (drafting.isError) drafting.reset();
                      }}
                      // A question, not a document: Enter sends it, or has nothing to add.
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                        event.preventDefault();
                        draftRule();
                      }}
                      className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {drafting.isPending ? (
                        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                      ) : canDraft ? (
                        <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <Search className="size-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span className="flex-1" aria-live="polite">
                        {drafting.isPending
                          ? 'Drafting your rule…'
                          : canDraft
                            ? 'Send to draft it with AI, or pick a match below.'
                            : 'Finds the starters and saved rules that do it.'}
                      </span>
                      {searching && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 cursor-pointer px-2 text-xs"
                          disabled={drafting.isPending}
                          onClick={() => setQuery('')}
                        >
                          Clear
                        </Button>
                      )}
                      {canDraft && (
                        <Button
                          size="icon"
                          className="size-7 shrink-0 cursor-pointer rounded-full"
                          aria-label="Draft with AI"
                          aria-busy={drafting.isPending}
                          disabled={!searching || drafting.isPending}
                          onClick={draftRule}
                        >
                          <ArrowUp className="size-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {draftError && (
                    <p role="alert" className="mt-2 w-full text-left text-xs text-destructive">
                      {draftError}
                    </p>
                  )}

                  <div
                    className="my-5 flex w-full max-w-xs items-center gap-3 text-xs text-muted-foreground"
                    aria-hidden="true"
                  >
                    <span className="h-px flex-1 bg-border" />
                    OR
                    <span className="h-px flex-1 bg-border" />
                  </div>

                  <Button
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => openBuilder()}
                  >
                    Start from scratch
                  </Button>
                </section>

                {nothingFound && (
                  <p className="mt-12 text-center text-sm text-muted-foreground">
                    Nothing here does that yet. Start from scratch to build it.
                  </p>
                )}

                {starters.length > 0 && (
                  <GallerySection
                    title="Featured"
                    description="Rules most projects end up writing. Each opens in the builder with its blanks left for you to fill."
                  >
                    {starters.map((starter) => (
                      <GalleryCard
                        key={starter.key}
                        trigger={starter.trigger}
                        action={starter.steps.find((step) => step.type === 'ACTION')?.subtype}
                        title={starter.name}
                        line={starter.description}
                        onSelect={() => openBuilder(starter.key)}
                      />
                    ))}
                  </GallerySection>
                )}

                {(!searching || !savedReady || savedShown.length > 0) && (
                  <GallerySection
                    title="Saved in this workspace"
                    description="Rules saved to the library from any project. Starting one makes a draft here."
                  >
                    {templates.isLoading ? (
                      Array.from({ length: 4 }, (_, index) => (
                        <Skeleton key={index} className="h-36 rounded-xl" />
                      ))
                    ) : templates.isError ? (
                      <GalleryNote>
                        The library could not be loaded.{' '}
                        <button
                          type="button"
                          className="font-medium underline underline-offset-4"
                          onClick={() => void templates.refetch()}
                        >
                          Try again
                        </button>
                      </GalleryNote>
                    ) : saved.length === 0 ? (
                      <GalleryNote>
                        Nothing saved yet. Choose “Save to library” on any rule, and it shows here
                        for every project in this workspace.
                      </GalleryNote>
                    ) : (
                      savedShown.map(({ template, summary }) => (
                        <GalleryCard
                          key={template.id}
                          trigger={template.triggerType}
                          action={firstAction(template)}
                          title={template.name}
                          line={
                            template.description ??
                            [summary.trigger, ...summary.steps.map((step) => step.label)].join(
                              ' → ',
                            )
                          }
                          {...(template.sourceProject
                            ? { footer: `From ${template.sourceProject.name}` }
                            : {})}
                          busy={startFrom.startingId === template.id}
                          disabled={startFrom.isPending}
                          onSelect={() => startFrom.start(template)}
                        />
                      ))
                    )}
                  </GallerySection>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GallerySection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-12" aria-label={title}>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function GalleryNote({ children }: { children: ReactNode }) {
  return (
    <p className="col-span-full rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * A rule to begin from: what sets it off ⚡ what it does, its name, and a line.
 * The whole card is the button, as on Asana's page.
 */
function GalleryCard({
  trigger,
  action,
  title,
  line,
  footer,
  busy = false,
  disabled = false,
  onSelect,
}: {
  trigger: string;
  action: string | undefined;
  title: string;
  line: string;
  footer?: string;
  busy?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-busy={busy}
      className="flex h-full cursor-pointer flex-col items-center gap-2 rounded-xl border border-border bg-card px-4 py-5 text-center transition-colors hover:border-foreground/20 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-wait disabled:opacity-60"
    >
      <span className="flex items-center gap-1.5" aria-hidden="true">
        <span className="flex size-7 items-center justify-center rounded-md bg-muted">
          <TriggerIcon triggerType={trigger} className="text-foreground" />
        </span>
        <Zap className="size-3 text-primary" />
        {action && (
          <span className="flex size-7 items-center justify-center rounded-md bg-muted">
            <ActionIcon action={action} className="text-foreground" />
          </span>
        )}
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="line-clamp-3 text-xs text-muted-foreground">{line}</span>
      {footer && <span className="mt-auto pt-1 text-[11px] text-muted-foreground">{footer}</span>}
      {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
    </button>
  );
}
