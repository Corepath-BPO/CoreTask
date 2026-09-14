import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Names a personal copy of the current settings.
 *
 * For somebody who may not change the shared view — a guest, or a member on
 * another person's personal view — this is how a filter they set survives:
 * as their own view, reachable by its link, leaving the shared one alone.
 */
export function SaveViewDialog({
  open,
  pending,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState('My view');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save as my view</DialogTitle>
          <DialogDescription>
            A personal view with these filters, sorts and columns. Only you will see it; the shared
            view stays as it was.
          </DialogDescription>
        </DialogHeader>
        <form
          id="save-view"
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !pending) onSave(name.trim());
          }}
        >
          <Label htmlFor="save-view-name">Name</Label>
          <Input
            id="save-view-name"
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="save-view" disabled={!name.trim()} loading={pending}>
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
