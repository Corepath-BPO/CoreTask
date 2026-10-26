import type { AuthUser } from '@coretask/types';
import { ImageUp, Trash2 } from 'lucide-react';
import { useRef } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { Button } from '@/components/ui/button';

import { useRemoveAvatar, useUploadAvatar } from '../hooks/use-avatar';

/**
 * The picture beside your name everywhere. Any image the browser can open
 * will do: it is cropped to a square from the middle and made small before
 * it leaves the device.
 */
export function ProfilePicture({ user }: { user: AuthUser }) {
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const input = useRef<HTMLInputElement>(null);
  const busy = upload.isPending || remove.isPending;

  return (
    <div className="flex items-center gap-4">
      <PersonAvatar
        name={user.name}
        avatarUrl={user.avatarUrl}
        className="size-16"
        fallbackClassName="text-lg"
      />
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={upload.isPending}
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {!upload.isPending && <ImageUp />}
            {user.avatarUrl ? 'Change picture' : 'Upload picture'}
          </Button>
          {user.avatarUrl && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={remove.isPending}
              disabled={busy}
              onClick={() => remove.mutate()}
            >
              {!remove.isPending && <Trash2 />}
              Remove picture
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          A square from the middle of it shows beside your name.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        aria-label="Choose a profile picture"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again still fires a change.
          event.target.value = '';
          if (file) upload.mutate(file);
        }}
      />
    </div>
  );
}
