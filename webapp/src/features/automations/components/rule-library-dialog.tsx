import type { AutomationTemplate } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import {
  LibraryBig,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatRelativeTime } from '@/lib/utils';

import {
  useApplyTemplate,
  useAutomationTemplates,
  useRemoveTemplate,
} from '../hooks/use-automation-templates';
import { STARTER_TEMPLATES, type StarterTemplate } from '../lib/starter-templates';
import { describeUnresolved, summariseTemplate } from '../lib/template-summary';

import { SaveToLibraryDialog, type LibraryTarget } from './save-to-library-dialog';

/**
 * The rule library, opened from a project.
 *
 * Every template in the workspace, with what each one does read off its steps
 * rather than its name. Choosing one starts a draft in *this* project and opens
 * it in the builder — a draft, because the template's sections and fields were
 * another project's, and whatever could not be matched by name is left for the
 * person to choose before the rule can run.
 *
 * Managing the library happens here too, behind each card's menu, rather than
 * on a page of its own: the moment somebody notices a template is misnamed is
 * the moment they are looking at it to use it.
 */
export function RuleLibraryDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  canManage,
  sectionId,
  sectionName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  /** Where a chosen template becomes a draft. */
  projectId: string;
  canManage: boolean;
  /** Set when opened from a section, so a section-scoped trigger watches it. */
  sectionId?: string;
  /** The section's name, for the sentence that says so. */
  sectionName?: string;
}) {
  const navigate = useNavigate();
  const templates = useAutomationTemplates(workspaceId, open);
  const apply = useApplyTemplate(workspaceId, projectId);
  const remove = useRemoveTemplate(workspaceId);

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<LibraryTarget | null>(null);
  const [pendingRemove, setPendingRemove] = useState<AutomationTemplate | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const cards = useMemo(
    () =>
      (templates.data ?? []).map((template) => ({
        template,
        summary: summariseTemplate(template),
      })),
    [templates.data],
  );

  /*
   * Filtered on what is on the card, so anything somebody can see they can
   * search for — the trigger's words included, since "moved to a section" is
   * how a rule is remembered more often than by its title.
   */
  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? cards.filter(({ template, summary }) =>
        [
          template.name,
          template.description ?? '',
          summary.trigger,
          ...summary.steps.map((step) => step.label),
          template.sourceProject?.name ?? '',
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle),
      )
    : cards;

  /*
   * Starters are offered to anyone who could build the rule by hand. They
   * create nothing until the builder saves, so there is no write to guard.
   */
  const showStarters = canManage;
  const visibleStarters = needle
    ? STARTER_TEMPLATES.filter((starter) =>
        `${starter.name} ${starter.description}`.toLocaleLowerCase().includes(needle),
      )
    : STARTER_TEMPLATES;

  const startFromStarter = (starter: StarterTemplate) => {
    onOpenChange(false);
    void navigate({
      to: '/projects/$projectId/automations/new',
      params: { projectId },
      search: { starter: starter.key, ...(sectionId ? { sectionId } : {}) },
    });
  };

  const use = (template: AutomationTemplate) => {
    setApplyingId(template.id);

    apply.mutate(
      { templateId: template.id, ...(sectionId ? { sectionId } : {}) },
      {
        onSuccess: (applied) => {
          onOpenChange(false);

          /*
           * Said here rather than in the hook, because what to say depends on
           * the answer. A clean match is a draft to look over; an unmatched
           * section is a draft with a blank in it, and the blank is the news.
           */
          const gaps = describeUnresolved(applied.unresolved);
          if (gaps) {
            toast.warning(`Started “${template.name}” as a draft.`, {
              description: gaps,
              duration: 12_000,
            });
          } else {
            toast.success(`Started “${template.name}” as a draft.`, {
              description: 'Check it over, then publish it when it reads right.',
            });
          }

          void navigate({
            to: '/projects/$projectId/automations/$ruleId',
            params: { projectId, ruleId: applied.rule.id },
            search: {},
          });
        },
        onSettled: () => setApplyingId(null),
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="flex items-center gap-2">
              <LibraryBig className="size-4 text-primary" aria-hidden="true" />
              Rule library
            </DialogTitle>
            <DialogDescription>
              Rules saved from any project in this workspace. Start from one and it opens as a draft
              in this project, with anything the project lacks left for you to choose.
              {sectionName ? ` A template that watches a section will watch “${sectionName}”.` : ''}
            </DialogDescription>
          </DialogHeader>

          {(cards.length > 0 || showStarters) && (
            <div className="border-b px-6 py-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search the library"
                  aria-label="Search the library"
                  className="pl-8"
                />
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {templates.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-24 w-full rounded-lg" />
                ))}
              </div>
            ) : templates.isError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                The library could not be loaded.{' '}
                <button
                  type="button"
                  className="font-medium underline underline-offset-4"
                  onClick={() => void templates.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <section className="space-y-2">
                  {showStarters && <SectionHeading>Saved in this workspace</SectionHeading>}
                  {cards.length === 0 ? (
                    <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                      {canManage
                        ? 'Nothing saved yet. Open any rule’s menu and choose “Save to library”, and it will appear here for every project in this workspace.'
                        : 'A workspace manager can save any rule here for every project to start from.'}
                    </p>
                  ) : visible.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nothing saved matches “{query.trim()}”.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {visible.map(({ template, summary }) => (
                        <li
                          key={template.id}
                          className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20"
                        >
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">{template.name}</p>
                              {template.description && (
                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                  {template.description}
                                </p>
                              )}

                              {/* The rule, as a sentence: the trigger, then each step
                            in the order it runs. */}
                              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="inline-flex items-center gap-1 font-medium">
                                  <Zap
                                    className="size-3.5 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                  {summary.trigger}
                                </span>
                                {summary.steps.map((step, index) => (
                                  <span key={index} className="inline-flex items-center gap-1.5">
                                    <span aria-hidden="true" className="text-muted-foreground">
                                      →
                                    </span>
                                    <span
                                      className={cn(
                                        'rounded-md border px-1.5 py-0.5',
                                        step.kind === 'action'
                                          ? 'border-border bg-muted/60'
                                          : 'border-dashed border-border text-muted-foreground',
                                      )}
                                    >
                                      {step.label}
                                    </span>
                                  </span>
                                ))}
                              </div>

                              <p className="mt-2 text-[11px] text-muted-foreground">
                                {[
                                  template.sourceProject
                                    ? `From ${template.sourceProject.name}`
                                    : null,
                                  template.createdBy
                                    ? `Saved by ${template.createdBy.name} ${formatRelativeTime(template.createdAt)}`
                                    : `Saved ${formatRelativeTime(template.createdAt)}`,
                                  template.useCount === 0
                                    ? 'Not used yet'
                                    : `Used ${template.useCount} ${template.useCount === 1 ? 'time' : 'times'}`,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>

                            {canManage && (
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  size="sm"
                                  className="cursor-pointer"
                                  loading={applyingId === template.id}
                                  disabled={apply.isPending}
                                  onClick={() => use(template)}
                                >
                                  <Plus className="size-4" aria-hidden="true" />
                                  Use template
                                </Button>

                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8"
                                      aria-label={`Options for ${template.name}`}
                                    >
                                      <MoreHorizontal className="size-4" aria-hidden="true" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        setEditing({
                                          kind: 'template',
                                          templateId: template.id,
                                          name: template.name,
                                          description: template.description,
                                        })
                                      }
                                    >
                                      <Pencil className="size-4" aria-hidden="true" />
                                      Edit name and description
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() => setPendingRemove(template)}
                                    >
                                      <Trash2 className="size-4" aria-hidden="true" />
                                      Remove from library
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {showStarters && (
                  <section className="space-y-2">
                    <SectionHeading>Starters</SectionHeading>
                    <p className="text-xs text-muted-foreground">
                      Common rules to begin from. Each opens in the builder with its blanks left for
                      you to fill.
                    </p>
                    {visibleStarters.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No starter matches “{query.trim()}”.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                        {visibleStarters.map((starter) => (
                          <li
                            key={starter.key}
                            className="flex items-center gap-3 bg-card px-4 py-3"
                          >
                            <Sparkles
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{starter.name}</p>
                              <p className="text-xs text-muted-foreground">{starter.description}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0 cursor-pointer"
                              onClick={() => startFromStarter(starter)}
                            >
                              Use
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <SaveToLibraryDialog
        workspaceId={workspaceId}
        target={editing}
        onOpenChange={(isOpen) => !isOpen && setEditing(null)}
      />

      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(isOpen) => !isOpen && setPendingRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{pendingRemove?.name}” from the library?</AlertDialogTitle>
            <AlertDialogDescription>
              Rules already started from it keep working. Nobody will be able to start a new one
              from it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRemove) remove.mutate(pendingRemove.id);
                setPendingRemove(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The two groups' titles, kept quieter than the cards under them. */
function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}
