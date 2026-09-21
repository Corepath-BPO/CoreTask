import { CustomFieldType, SystemField, parseCustomFieldRef } from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';

import type { WorkItemRow } from '@/features/work-items/lib/work-item-row';

import { fieldLabel } from './view-fields';
import { ORPHAN_GROUP_ID, groupBySection } from './group-by-section';

/** One heading in the List, or one column on the Board. */
export interface RowGroup {
  /** Unique within the view; a droppable id, never a bare option or user id. */
  id: string;
  /** The value the group stands for — a section id, an option id, a user id — or null for "none". */
  key: string | null;
  name: string;
  color?: { colorToken: string; customColor: string | null } | null;
  /** A section heading keeps its rename and rule controls; a value heading has neither. */
  kind: 'section' | 'value';
  tasks: WorkItemRow[];
}

export const NO_VALUE_KEY = '__none__';

/**
 * The rows of a view, under whatever heading the view asked for.
 *
 * Client-side over the page the API returned, which the API already ordered
 * with the group key first. Every group the vocabulary offers is drawn, empty
 * or not — an empty status column is still somewhere to drop a card — and
 * anything the vocabulary does not know (a ticket's own status in a task
 * status grouping, a legacy enum with no definition) gets a group of its own
 * rather than vanishing.
 */
export function groupRows(
  tasks: WorkItemRow[],
  groupBy: string | null,
  metadata: ProjectFieldMetadata | undefined,
): RowGroup[] {
  if (!groupBy || groupBy === SystemField.SECTION) {
    return groupBySection(tasks, metadata).map((group) => ({
      id: group.id,
      key: group.id === ORPHAN_GROUP_ID ? null : group.id,
      name: group.name,
      kind: 'section',
      tasks: group.tasks as WorkItemRow[],
    }));
  }

  const customId = parseCustomFieldRef(groupBy);
  if (customId) return groupByCustomField(tasks, customId, groupBy, metadata);

  switch (groupBy) {
    case SystemField.STATUS:
      return groupByVocabulary(
        tasks,
        groupBy,
        (metadata?.statuses ?? []).map((status) => ({
          key: status.id,
          name: status.name,
          color: { colorToken: status.colorToken, customColor: null },
        })),
        (row) => row.workItem.status,
        'No status',
      );
    case SystemField.PRIORITY:
      return groupByVocabulary(
        tasks,
        groupBy,
        (metadata?.priorities ?? []).map((priority) => ({
          key: priority.id,
          name: priority.name,
          color: { colorToken: priority.colorToken, customColor: null },
        })),
        (row) => row.workItem.priority,
        'No priority',
      );
    case SystemField.ASSIGNEE:
      return groupByPeople(
        tasks,
        groupBy,
        metadata,
        (row) => row.assignee?.id ?? null,
        'Unassigned',
      );
    case SystemField.CREATED_BY:
      return groupByPeople(tasks, groupBy, metadata, (row) => row.createdById, 'Unknown');
    default:
      // A key this build cannot group by: everything in one heading, named
      // for the field, rather than an empty view.
      return [
        {
          id: `${groupBy}:all`,
          key: null,
          name: fieldLabel(groupBy, metadata),
          kind: 'value',
          tasks,
        },
      ];
  }
}

interface Bucket {
  key: string;
  name: string;
  color?: { colorToken: string; customColor: string | null } | null;
}

/**
 * Statuses and priorities: the project's definitions in their order, then any
 * value a row carries that the definitions do not name (a ticket's, or a
 * legacy enum's), then the rows with none.
 */
function groupByVocabulary(
  tasks: WorkItemRow[],
  groupBy: string,
  known: Bucket[],
  read: (row: WorkItemRow) => { id: string; name: string; colorToken: string } | null,
  noneLabel: string,
): RowGroup[] {
  const buckets = new Map<string, Bucket>(known.map((bucket) => [bucket.key, bucket]));
  const rows = new Map<string, WorkItemRow[]>();
  const none: WorkItemRow[] = [];

  for (const row of tasks) {
    const value = read(row);
    if (!value) {
      none.push(row);
      continue;
    }
    if (!buckets.has(value.id)) {
      buckets.set(value.id, {
        key: value.id,
        name: value.name,
        color: { colorToken: value.colorToken, customColor: null },
      });
    }
    push(rows, value.id, row);
  }

  const groups: RowGroup[] = [...buckets.values()].map((bucket) => ({
    id: `${groupBy}:${bucket.key}`,
    key: bucket.key,
    name: bucket.name,
    color: bucket.color ?? null,
    kind: 'value',
    tasks: rows.get(bucket.key) ?? [],
  }));
  if (none.length > 0) groups.push(noneGroup(groupBy, noneLabel, none));
  return groups;
}

function groupByPeople(
  tasks: WorkItemRow[],
  groupBy: string,
  metadata: ProjectFieldMetadata | undefined,
  read: (row: WorkItemRow) => string | null,
  noneLabel: string,
): RowGroup[] {
  const members = new Map((metadata?.members ?? []).map((member) => [member.id, member.name]));
  const rows = new Map<string, WorkItemRow[]>();
  const none: WorkItemRow[] = [];

  for (const row of tasks) {
    const id = read(row);
    if (!id) none.push(row);
    else push(rows, id, row);
  }

  // Members with rows first, by name — an empty column per member would be
  // a wall of "nobody yet" on any project with a big team.
  const ids = [...rows.keys()].sort((a, b) =>
    (members.get(a) ?? '').localeCompare(members.get(b) ?? ''),
  );
  const groups: RowGroup[] = ids.map((id) => ({
    id: `${groupBy}:${id}`,
    key: id,
    name: members.get(id) ?? 'Former member',
    kind: 'value',
    tasks: rows.get(id) ?? [],
  }));
  if (none.length > 0) groups.push(noneGroup(groupBy, noneLabel, none));
  return groups;
}

function groupByCustomField(
  tasks: WorkItemRow[],
  fieldId: string,
  groupBy: string,
  metadata: ProjectFieldMetadata | undefined,
): RowGroup[] {
  const field = metadata?.customFields.find((entry) => entry.id === fieldId);
  const noneLabel = `No ${field?.name ?? 'value'}`;

  if (field?.type === CustomFieldType.PEOPLE) {
    return groupByPeople(
      tasks,
      groupBy,
      metadata,
      (row) =>
        row.customFieldValues.find((value) => value.customFieldId === fieldId)?.userIds[0] ?? null,
      noneLabel,
    );
  }

  // A single-select: every live option, in order, empty or not, then the
  // rows holding a hidden option, then the rows with none.
  const options = field?.options ?? [];
  const live = options.filter((option) => !option.isArchived);
  const rows = new Map<string, WorkItemRow[]>();
  const none: WorkItemRow[] = [];

  for (const row of tasks) {
    const id = row.customFieldValues.find((value) => value.customFieldId === fieldId)?.optionIds[0];
    if (!id) none.push(row);
    else push(rows, id, row);
  }

  const groups: RowGroup[] = live.map((option) => ({
    id: `${groupBy}:${option.id}`,
    key: option.id,
    name: option.label,
    color: { colorToken: option.colorToken, customColor: option.customColor },
    kind: 'value',
    tasks: rows.get(option.id) ?? [],
  }));
  for (const option of options.filter((entry) => entry.isArchived)) {
    const held = rows.get(option.id);
    if (held?.length) {
      groups.push({
        id: `${groupBy}:${option.id}`,
        key: option.id,
        name: `${option.label} (hidden)`,
        color: { colorToken: option.colorToken, customColor: option.customColor },
        kind: 'value',
        tasks: held,
      });
    }
  }
  if (none.length > 0) groups.push(noneGroup(groupBy, noneLabel, none));
  return groups;
}

function noneGroup(groupBy: string, name: string, tasks: WorkItemRow[]): RowGroup {
  return { id: `${groupBy}:${NO_VALUE_KEY}`, key: null, name, kind: 'value', tasks };
}

function push(map: Map<string, WorkItemRow[]>, key: string, row: WorkItemRow): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(row);
  else map.set(key, [row]);
}
