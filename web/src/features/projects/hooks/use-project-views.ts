import {
  ProjectViewScope,
  WorkspaceRole,
  hasAtLeastRole,
  type ProjectViewType,
} from '@coretask/contracts';
import type {
  CreateProjectViewPayload,
  CustomField,
  ProjectView,
  RemoveFieldMode,
  UpdateCustomFieldPayload,
  UpdateProjectViewPayload,
  ViewSettings,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { automationKeys } from '@/features/automations/hooks/use-automations';
import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { customFieldsApi, projectViewsApi } from '../api/project-views.api';
import { DEFAULT_VIEW_SETTINGS } from '../lib/view-settings';

export { DEFAULT_VIEW_SETTINGS };

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * Tells the automation builder the project's fields changed.
 *
 * Its catalogue — "⟨Field⟩ is changed", "⟨Field⟩ is…", "Change ⟨Field⟩ to…" —
 * is generated from this project's fields and cached for minutes, and nothing
 * on this side used to tell it when one was added. A field created on the
 * list view then stayed missing from the trigger picker until the cache aged
 * out, which read as "checkboxes cannot start a rule" rather than as a stale
 * list.
 */
function forgetAutomationCatalogue(workspaceId: string, projectId: string) {
  return queryClient.invalidateQueries({
    queryKey: automationKeys.metadata(workspaceId, projectId),
  });
}

export function useProjectViews(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectViews.all(workspaceId ?? '', projectId),
    queryFn: () => projectViewsApi.list(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
  });
}

export function useFieldMetadata(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectViews.metadata(workspaceId ?? '', projectId),
    queryFn: () => projectViewsApi.fieldMetadata(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
    // Fields, statuses and members change far less often than tasks do, and
    // every cell render reads this.
    staleTime: 60_000,
  });
}

/**
 * A parent's subtasks, fetched the first time its row is expanded.
 *
 * `enabled` is the whole point: most rows are never opened, and fetching every
 * task's children with the page would multiply the payload for something nobody
 * asked to see. Once fetched the result stays cached, so collapsing and
 * reopening a row costs nothing.
 */
export function useSubtasks(
  workspaceId: string | undefined,
  projectId: string,
  taskId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.projectViews.subtasks(workspaceId ?? '', projectId, taskId),
    queryFn: () => projectViewsApi.subtasks(workspaceId as string, projectId, taskId),
    enabled: Boolean(workspaceId) && enabled,
  });
}

/**
 * The add-field picker's catalog, re-fetched as somebody types.
 *
 * `visible` is deliberately not in the query key. It changes the marks on the
 * response, not which rows come back, and putting an array rebuilt every render
 * into a key is what put the dashboard into a refetch loop once already.
 */
export function useFieldCatalog(
  workspaceId: string | undefined,
  projectId: string,
  search: string,
  visible: string[],
  enabled: boolean,
  includeArchived = false,
) {
  return useQuery({
    // `includeArchived` is in the key because it changes which rows come back;
    // `visible` is not, because it only changes the marks on them.
    queryKey: [
      ...queryKeys.projectViews.catalog(workspaceId ?? '', projectId, search),
      includeArchived,
    ],
    queryFn: () =>
      projectViewsApi.fieldCatalog(workspaceId as string, projectId, {
        search,
        visible,
        includeArchived,
      }),
    enabled: Boolean(workspaceId) && enabled,
    // The catalog is small and cheap; keeping the previous answer on screen
    // while the next one loads stops the list flickering on every keystroke.
    placeholderData: (previous) => previous,
  });
}

/** Puts an existing workspace field to work on this project. */
export function useAttachField(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (fieldId: string) =>
      customFieldsApi.attach(workspaceId as string, projectId, fieldId),
    onSuccess: async () => {
      toast.success('Field added to this project.');
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.all(workspaceId as string, projectId),
      });
      await forgetAutomationCatalogue(workspaceId as string, projectId);
    },
    onError: (error) => reportError(error, 'Could not add that field.'),
  });
}

export function useCreateProjectView(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (payload: CreateProjectViewPayload) =>
      projectViewsApi.create(workspaceId as string, projectId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.all(workspaceId as string, projectId),
      });
    },
    onError: (error) => reportError(error, 'Could not save the view.'),
  });
}

/**
 * Whether this person may write to this view.
 *
 * The API's own rule, mirrored: a personal view is its owner's, a shared view
 * is any member's. Guests and viewers of somebody else's view get a draft they
 * can save as their own instead.
 */
export function canPersistView(
  view: ProjectView | undefined,
  meId: string | undefined,
  role: WorkspaceRole,
): boolean {
  if (!view) return false;
  if (view.scope === ProjectViewScope.PERSONAL) return view.ownerUserId === meId;
  return hasAtLeastRole(role, WorkspaceRole.MEMBER);
}

/**
 * Which of a project's views of one type is open.
 *
 * `?view=<id>` wins when it names a view of this type; otherwise the type's
 * default, otherwise the first. That gives "Save as my view" somewhere to
 * land, and a link to a personal view something to open.
 */
export function useActiveView(
  views: ProjectView[] | undefined,
  type: ProjectViewType,
  viewId: string | undefined,
): ProjectView | undefined {
  return useMemo(() => {
    const ofType = (views ?? []).filter((view) => view.type === type);
    return (
      ofType.find((view) => view.id === viewId) ??
      ofType.find((view) => view.isDefault) ??
      ofType[0]
    );
  }, [views, type, viewId]);
}

const SAVE_DELAY_MS = 400;

/**
 * The view's settings as the toolbar edits them.
 *
 * A change applies to the draft at once — the query reads the draft, so the
 * rows refetch immediately — and is written to the server 400 ms after the
 * last change, so dragging a slider or ticking three boxes is one PATCH. On
 * failure the draft reverts to what the server holds and a toast says so.
 *
 * With `canPersist` false the draft stays local and `dirty` stays true, which
 * is what offers "Save as my view" to somebody who may not change this one.
 *
 * The draft does not re-sync from the server while a save is pending: a
 * refetch arriving mid-edit must not overwrite what is being typed.
 */
export function useViewSettingsEditor({
  workspaceId,
  projectId,
  view,
  canPersist,
}: {
  workspaceId: string | undefined;
  projectId: string;
  view: ProjectView | undefined;
  canPersist: boolean;
}): {
  settings: ViewSettings;
  update: (patch: Partial<ViewSettings>) => void;
  dirty: boolean;
  saving: boolean;
  revert: () => void;
} {
  const [draft, setDraft] = useState<ViewSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ViewSettings | null>(null);
  const draftRef = useRef<ViewSettings | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const stored = view?.settings ?? DEFAULT_VIEW_SETTINGS;
  const settings = draft ?? stored;

  // A fresh copy from the server replaces the draft, unless a save is still
  // on its way — then the draft is newer than anything the server has.
  const viewId = view?.id;
  const updatedAt = view?.updatedAt;
  useEffect(() => {
    if (pending.current === null && timer.current === null) setDraft(null);
  }, [viewId, updatedAt]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flush = async () => {
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next || !view || !workspaceId) return;

    setSaving(true);
    try {
      const saved = await projectViewsApi.update(workspaceId, projectId, view.id, {
        settings: next,
      });
      queryClient.setQueryData<ProjectView[]>(
        queryKeys.projectViews.all(workspaceId, projectId),
        (views) => views?.map((entry) => (entry.id === saved.id ? saved : entry)),
      );
      // Only the draft that was saved is released; a newer one keeps going.
      if (pending.current === null && draftRef.current === next) setDraft(null);
    } catch (error) {
      pending.current = null;
      setDraft(null);
      reportError(error, 'Could not save the view.');
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<ViewSettings>) => {
    const next = { ...(draftRef.current ?? stored), ...patch };
    setDraft(next);
    if (!canPersist || !view) return;

    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored);

  return { settings, update, dirty, saving, revert: () => setDraft(null) };
}

export function useUpdateProjectView(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ viewId, payload }: { viewId: string; payload: UpdateProjectViewPayload }) =>
      projectViewsApi.update(workspaceId as string, projectId, viewId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.all(workspaceId as string, projectId),
      });
    },
    onError: (error) => reportError(error, 'Could not save the view.'),
  });
}

/**
 * Persists a settings change to the server.
 *
 * Column choices belong in PostgreSQL rather than localStorage: someone who
 * arranges a view on a laptop expects the same arrangement on a second machine,
 * and a shared view has to look the same to everyone who opens it.
 */
export function useSaveViewSettings(workspaceId: string | undefined, projectId: string) {
  const update = useUpdateProjectView(workspaceId, projectId);

  return (viewId: string, settings: ViewSettings) =>
    update.mutate({ viewId, payload: { settings } });
}

export function useCreateCustomField(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (payload: Parameters<typeof customFieldsApi.create>[2]) =>
      customFieldsApi.create(workspaceId as string, projectId, payload),
    onSuccess: async () => {
      toast.success('Field created.');
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.metadata(workspaceId as string, projectId),
      });
      await forgetAutomationCatalogue(workspaceId as string, projectId);
    },
    onError: (error) => reportError(error, 'Could not create the field.'),
  });
}

export interface EditFieldOptionDraft {
  /** The stored option's id, or null for one added in the editor. */
  id: string | null;
  label: string;
  colorToken: string;
  /** Hidden from the pickers — Asana's "hide option". */
  isArchived?: boolean;
}

export interface EditFieldChanges {
  field: CustomField;
  name: string;
  description: string;
  isRequired: boolean;
  notifyOnChange: boolean;
  /** The whole settings document as the form now has it; compared to the stored one. */
  settings: Record<string, unknown>;
  /** Final option list in display order; null for types without options. */
  options: EditFieldOptionDraft[] | null;
}

/**
 * Applies an edit-field form as the set of API calls it implies.
 *
 * The API models a field edit as separate operations — rename the field, patch
 * an option, add one, remove one — because each has its own rules (an option in
 * use is archived, not deleted). The form models it as "here is how the field
 * should look". This hook is the translation: it diffs the form against the
 * stored field and issues only the calls that changed something.
 */
export function useEditCustomField(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: async ({
      field,
      name,
      description,
      isRequired,
      notifyOnChange,
      settings,
      options,
    }: EditFieldChanges) => {
      const ws = workspaceId as string;

      const fieldPatch: UpdateCustomFieldPayload = {};
      if (name !== field.name) fieldPatch.name = name;
      if (description !== (field.description ?? '')) fieldPatch.description = description || null;
      if (isRequired !== field.isRequired) fieldPatch.isRequired = isRequired;
      if (notifyOnChange !== field.notifyOnChange) fieldPatch.notifyOnChange = notifyOnChange;
      // The whole document or nothing: the API replaces settings rather than
      // merging them, so a partial patch would drop every key not named.
      if (!sameSettings(settings, field.settings)) fieldPatch.settings = settings;
      if (Object.keys(fieldPatch).length > 0) {
        await customFieldsApi.update(ws, projectId, field.id, fieldPatch);
      }

      if (!options) return;

      // Archived options included: the form can unhide one, and a hidden
      // option left out of the form is not a removal.
      const stored = [...field.options].sort((a, b) => a.position - b.position);
      const byId = new Map(stored.map((option) => [option.id, option]));
      const keptIds = new Set(options.map((option) => option.id).filter(Boolean));

      // Removals first, so a rename onto a removed option's label cannot
      // collide with it.
      for (const existing of stored) {
        if (!keptIds.has(existing.id)) {
          await customFieldsApi.removeOption(ws, projectId, field.id, existing.id);
        }
      }

      for (const draft of options) {
        if (!draft.id) continue;
        const existing = byId.get(draft.id);
        if (!existing) continue;
        const patch: { label?: string; colorToken?: string; isArchived?: boolean } = {};
        if (draft.label !== existing.label) patch.label = draft.label;
        if (draft.colorToken !== existing.colorToken) patch.colorToken = draft.colorToken;
        if ((draft.isArchived ?? false) !== existing.isArchived) {
          patch.isArchived = draft.isArchived ?? false;
        }
        if (Object.keys(patch).length > 0) {
          await customFieldsApi.updateOption(ws, projectId, field.id, draft.id, patch);
        }
      }

      // Additions land at the end server-side; the response names the new id,
      // which the reorder pass below needs.
      for (const draft of options) {
        if (draft.id) continue;
        const known = new Set([
          ...byId.keys(),
          ...options.map((entry) => entry.id).filter(Boolean),
        ] as string[]);
        const updated = await customFieldsApi.addOption(ws, projectId, field.id, {
          label: draft.label,
          colorToken: draft.colorToken,
        });
        const created = updated.options.find(
          (option) => !option.isArchived && !known.has(option.id),
        );
        if (created) draft.id = created.id;
      }

      // What the order would be with no reordering: survivors as stored, then
      // additions in the order they were made. Anything else needs positions
      // written — all of them, so old fractional positions cannot interleave.
      const baseline = [
        ...stored.filter((option) => keptIds.has(option.id)).map((option) => option.id),
        ...options.filter((option) => !byId.has(option.id ?? '')).map((option) => option.id),
      ];
      const desired = options.map((option) => option.id);
      if (desired.some((id, index) => id !== null && id !== baseline[index])) {
        for (let index = 0; index < options.length; index++) {
          const id = options[index]?.id;
          if (!id) continue;
          await customFieldsApi.updateOption(ws, projectId, field.id, id, { position: index });
        }
      }
    },
    onSuccess: async () => {
      toast.success('Field updated.');
      // The prefix reaches the metadata every cell reads, the catalog, and the
      // task pages whose chips draw these options.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.all(workspaceId as string, projectId),
      });
      // A renamed field or a new option is a different catalogue row.
      await forgetAutomationCatalogue(workspaceId as string, projectId);
    },
    onError: (error) => reportError(error, 'Could not save the field.'),
  });
}

/**
 * Takes a field off the project — detached, deleted, or archived when tasks
 * hold values.
 *
 * The toast reports what actually happened rather than what was asked for: a
 * mis-click is easy to recreate, a column of data is not, so "delete" on a
 * field with values archives it, and saying "deleted" then would send somebody
 * hunting for data that is actually safe.
 */
export function useRemoveCustomField(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ fieldId, mode }: { fieldId: string; mode?: RemoveFieldMode }) =>
      customFieldsApi.remove(workspaceId as string, projectId, fieldId, mode),
    onSuccess: async (result) => {
      toast.success(
        result.deleted
          ? 'Field deleted from the workspace.'
          : result.archived
            ? 'Field archived — tasks hold values for it, so the data is kept. Restore it from the library.'
            : 'Field removed from this project. It stays in the library.',
      );
      // The prefix reaches the metadata every cell reads, the catalog, and the
      // views whose columns may have shown the field.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.all(workspaceId as string, projectId),
      });
      await forgetAutomationCatalogue(workspaceId as string, projectId);
    },
    onError: (error) => reportError(error, 'Could not remove the field.'),
  });
}

/** Brings an archived field back to the library, values and all. */
export function useRestoreCustomField(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (fieldId: string) => customFieldsApi.restore(workspaceId as string, fieldId),
    onSuccess: async () => {
      toast.success('Field restored. Add it to a project to use it again.');
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.all(workspaceId as string, projectId),
      });
      await forgetAutomationCatalogue(workspaceId as string, projectId);
    },
    onError: (error) => reportError(error, 'Could not restore the field.'),
  });
}

/** Key-by-key, so `{a:1,b:2}` and `{b:2,a:1}` are the same document. */
function sameSettings(a: Record<string, unknown>, b: Record<string, unknown> | undefined): boolean {
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = Object.entries(b ?? {}).filter(([, value]) => value !== undefined);
  if (left.length !== right.length) return false;
  const rightMap = new Map(right);
  return left.every(([key, value]) => JSON.stringify(rightMap.get(key)) === JSON.stringify(value));
}

export function useSetCustomFieldValue(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({
      taskId,
      fieldId,
      value,
    }: {
      taskId: string;
      fieldId: string;
      value: Record<string, unknown>;
    }) => customFieldsApi.setValue(workspaceId as string, taskId, fieldId, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.tasks(workspaceId as string, projectId),
      });
    },
    onError: (error) => reportError(error, 'Could not save that value.'),
  });
}
