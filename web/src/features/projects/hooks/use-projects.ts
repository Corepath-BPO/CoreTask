import type {
  CreateProjectPayload,
  CreateSectionPayload,
  ProjectDetail,
  Section,
  UpdateProjectPayload,
} from '@coretask/types';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { projectsApi, sectionsApi, type ProjectListParams } from '../api/projects.api';

export function useProjects(workspaceId: string | undefined, params: ProjectListParams) {
  return useQuery({
    queryKey: queryKeys.projects.list(workspaceId ?? '', params as Record<string, unknown>),
    queryFn: () => projectsApi.list(workspaceId as string, params),
    enabled: Boolean(workspaceId),
    // Keeps the previous page on screen while the next one loads, so paging and
    // filtering do not blank the grid.
    placeholderData: keepPreviousData,
  });
}

export function useProject(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projects.detail(workspaceId ?? '', projectId),
    queryFn: () => projectsApi.get(workspaceId as string, projectId),
    enabled: Boolean(workspaceId) && Boolean(projectId),
  });
}

/** Invalidates every project query for a workspace after a mutation. */
function invalidateProjects(workspaceId: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(workspaceId) });
}

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

export function useCreateProject(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateProjectPayload) =>
      projectsApi.create(workspaceId as string, payload),
    onSuccess: async (project) => {
      await invalidateProjects(workspaceId as string);
      toast.success(`Project "${project.name}" created`, {
        description: `Key ${project.key} · ${project.sections.length} sections ready`,
      });
    },
    onError: (error) => reportError(error, 'Could not create the project.'),
  });
}

export function useUpdateProject(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: UpdateProjectPayload }) =>
      projectsApi.update(workspaceId as string, projectId, payload),
    onSuccess: async (project) => {
      await invalidateProjects(workspaceId as string);
      toast.success(`Project "${project.name}" updated`);
    },
    onError: (error) => reportError(error, 'Could not update the project.'),
  });
}

export function useArchiveProject(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ projectId, archived }: { projectId: string; archived: boolean }) =>
      archived
        ? projectsApi.restore(workspaceId as string, projectId)
        : projectsApi.archive(workspaceId as string, projectId),
    onSuccess: async (project) => {
      await invalidateProjects(workspaceId as string);
      toast.success(
        project.archivedAt
          ? `Project "${project.name}" archived`
          : `Project "${project.name}" restored`,
      );
    },
    onError: (error) => reportError(error, 'Could not change the project status.'),
  });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** Rewrites the sections inside a cached project detail. */
function patchSections(
  workspaceId: string,
  projectId: string,
  update: (sections: Section[]) => Section[],
) {
  queryClient.setQueryData<ProjectDetail>(
    queryKeys.projects.detail(workspaceId, projectId),
    (previous) =>
      previous
        ? { ...previous, sections: update(previous.sections), sectionCount: previous.sectionCount }
        : previous,
  );
}

/**
 * Everything that draws this project's sections, refreshed together.
 *
 * The Board reads them from the project detail; the List reads them from field
 * metadata, under an unrelated key. Only `useRenameSection` ever invalidated
 * both, so adding, deleting or reordering a section updated the Board and left
 * the List showing the arrangement from before — the same one-sided staleness
 * this whole upgrade is about, in a corner nobody had checked.
 */
async function invalidateProjectSections(workspaceId: string, projectId: string): Promise<void> {
  await Promise.all([
    invalidateProjects(workspaceId),
    queryClient.invalidateQueries({
      queryKey: queryKeys.projectViews.metadata(workspaceId, projectId),
    }),
  ]);
}

export function useCreateSection(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (payload: CreateSectionPayload) =>
      sectionsApi.create(workspaceId as string, projectId, payload),
    onSuccess: async () => {
      await invalidateProjectSections(workspaceId as string, projectId);
    },
    onError: (error) => reportError(error, 'Could not add the section.'),
  });
}

export function useRenameSection(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ sectionId, name }: { sectionId: string; name: string }) =>
      sectionsApi.update(workspaceId as string, projectId, sectionId, { name }),
    onSuccess: async (section) => {
      patchSections(workspaceId as string, projectId, (sections) =>
        sections.map((existing) => (existing.id === section.id ? section : existing)),
      );

      /*
       * The List view reads section names from field metadata, not from the
       * sections query patched above — and that query is cached for a minute.
       * Without this, renaming a section from the List view left the old name
       * on screen until the cache went stale.
       */
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.metadata(workspaceId as string, projectId),
      });
    },
    onError: (error) => reportError(error, 'Could not rename the section.'),
  });
}

export function useDeleteSection(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (sectionId: string) =>
      sectionsApi.remove(workspaceId as string, projectId, sectionId),
    onSuccess: async (result) => {
      await invalidateProjectSections(workspaceId as string, projectId);
      toast.success(
        result.reassignedTaskCount > 0
          ? `Section deleted · ${result.reassignedTaskCount} task${result.reassignedTaskCount === 1 ? '' : 's'} moved to the first column`
          : 'Section deleted',
      );
    },
    onError: (error) => reportError(error, 'Could not delete the section.'),
  });
}

/**
 * Reorders a section, applying the new order optimistically.
 *
 * A drag that snaps back before the request lands feels broken, so the cache is
 * updated first and rolled back only if the server rejects the move.
 */
export function useMoveSection(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({
      sectionId,
      afterSectionId,
    }: {
      sectionId: string;
      afterSectionId: string | null;
      optimistic: Section[];
    }) => sectionsApi.move(workspaceId as string, projectId, sectionId, { afterSectionId }),

    onMutate: async ({ optimistic }) => {
      const key = queryKeys.projects.detail(workspaceId as string, projectId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<ProjectDetail>(key);
      patchSections(workspaceId as string, projectId, () => optimistic);

      return { previous };
    },

    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.projects.detail(workspaceId as string, projectId),
          context.previous,
        );
      }
      reportError(error, 'Could not reorder the sections.');
    },

    // The server's positions are authoritative — a rebalance may have renumbered
    // siblings the optimistic update left alone.
    onSuccess: async (sections) => {
      patchSections(workspaceId as string, projectId, () => sections);

      // The List reads its groups from field metadata, so patching the project
      // detail alone reorders the Board and leaves the List as it was.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.metadata(workspaceId as string, projectId),
      });
    },
  });
}
