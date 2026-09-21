import type { ApiKey } from '@coretask/types';
import { KeyRound, MoreHorizontal, Pencil, ShieldOff } from 'lucide-react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime, humanizeEnum } from '@/lib/utils';

interface ApiKeyTableProps {
  apiKeys: ApiKey[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (apiKey: ApiKey) => void;
  onRevoke: (apiKey: ApiKey) => void;
}

const HEADERS = ['Key', 'Role', 'Created', 'Last used', 'Status', ''] as const;

export function ApiKeyTable({ apiKeys, isLoading, onCreate, onEdit, onRevoke }: ApiKeyTableProps) {
  if (!isLoading && apiKeys.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title="No API keys yet"
        description="Create one for n8n or another tool. It gets its own account, so the history says which tool did what."
        action={
          <Button onClick={onCreate}>
            <KeyRound className="size-4" aria-hidden="true" />
            Create key
          </Button>
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] text-sm" aria-label="API keys">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            {HEADERS.map((header, index) => (
              <th
                key={index}
                scope="col"
                className="px-3 py-2 text-xs font-medium text-muted-foreground"
              >
                {header || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 2 }).map((_, index) => (
                <tr key={index} className="border-b border-border last:border-0">
                  {HEADERS.map((_header, cell) => (
                    <td key={cell} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            : apiKeys.map((apiKey) => (
                <ApiKeyRow key={apiKey.id} apiKey={apiKey} onEdit={onEdit} onRevoke={onRevoke} />
              ))}
        </tbody>
      </table>
    </div>
  );
}

function ApiKeyRow({
  apiKey,
  onEdit,
  onRevoke,
}: {
  apiKey: ApiKey;
  onEdit: (apiKey: ApiKey) => void;
  onRevoke: (apiKey: ApiKey) => void;
}) {
  const inactive = apiKey.revokedAt !== null || apiKey.expired;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30">
      <td className="px-3 py-3">
        <p className={inactive ? 'font-medium text-muted-foreground' : 'font-medium'}>
          {apiKey.name}
        </p>
        <code className="font-mono text-xs text-muted-foreground">{apiKey.prefix}…</code>
      </td>
      <td className="px-3 py-3">
        <Badge variant="secondary">{humanizeEnum(apiKey.role)}</Badge>
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        <span className="tabular-nums">{formatRelativeTime(apiKey.createdAt)}</span>
        {apiKey.createdBy && (
          <span className="block truncate text-xs">by {apiKey.createdBy.name}</span>
        )}
      </td>
      <td className="px-3 py-3 tabular-nums text-muted-foreground">
        {apiKey.lastUsedAt ? formatRelativeTime(apiKey.lastUsedAt) : 'Never'}
      </td>
      <td className="px-3 py-3">
        <StatusBadge apiKey={apiKey} />
      </td>
      <td className="px-3 py-3 text-right">
        {!inactive && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${apiKey.name}`}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit(apiKey)}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onRevoke(apiKey)}>
                <ShieldOff className="size-4" aria-hidden="true" />
                Revoke
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </td>
    </tr>
  );
}

function StatusBadge({ apiKey }: { apiKey: ApiKey }) {
  if (apiKey.revokedAt) return <Badge variant="muted">Revoked</Badge>;
  if (apiKey.expired) return <Badge variant="warning">Expired</Badge>;
  if (apiKey.expiresAt) {
    return <Badge variant="outline">Expires {formatRelativeTime(apiKey.expiresAt)}</Badge>;
  }
  return <Badge variant="success">Active</Badge>;
}
