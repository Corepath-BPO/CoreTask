import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface TaskComposerProps {
  onCreate: (title: string) => void;
  pending?: boolean;
  label?: string;
}

/**
 * Inline "add a task" control for a board column.
 *
 * A textarea rather than an input so a long title wraps instead of scrolling
 * out of view, with Enter submitting and Shift+Enter allowed for a line break.
 */
export function TaskComposer({ onCreate, pending = false, label = 'Add task' }: TaskComposerProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  const submit = () => {
    const next = title.trim();
    if (next === '') {
      setOpen(false);
      return;
    }

    onCreate(next);
    setTitle('');
    // Stays open: adding one task usually means adding several.
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full justify-start text-muted-foreground"
      >
        <Plus />
        {label}
      </Button>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-dashed p-2">
      <Textarea
        autoFocus
        rows={2}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
          if (event.key === 'Escape') {
            setTitle('');
            setOpen(false);
          }
        }}
        placeholder="What needs doing?"
        aria-label="New task title"
        className="min-h-0 resize-none text-sm"
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">Enter to add · Escape to close</p>
        <Button size="sm" onClick={submit} disabled={!title.trim() || pending}>
          Add
        </Button>
      </div>
    </div>
  );
}
