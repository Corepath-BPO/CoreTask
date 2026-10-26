import { Target, X } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';

import { useGoalProjectLink, useGoals } from '../hooks/use-goals';
import { GoalProgress, GoalStatusBadge } from './goal-status';

interface ConnectedGoalsProps {
  workspaceId: string;
  projectId: string;
  /** Members may connect and disconnect; a guest reads. */
  canConnect: boolean;
}

/**
 * Asana's "Connected goals" for one project: the goals it moves, each with
 * its status and progress and a link to it, and — for a member — a picker to
 * connect another and a way to let one go.
 */
export function ConnectedGoals({ workspaceId, projectId, canConnect }: ConnectedGoalsProps) {
  const { data: goals } = useGoals(workspaceId);
  const link = useGoalProjectLink(workspaceId);

  const connected = (goals ?? []).filter((goal) =>
    goal.projects.some((linked) => linked.id === projectId),
  );
  const connectable = (goals ?? []).filter(
    (goal) => !goal.projects.some((linked) => linked.id === projectId),
  );

  return (
    <div className="space-y-3">
      {connected.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Connect a goal to link this project to a larger purpose.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {connected.map((goal) => (
            <li key={goal.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <Link
                  to="/goals"
                  search={{ goal: goal.id }}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {goal.name}
                </Link>
                <span className="flex shrink-0 items-center gap-1">
                  <GoalStatusBadge status={goal.status} />
                  {canConnect && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Disconnect “${goal.name}”`}
                      onClick={() => link.mutate({ goalId: goal.id, projectId, linked: false })}
                    >
                      <X />
                    </Button>
                  )}
                </span>
              </div>
              <GoalProgress value={goal.progress} />
            </li>
          ))}
        </ul>
      )}

      {canConnect && connectable.length > 0 && (
        <Select
          value=""
          onValueChange={(goalId) => {
            // Radix answers a reset with an empty value; that is not a choice.
            if (goalId) link.mutate({ goalId, projectId, linked: true });
          }}
        >
          <SelectTrigger size="sm" className="w-full" aria-label="Connect a goal">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Target className="size-4" aria-hidden="true" />
              Connect a goal
            </span>
          </SelectTrigger>
          <SelectContent>
            {connectable.map((goal) => (
              <SelectItem key={goal.id} value={goal.id}>
                {goal.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {canConnect && (goals?.length ?? 0) === 0 && (
        <Button asChild variant="outline" size="sm">
          <Link to="/goals">Create a goal</Link>
        </Button>
      )}
    </div>
  );
}
