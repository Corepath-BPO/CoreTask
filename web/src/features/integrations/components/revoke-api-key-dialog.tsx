import type { ApiKey } from '@coretask/types';

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

import { useRevokeApiKey } from '../hooks/use-api-keys';

interface RevokeApiKeyDialogProps {
  apiKey: ApiKey | null;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
}

export function RevokeApiKeyDialog({ apiKey, onOpenChange, workspaceId }: RevokeApiKeyDialogProps) {
  const revoke = useRevokeApiKey(workspaceId);

  const confirm = () => {
    if (!apiKey) return;
    revoke.mutate(apiKey.id, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <AlertDialog open={apiKey !== null} onOpenChange={(open) => !open && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke “{apiKey?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Anything using this key stops working immediately. Work it created keeps its name in the
            history. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={revoke.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={revoke.isPending}>
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
