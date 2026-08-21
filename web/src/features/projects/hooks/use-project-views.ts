import type {
  CustomField,
  UpdateCustomFieldPayload,
  UpdateProjectViewPayload,
  ViewSettings,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import {
  customFieldsApi,
  projectViewsApi,
  type ViewTaskQuery,
} from '../api/project-views.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
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
 * The tasks behind a view.
 *
 * `query` is spread into the key rather than passed by reference: an object
 * literal rebuilt on every render is a new key every render, which puts the
 * query into a refetch loop. That is what caused the 429 storm on the
 * dashboard, and it is invisible until the network tab is open.
 */
export function useViewTasks(
  workspaceId: string | undefined,
  projectId: string,
  query: ViewTaskQuery,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.projectViews.tasks(workspaceId ?? '', projectId),
      query.page ?? 1,
      query.search ?? '',
      JSON.stringify(query.filters ?? []),
      JSON.stringify(query.sorts ?? []),
    ],
    queryFn: () => projectViewsApi.queryTasks(workspaceId as string, projectId, query),
    enabled: Boolean(workspaceId),
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
    },
    onError: (error) => reportError(error, 'Could not add that field.'),
  });
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
    },
    onError: (error) => reportError(error, 'Could not create the field.'),
  });
}

export interface EditFieldOptionDraft {
  /** The stored option's id, or null for one added in the editor. */
  id: string | null;
  label: string;
  colorToken: string;
}

export interface EditFieldChanges {
  field: CustomField;
  name: string;
  description: string;
  isRequired: boolean;
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
    mutationFn: async ({ field, name, description, isRequired, options }: EditFieldChanges) => {
      const ws = workspaceId as string;

      const fieldPatch: UpdateCustomFieldPayload = {};
      if (name !== field.name) fieldPatch.name = name;
      if (description !== (field.description ?? '')) fieldPatch.description = description || null;
      if (isRequired !== field.isRequired) fieldPatch.isRequired = isRequired;
      if (Object.keys(fieldPatch).length > 0) {
        await customFieldsApi.update(ws, projectId, field.id, fieldPatch);
      }

      if (!options) return;

      const live = field.options
        .filter((option) => !option.isArchived)
        .sort((a, b) => a.position - b.position);
      const byId = new Map(live.map((option) => [option.id, option]));
      const keptIds = new Set(options.map((option) => option.id).filter(Boolean));

      // Removals first, so a rename onto a removed option's label cannot
      // collide with it.
      for (const existing of live) {
        if (!keptIds.has(existing.id)) {
          await customFieldsApi.removeOption(ws, projectId, field.id, existing.id);
        }
      }

      for (const draft of options) {
        if (!draft.id) continue;
        const existing = byId.get(draft.id);
        if (!existing) continue;
        const patch: { label?: string; colorToken?: string } = {};
        if (draft.label !== existing.label) patch.label = draft.label;
        if (draft.colorToken !== existing.colorToken) patch.colorToken = draft.colorToken;
        if (Object.keys(patch).length > 0) {
          await customFieldsApi.updateOption(ws, projectId, field.id, draft.id, patch);
        }
      }

      // Additions land at the end server-side; the response names the new id,
      // which the reorder pass below needs.
      for (const draft of options) {
        if (draft.id) continue;
        const known = new Set(
          [...byId.keys(), ...options.map((entry) => entry.id).filter(Boolean)] as string[],
        );
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
        ...live.filter((option) => keptIds.has(option.id)).map((option) => option.id),
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
    },
    onError: (error) => reportError(error, 'Could not save the field.'),
  });
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
