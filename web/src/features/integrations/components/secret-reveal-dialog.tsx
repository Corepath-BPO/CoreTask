import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { SecretReveal } from './secret-reveal';

interface SecretRevealDialogProps {
  secret: string | null;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** What the secret is, for the field label and button names. */
  label: string;
}

/** A secret shown once after an action such as rotating it; closing forgets it. */
export function SecretRevealDialog({
  secret,
  onOpenChange,
  title,
  description,
  label,
}: SecretRevealDialogProps) {
  return (
    <Dialog open={secret !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {secret && <SecretReveal secret={secret} label={label} id="revealed-secret" />}

        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Copy it now — it won’t be shown again.</span>
        </p>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
