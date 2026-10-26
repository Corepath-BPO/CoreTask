import { useNavigate } from '@tanstack/react-router';
import { Building2 } from 'lucide-react';
import { useEffect } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useActiveWorkspace } from '../hooks/use-workspaces';

/**
 * `/w/<slug>`: a workspace's own address — what the create dialog promises and
 * what "<workspace> is ready" links to. Switches to that workspace and opens
 * its Home; a slug the person is not a member of says so rather than 404ing.
 */
export function WorkspaceLinkPage({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const { workspaces, isLoading, select } = useActiveWorkspace();
  const target = workspaces.find((workspace) => workspace.slug === slug.toLowerCase());

  useEffect(() => {
    if (!target) return;
    select(target.id);
    void navigate({ to: '/', replace: true });
  }, [target, select, navigate]);

  if (isLoading || target) {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">Opening the workspace</span>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <EmptyState
      icon={Building2}
      title="You’re not in that workspace"
      description="The link points at a workspace you are not a member of, or one that no longer exists. Ask its owner for an invitation."
      action={
        <Button variant="outline" onClick={() => void navigate({ to: '/' })}>
          Back to Home
        </Button>
      }
      className="mt-10"
    />
  );
}
