import { Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useProjectStar } from '../hooks/use-project-stars';

/**
 * Asana's star beside a project's name: puts it in the sidebar's Starred list.
 * A bookmark for the reader alone, so anyone who can see the project can use it.
 */
export function ProjectStarButton({
  workspaceId,
  projectId,
  projectName,
  className,
}: {
  workspaceId: string | undefined;
  projectId: string;
  projectName: string;
  className?: string;
}) {
  const { starred, pending, toggle } = useProjectStar(workspaceId, projectId);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={starred}
      aria-label={starred ? `Unstar ${projectName}` : `Star ${projectName}`}
      title={starred ? 'Remove from Starred' : 'Add to Starred'}
      disabled={pending || !workspaceId}
      onClick={(event) => {
        // Rows are links; the star must not also open the project.
        event.preventDefault();
        event.stopPropagation();
        toggle();
      }}
      className={className}
    >
      <Star className={cn(starred && 'fill-amber-400 text-amber-400')} />
    </Button>
  );
}
