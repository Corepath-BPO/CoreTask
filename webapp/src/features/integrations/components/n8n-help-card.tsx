import { env } from '@/app/config/env';
import { CopyButton } from '@/components/common/copy-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface N8nHelpCardProps {
  workspaceId: string;
}

/**
 * The minimum a person needs to wire n8n up, with the real ids filled in so
 * nothing has to be looked up elsewhere first.
 */
export function N8nHelpCard({ workspaceId }: N8nHelpCardProps) {
  const baseUrl = env.apiUrl;
  const createTask = [
    `curl -X POST ${baseUrl}/workspaces/${workspaceId}/tasks \\`,
    `  -H "X-API-Key: ctk_your_key_here" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"title": "Filed from n8n", "sectionId": "<section id>"}'`,
  ].join('\n');

  return (
    <Card className="bg-muted/25">
      <CardHeader>
        <CardTitle>Use with n8n</CardTitle>
        <CardDescription>
          An HTTP Request node with header authentication is all it takes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ol className="list-decimal space-y-2 pl-5 leading-relaxed">
          <li>
            Create a key here, then add a <strong>Header Auth</strong> credential in n8n with the
            name <code className="font-mono">X-API-Key</code> and the key as its value.
          </li>
          <li>
            Call <code className="font-mono">GET /integration/whoami</code> once to check the key
            and read your workspace id.
          </li>
          <li>
            Create tasks with <code className="font-mono">POST …/tasks</code>. The response’s{' '}
            <code className="font-mono">data.id</code> is the task id — keep it to complete the task
            later with <code className="font-mono">PATCH …/tasks/&lt;id&gt;</code> and{' '}
            <code className="font-mono">{'{ "status": "DONE" }'}</code>.
          </li>
          <li>
            Find project and section ids with <code className="font-mono">GET …/projects</code> and{' '}
            <code className="font-mono">GET …/projects/&lt;id&gt;/sections</code>.
          </li>
        </ol>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Base URL</span>
            <CopyButton value={baseUrl} label="Copy base URL" />
          </div>
          <code className="block truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {baseUrl}
          </code>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Workspace id</span>
            <CopyButton value={workspaceId} label="Copy workspace id" />
          </div>
          <code className="block truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {workspaceId}
          </code>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Create a task</span>
            <CopyButton value={createTask} label="Copy example request" />
          </div>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {createTask}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
