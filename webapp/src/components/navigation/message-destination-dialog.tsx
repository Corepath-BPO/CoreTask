import { useNavigate } from '@tanstack/react-router';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { useTeams } from '@/features/teams/hooks/use-teams';

/**
 * Create › Message, as Asana asks it: where should it go? A project's or a
 * team's Messages tab — and that is where the message is then written.
 */
export function MessageDestinationDialog({
  workspaceId,
  onOpenChange,
}: {
  workspaceId: string | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { data: projects } = useProjects(workspaceId, { limit: 100 });
  const { data: teams } = useTeams(workspaceId);
  const [target, setTarget] = useState('');

  const go = () => {
    const [kind, id] = target.split(':');
    if (!id) return;
    onOpenChange(false);
    if (kind === 'project') {
      void navigate({ to: '/projects/$projectId/messages', params: { projectId: id } });
    } else {
      void navigate({ to: '/teams/$teamId', params: { teamId: id }, search: { tab: 'messages' } });
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Post to a project or a team; its members are notified.
          </DialogDescription>
        </DialogHeader>
        <Select
          value={target}
          onValueChange={(next) => {
            // Radix sends '' when its options change; that is not a choice.
            if (next) setTarget(next);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Post to">
            <SelectValue placeholder="Choose a project or team" />
          </SelectTrigger>
          <SelectContent>
            {(projects?.items ?? []).length > 0 && (
              <SelectGroup>
                <SelectLabel>Projects</SelectLabel>
                {(projects?.items ?? []).map((project) => (
                  <SelectItem key={project.id} value={`project:${project.id}`}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {(teams ?? []).length > 0 && (
              <SelectGroup>
                <SelectLabel>Teams</SelectLabel>
                {(teams ?? []).map((team) => (
                  <SelectItem key={team.id} value={`team:${team.id}`}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!target} onClick={go}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
