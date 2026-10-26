import {
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABEL,
  StatusCategory,
  WorkspaceRole,
  hasAtLeastRole,
  type ColorToken,
} from '@coretask/contracts';
import { ArrowDown, ArrowUp, Archive, ArchiveRestore, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ColorTokenPicker } from '@/features/colors/components/color-token-picker';
import { ColorDot } from '@/features/colors/components/semantic-badge';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { formatDate } from '@/lib/utils/format';

import { ProjectFormDialog } from '../components/project-form-dialog';
import {
  useDeletePriority,
  useDeleteStatus,
  usePriorities,
  useProjectStatuses,
  useReorderPriorities,
  useReorderStatuses,
  useSavePriority,
  useSaveStatus,
} from '../hooks/use-definitions';
import { useArchiveProject, useProject } from '../hooks/use-projects';
import { useProjectAccess } from '../lib/project-access';

/**
 * A project's Settings tab: its details, the statuses its tasks move through,
 * the workspace's priorities, and archiving. Statuses and priorities are a
 * manager's to change — they are what every board, rule and report reads.
 */
export function ProjectSettingsPage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: project } = useProject(workspaceId, projectId);
  const access = useProjectAccess(project);
  const canDefine = hasAtLeastRole(
    (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole,
    WorkspaceRole.MANAGER,
  );

  if (!project) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
      <DetailsCard workspaceId={workspaceId} canEdit={access.canManage} project={project} />
      <StatusesCard workspaceId={workspaceId} projectId={projectId} canEdit={canDefine} />
      <PrioritiesCard workspaceId={workspaceId} canEdit={canDefine} />
      {access.canManage && <ArchiveCard workspaceId={workspaceId} project={project} />}
    </div>
  );
}

type ProjectValue = NonNullable<ReturnType<typeof useProject>['data']>;

function DetailsCard({
  workspaceId,
  project,
  canEdit,
}: {
  workspaceId: string | undefined;
  project: ProjectValue;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const rows: [string, ReactNode][] = [
    ['Name', project.name],
    ['Key', <span className="font-mono">{project.key}</span>],
    [
      'Colour',
      <span
        className="inline-block size-3 rounded-sm align-middle"
        style={{ backgroundColor: project.color }}
        aria-label={project.color}
      />,
    ],
    ['Privacy', project.visibility === 'PRIVATE' ? 'Private to its members' : 'Workspace'],
    ['Start date', project.startDate ? formatDate(project.startDate) : '—'],
    ['Due date', project.dueDate ? formatDate(project.dueDate) : '—'],
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Details</CardTitle>
          <CardDescription>What the project is called, and when it runs.</CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil />
            Edit details
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate">{value}</dd>
            </div>
          ))}
        </dl>
        {project.description && (
          <p className="mt-3 line-clamp-4 text-sm whitespace-pre-line text-muted-foreground">
            {project.description
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()}
          </p>
        )}
      </CardContent>
      {workspaceId && (
        <ProjectFormDialog
          open={editing}
          onOpenChange={setEditing}
          workspaceId={workspaceId}
          project={project}
        />
      )}
    </Card>
  );
}

interface DefinitionItem {
  id: string;
  name: string;
  colorToken: string;
  isDefault: boolean;
  isArchived: boolean;
  category?: StatusCategory;
}

function StatusesCard({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string | undefined;
  projectId: string;
  canEdit: boolean;
}) {
  const { data: statuses, isLoading } = useProjectStatuses(workspaceId, projectId);
  const save = useSaveStatus(workspaceId, projectId);
  const remove = useDeleteStatus(workspaceId, projectId);
  const reorder = useReorderStatuses(workspaceId, projectId);
  const ownSet = (statuses ?? []).some((status) => status.projectId === projectId);

  return (
    <DefinitionCard
      title="Task statuses"
      description={
        ownSet
          ? 'This project keeps its own statuses.'
          : 'This project uses the workspace’s statuses; changing one gives it its own copy.'
      }
      noun="status"
      items={statuses}
      isLoading={isLoading}
      canEdit={canEdit}
      withCategory
      busy={save.isPending || remove.isPending || reorder.isPending}
      onSave={(id, draft) => save.mutate({ ...(id ? { statusId: id } : {}), draft })}
      onDelete={(id) => remove.mutate(id)}
      onReorder={(ids) => reorder.mutate(ids)}
    />
  );
}

function PrioritiesCard({
  workspaceId,
  canEdit,
}: {
  workspaceId: string | undefined;
  canEdit: boolean;
}) {
  const { data: priorities, isLoading } = usePriorities(workspaceId);
  const save = useSavePriority(workspaceId);
  const remove = useDeletePriority(workspaceId);
  const reorder = useReorderPriorities(workspaceId);
  const nextLevel = Math.min(
    100,
    Math.max(0, ...(priorities ?? []).map((priority) => priority.level)) + 1,
  );

  return (
    <DefinitionCard
      title="Priorities"
      description="Shared by every project in the workspace."
      noun="priority"
      items={priorities}
      isLoading={isLoading}
      canEdit={canEdit}
      busy={save.isPending || remove.isPending || reorder.isPending}
      onSave={(id, draft) =>
        save.mutate(id ? { priorityId: id, draft } : { draft: { ...draft, level: nextLevel } })
      }
      onDelete={(id) => remove.mutate(id)}
      onReorder={(ids) => reorder.mutate(ids)}
    />
  );
}

interface Draft {
  name?: string;
  colorToken?: string;
  category?: StatusCategory;
  isArchived?: boolean;
}

/** A list of named, coloured values: rename, recolour, reorder, archive, delete, add. */
function DefinitionCard({
  title,
  description,
  noun,
  items,
  isLoading,
  canEdit,
  withCategory = false,
  busy,
  onSave,
  onDelete,
  onReorder,
}: {
  title: string;
  description: string;
  noun: string;
  items: DefinitionItem[] | undefined;
  isLoading: boolean;
  canEdit: boolean;
  withCategory?: boolean;
  busy: boolean;
  onSave: (id: string | null, draft: Draft) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [adding, setAdding] = useState('');
  const [category, setCategory] = useState<StatusCategory>(StatusCategory.NOT_STARTED);
  const list = items ?? [];

  const move = (index: number, by: -1 | 1) => {
    const ids = list.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + by, 0, moved);
    onReorder(ids);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description}
          {!canEdit && ' Only a manager can change them.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ul className="divide-y rounded-lg border" aria-label={title}>
            {list.map((item, index) => (
              <DefinitionRow
                key={item.id}
                item={item}
                noun={noun}
                canEdit={canEdit}
                busy={busy}
                withCategory={withCategory}
                first={index === 0}
                last={index === list.length - 1}
                onSave={(draft) => onSave(item.id, draft)}
                onDelete={() => onDelete(item.id)}
                onMove={(by) => move(index, by)}
              />
            ))}
          </ul>
        )}

        {canEdit && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = adding.trim();
              if (!name) return;
              onSave(null, { name, ...(withCategory ? { category } : {}) });
              setAdding('');
            }}
          >
            <Input
              value={adding}
              maxLength={60}
              aria-label={`New ${noun}`}
              placeholder={`New ${noun}…`}
              className="h-8 min-w-0 flex-1"
              onChange={(event) => setAdding(event.target.value)}
            />
            {withCategory && (
              <CategorySelect
                value={category}
                onChange={setCategory}
                label={`New ${noun}'s category`}
              />
            )}
            <Button type="submit" size="sm" disabled={!adding.trim() || busy}>
              <Plus />
              Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function DefinitionRow({
  item,
  noun,
  canEdit,
  busy,
  withCategory,
  first,
  last,
  onSave,
  onDelete,
  onMove,
}: {
  item: DefinitionItem;
  noun: string;
  canEdit: boolean;
  busy: boolean;
  withCategory: boolean;
  first: boolean;
  last: boolean;
  onSave: (draft: Draft) => void;
  onDelete: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(item.name);

  const commit = () => {
    setRenaming(false);
    const next = name.trim();
    if (next && next !== item.name) onSave({ name: next });
    else setName(item.name);
  };

  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      {canEdit ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Colour of ${item.name}`}
              className="flex size-6 items-center justify-center rounded hover:bg-muted"
            >
              <ColorDot color={{ colorToken: item.colorToken }} className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <ColorTokenPicker
              value={item.colorToken as ColorToken}
              onChange={(colorToken) => onSave({ colorToken })}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <ColorDot color={{ colorToken: item.colorToken }} className="mx-1.5 size-3" />
      )}

      {renaming ? (
        <Input
          value={name}
          autoFocus
          maxLength={60}
          aria-label={`Rename ${item.name}`}
          className="h-7 min-w-0 flex-1"
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setName(item.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setRenaming(true)}
          className="min-w-0 flex-1 truncate rounded px-1 text-left text-sm hover:bg-muted disabled:hover:bg-transparent"
          aria-label={canEdit ? `Rename ${item.name}` : undefined}
        >
          <span className={item.isArchived ? 'text-muted-foreground line-through' : undefined}>
            {item.name}
          </span>
        </button>
      )}

      {item.isDefault && <Badge variant="muted">Default</Badge>}

      {withCategory && item.category && (
        <CategorySelect
          value={item.category}
          disabled={!canEdit || busy}
          label={`Category of ${item.name}`}
          onChange={(category) => onSave({ category })}
        />
      )}

      {canEdit && (
        <span className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${item.name} up`}
            disabled={first || busy}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${item.name} down`}
            disabled={last || busy}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={item.isArchived ? `Restore ${item.name}` : `Archive ${item.name}`}
            title={item.isArchived ? 'Restore' : `Archive: kept on tasks, not offered for new ones`}
            disabled={busy || item.isDefault}
            onClick={() => onSave({ isArchived: !item.isArchived })}
          >
            {item.isArchived ? <ArchiveRestore /> : <Archive />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${item.name}`}
            title={`Only a ${noun} no task uses can be deleted`}
            disabled={busy || item.isDefault}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </span>
      )}
    </li>
  );
}

function CategorySelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: StatusCategory;
  onChange: (value: StatusCategory) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        // Radix sends '' when its options change; that is not a choice.
        if (next && next !== value) onChange(next as StatusCategory);
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="h-7 w-32 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_CATEGORIES.filter((category) => category !== StatusCategory.ARCHIVED).map(
          (category) => (
            <SelectItem key={category} value={category}>
              {STATUS_CATEGORY_LABEL[category]}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );
}

function ArchiveCard({
  workspaceId,
  project,
}: {
  workspaceId: string | undefined;
  project: ProjectValue;
}) {
  const archive = useArchiveProject(workspaceId);
  const archived = project.archivedAt !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{archived ? 'Restore project' : 'Archive project'}</CardTitle>
        <CardDescription>
          {archived
            ? 'Bring it back to the projects list and its members’ sidebars.'
            : 'It leaves the projects list and search; its tasks and history are kept.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant={archived ? 'outline' : 'destructive'} disabled={archive.isPending}>
              {archived ? <ArchiveRestore /> : <Archive />}
              {archived ? 'Restore project' : 'Archive project'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {archived ? `Restore “${project.name}”?` : `Archive “${project.name}”?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {archived
                  ? 'It comes back exactly as it was.'
                  : 'You can restore it later from here or from the archived projects list.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => archive.mutate({ projectId: project.id, archived })}
              >
                {archived ? 'Restore' : 'Archive'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
