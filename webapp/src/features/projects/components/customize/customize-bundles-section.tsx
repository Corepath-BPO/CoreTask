import {
  BUNDLE_DESCRIPTION_MAX,
  BUNDLE_NAME_MAX,
  BUNDLE_PARTS,
  BUNDLE_PART_LABEL,
  type BundlePart,
} from '@coretask/contracts';
import type { Bundle } from '@coretask/types';
import { Package, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

import {
  useApplyBundle,
  useBundles,
  useCreateBundle,
  useDeleteBundle,
  useDetachBundle,
  useRefreshBundle,
} from '../../hooks/use-bundles';

/** How many of each part this project has — what a new bundle would carry. */
export type BundlePartCounts = Partial<Record<BundlePart, number>>;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** "3 sections · 2 rules · 1 task template" — only the parts it has. */
function contentsLine(bundle: Bundle): string {
  const parts = [
    bundle.sections.length > 0 && plural(bundle.sections.length, 'section'),
    bundle.fields.length > 0 && plural(bundle.fields.length, 'field'),
    bundle.rules.length > 0 && plural(bundle.rules.length, 'rule'),
    bundle.taskTemplates.length > 0 && plural(bundle.taskTemplates.length, 'task template'),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Empty';
}

/**
 * Customize › Bundles: this project's workflow, packaged for other projects —
 * and other projects' bundles, applied here.
 *
 * Applying adds the sections and fields a project lacks and writes the
 * bundle's rules and task templates into it; when the bundle changes, each
 * project syncs to the new version. Removing one takes its rules and templates
 * away and leaves its sections and fields, which may hold work by then.
 */
export function CustomizeBundlesSection({
  workspaceId,
  projectId,
  canManage,
  partCounts,
}: {
  workspaceId: string | undefined;
  projectId: string;
  canManage: boolean;
  partCounts: BundlePartCounts;
}) {
  const { data: bundles, isLoading } = useBundles(workspaceId);
  const apply = useApplyBundle(workspaceId, projectId);
  const detach = useDetachBundle(workspaceId, projectId);
  const refresh = useRefreshBundle(workspaceId, projectId);
  const remove = useDeleteBundle(workspaceId);

  const [creating, setCreating] = useState(false);
  const [detaching, setDetaching] = useState<Bundle | null>(null);
  const [deleting, setDeleting] = useState<Bundle | null>(null);

  const all = bundles ?? [];
  const here = all.filter((bundle) => bundle.projects.some((link) => link.id === projectId));
  const madeHere = all.filter((bundle) => bundle.sourceProject?.id === projectId);
  const others = all.filter(
    (bundle) => !here.includes(bundle) && bundle.sourceProject?.id !== projectId,
  );
  const busy = apply.isPending || detach.isPending || refresh.isPending;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Package this project’s sections, fields, rules and task templates for other projects — and
        keep them in step when they change.
      </p>

      {canManage && (
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus />
          Make a bundle from this project
        </Button>
      )}

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : all.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
          <Package className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No bundles in this workspace yet.</p>
        </div>
      ) : (
        <>
          {here.length > 0 && (
            <BundleGroup title="On this project">
              {here.map((bundle) => {
                const applied =
                  bundle.projects.find((link) => link.id === projectId)?.appliedVersion ?? 0;
                const behind = applied < bundle.version;
                return (
                  <BundleRow key={bundle.id} bundle={bundle}>
                    {behind ? (
                      <Badge variant="outline" className="text-xs">
                        Update available
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Up to date</span>
                    )}
                    {canManage && (
                      <>
                        {behind && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => apply.mutate(bundle.id)}
                          >
                            <RefreshCw />
                            Sync
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto"
                          disabled={busy}
                          onClick={() => setDetaching(bundle)}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </BundleRow>
                );
              })}
            </BundleGroup>
          )}

          {madeHere.length > 0 && (
            <BundleGroup title="Made from this project">
              {madeHere.map((bundle) => (
                <BundleRow key={bundle.id} bundle={bundle}>
                  <span className="text-xs text-muted-foreground">
                    {bundle.projects.length === 0
                      ? 'Not on any project yet'
                      : `On ${plural(bundle.projects.length, 'project')}`}
                    {` · version ${bundle.version}`}
                  </span>
                  {canManage && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => refresh.mutate(bundle.id)}
                        title="Retake the bundle from this project and send it to every project it is on"
                      >
                        <RefreshCw />
                        Send changes out
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => setDeleting(bundle)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </BundleRow>
              ))}
            </BundleGroup>
          )}

          {others.length > 0 && (
            <BundleGroup title="Add a bundle">
              {others.map((bundle) => (
                <BundleRow key={bundle.id} bundle={bundle}>
                  {bundle.sourceProject && (
                    <span className="truncate text-xs text-muted-foreground">
                      From {bundle.sourceProject.name}
                    </span>
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      disabled={busy}
                      onClick={() => apply.mutate(bundle.id)}
                    >
                      Add
                    </Button>
                  )}
                </BundleRow>
              ))}
            </BundleGroup>
          )}
        </>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Make a bundle</DialogTitle>
            <DialogDescription>
              Taken from this project as it is now. Changes here reach other projects when you send
              them out.
            </DialogDescription>
          </DialogHeader>
          {creating && (
            <CreateBundleForm
              workspaceId={workspaceId}
              projectId={projectId}
              partCounts={partCounts}
              onDone={() => setCreating(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={detaching !== null} onOpenChange={(open) => !open && setDetaching(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{detaching?.name}” from this project?</AlertDialogTitle>
            <AlertDialogDescription>
              Its rules and task templates are removed. Its sections and fields stay, with whatever
              work is in them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (detaching) detach.mutate(detaching.id);
                setDetaching(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the bundle “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Projects it is on keep what it added — its rules keep running, as theirs — but stop
              receiving changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) remove.mutate(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BundleGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function BundleRow({ bundle, children }: { bundle: Bundle; children: React.ReactNode }) {
  return (
    <li className="space-y-2 rounded-lg border px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{bundle.name}</p>
        <p className="truncate text-xs text-muted-foreground">{contentsLine(bundle)}</p>
        {bundle.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{bundle.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </li>
  );
}

function CreateBundleForm({
  workspaceId,
  projectId,
  partCounts,
  onDone,
}: {
  workspaceId: string | undefined;
  projectId: string;
  partCounts: BundlePartCounts;
  onDone: () => void;
}) {
  const create = useCreateBundle(workspaceId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parts, setParts] = useState<BundlePart[]>([...BUNDLE_PARTS]);

  const ready = name.trim() !== '' && parts.length > 0 && !create.isPending;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        create.mutate(
          {
            name: name.trim(),
            description: description.trim() || null,
            sourceProjectId: projectId,
            parts,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <Field label="Bundle name" htmlFor="bundle-name">
        <Input
          id="bundle-name"
          value={name}
          maxLength={BUNDLE_NAME_MAX}
          placeholder="e.g. Lease renewal workflow"
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Description" htmlFor="bundle-description">
        <Textarea
          id="bundle-description"
          rows={2}
          value={description}
          maxLength={BUNDLE_DESCRIPTION_MAX}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Include</legend>
        {BUNDLE_PARTS.map((part) => (
          <label key={part} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={parts.includes(part)}
              onCheckedChange={(checked) =>
                setParts((current) =>
                  checked === true
                    ? BUNDLE_PARTS.filter((entry) => entry === part || current.includes(entry))
                    : current.filter((entry) => entry !== part),
                )
              }
            />
            {BUNDLE_PART_LABEL[part]}
            {partCounts[part] !== undefined && (
              <span className="text-xs tabular-nums text-muted-foreground">{partCounts[part]}</span>
            )}
          </label>
        ))}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready}>
          Make bundle
        </Button>
      </DialogFooter>
    </form>
  );
}
