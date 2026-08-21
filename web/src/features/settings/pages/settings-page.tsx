import {
  DESCRIPTION_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  WORKSPACE_NAME_MIN_LENGTH,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import { Link } from '@tanstack/react-router';
import type { WorkspaceSummary } from '@coretask/types';
import { Building2, Check, Laptop, Moon, Sun, UsersRound } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useActiveWorkspace, useUpdateWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';
import { type Theme, useTheme } from '@/stores/theme.store';

export function SettingsPage() {
  const { workspace, isLoading } = useActiveWorkspace();

  if (isLoading) return null;
  if (!workspace)
    return (
      <EmptyState
        icon={Building2}
        title="No workspace yet"
        description="Create a workspace before configuring it."
        className="mt-10"
      />
    );

  return <SettingsContent key={`${workspace.id}-${workspace.updatedAt}`} workspace={workspace} />;
}

function SettingsContent({ workspace }: { workspace: WorkspaceSummary }) {
  const user = useCurrentUser();
  const update = useUpdateWorkspace(workspace.id);
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');

  const canManage = hasAtLeastRole(workspace.role, WorkspaceRole.ADMIN);
  const trimmedName = name.trim();
  const nameError =
    trimmedName.length < WORKSPACE_NAME_MIN_LENGTH
      ? `Use at least ${WORKSPACE_NAME_MIN_LENGTH} characters.`
      : trimmedName.length > WORKSPACE_NAME_MAX_LENGTH
        ? `Use at most ${WORKSPACE_NAME_MAX_LENGTH} characters.`
        : null;
  const dirty =
    trimmedName !== workspace.name || description.trim() !== (workspace.description ?? '');

  return (
    <div className="mx-auto w-full max-w-6xl space-y-7">
      <PageHeader
        title="Settings"
        description="Personal preferences and workspace configuration."
        actions={
          <Badge variant="outline" className="h-8 capitalize">
            {workspace.role.toLowerCase()}
          </Badge>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Workspace profile</CardTitle>
              <CardDescription>
                The name and description your team sees across CoreTask.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-1">
              <div className="space-y-2">
                <Label htmlFor="workspace-name">Workspace name</Label>
                <Input
                  id="workspace-name"
                  value={name}
                  maxLength={WORKSPACE_NAME_MAX_LENGTH}
                  disabled={!canManage}
                  aria-invalid={Boolean(nameError)}
                  onChange={(event) => setName(event.target.value)}
                />
                {nameError && <p className="text-xs text-destructive">{nameError}</p>}
              </div>
              <div className="space-y-2">
                <div className="flex justify-between gap-4">
                  <Label htmlFor="workspace-description">Description</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {description.length}/{DESCRIPTION_MAX_LENGTH}
                  </span>
                </div>
                <Textarea
                  id="workspace-description"
                  value={description}
                  maxLength={DESCRIPTION_MAX_LENGTH}
                  disabled={!canManage}
                  placeholder="What does this workspace organize?"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <p className="text-xs text-muted-foreground">
                  {canManage
                    ? 'Admins and owners can update workspace details.'
                    : 'Ask a workspace admin to change these details.'}
                </p>
                <Button
                  disabled={!canManage || !dirty || Boolean(nameError)}
                  loading={update.isPending}
                  onClick={() =>
                    update.mutate({ name: trimmedName, description: description.trim() || null })
                  }
                >
                  Save changes
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Choose how CoreTask looks on this device.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 pt-1 sm:grid-cols-3">
              {(
                [
                  { value: 'light', label: 'Light', icon: Sun },
                  { value: 'dark', label: 'Dark', icon: Moon },
                  { value: 'system', label: 'System', icon: Laptop },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTheme(option.value as Theme)}
                  className={cn(
                    'relative flex min-h-28 flex-col justify-between rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/45',
                    theme === option.value &&
                      'border-primary bg-primary/[0.06] ring-1 ring-primary/30',
                  )}
                >
                  <option.icon className="size-5 text-muted-foreground" />
                  <div>
                    <span className="text-sm font-semibold">{option.label}</span>
                    {theme === option.value && (
                      <Check className="absolute right-3 top-3 size-4 text-primary-strong" />
                    )}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Your account</CardTitle>
              <CardDescription>Signed-in identity for this session.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Name
                </p>
                <p className="mt-1 text-sm font-semibold">{user?.name ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Email
                </p>
                <p className="mt-1 break-all text-sm">{user?.email ?? '-'}</p>
              </div>
              <p className="border-t pt-4 text-xs text-muted-foreground">
                Account identity is managed by your sign-in profile.
              </p>
            </CardContent>
          </Card>
          <Card className="bg-muted/25">
            <CardHeader>
              <CardTitle>Team access</CardTitle>
              <CardDescription>Manage people, invitations, roles and teams.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 pt-1">
              <Button asChild variant="outline" className="justify-start">
                <Link to="/members">
                  <UsersRound />
                  Members and invitations
                </Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link to="/teams">
                  <Building2 />
                  Teams
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
