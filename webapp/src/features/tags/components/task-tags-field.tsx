import { MAX_TAGS_PER_TASK, TAG_NAME_MAX, tagNameKey } from '@coretask/contracts';
import type { TagRef } from '@coretask/types';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorDot } from '@/features/colors/components/semantic-badge';

import { useAddTaskTag, useRemoveTaskTag, useTags } from '../hooks/use-tags';

import { TagChip } from './tag-chip';

/**
 * The task panel's Tags row: the task's tags, each removable, and a picker
 * that finds a workspace tag as you type — or makes one from what you typed.
 */
export function TaskTagsField({
  workspaceId,
  taskId,
  tags,
  canEdit,
}: {
  workspaceId: string | undefined;
  taskId: string;
  tags: readonly TagRef[];
  canEdit: boolean;
}) {
  const add = useAddTaskTag(workspaceId, taskId);
  const remove = useRemoveTaskTag(workspaceId, taskId);
  const full = tags.length >= MAX_TAGS_PER_TASK;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
      {tags.map((tag) => (
        <TagChip
          key={tag.id}
          tag={tag}
          {...(canEdit ? { onRemove: () => remove.mutate(tag.id) } : {})}
        />
      ))}
      {tags.length === 0 && !canEdit && (
        <span className="text-sm text-muted-foreground">No tags</span>
      )}
      {canEdit && !full && (
        <TagPicker
          workspaceId={workspaceId}
          taken={tags}
          pending={add.isPending}
          onPick={(payload) => add.mutate(payload)}
        />
      )}
    </div>
  );
}

function TagPicker({
  workspaceId,
  taken,
  pending,
  onPick,
}: {
  workspaceId: string | undefined;
  taken: readonly TagRef[];
  pending: boolean;
  onPick: (payload: { tagId: string } | { name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const { data: all } = useTags(open ? workspaceId : undefined);

  const takenIds = new Set(taken.map((tag) => tag.id));
  const choices = (all ?? []).filter((tag) => !takenIds.has(tag.id));
  const typed = text.trim().replace(/\s+/g, ' ').slice(0, TAG_NAME_MAX);
  const exists = (all ?? []).some((tag) => tagNameKey(tag.name) === tagNameKey(typed));

  const pick = (payload: { tagId: string } | { name: string }) => {
    onPick(payload);
    setText('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground"
          disabled={pending}
          aria-label="Add a tag"
        >
          <Plus />
          Add tag
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput
            value={text}
            onValueChange={setText}
            placeholder="Find or make a tag…"
            maxLength={TAG_NAME_MAX}
          />
          <CommandList>
            {choices.length > 0 && (
              <CommandGroup heading="Tags">
                {choices.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={`${tag.name} ${tag.id}`}
                    onSelect={() => pick({ tagId: tag.id })}
                  >
                    <ColorDot color={{ colorToken: tag.color }} />
                    <span className="flex-1 truncate">{tag.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {tag.taskCount}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {typed && !exists && (
              // Group and item both forced: cmdk hides a group whose items it filtered out.
              <CommandGroup forceMount>
                {/* Always shown while typing: cmdk would filter it out otherwise. */}
                <CommandItem
                  value={`create ${typed}`}
                  forceMount
                  onSelect={() => pick({ name: typed })}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Create “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
            {!typed && choices.length === 0 && (
              <CommandEmpty>Type a name to make the first tag.</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
