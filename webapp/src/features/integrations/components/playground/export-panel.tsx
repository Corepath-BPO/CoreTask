import { CopyButton } from '@/components/common/copy-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import type { PlaygroundCall, PlaygroundRequest } from '../../lib/playground-calls';
import { toCurl, toN8nNode } from '../../lib/playground-export';

interface ExportPanelProps {
  request: PlaygroundRequest;
  call: PlaygroundCall;
}

/**
 * The same request as something to take away: a curl line for a terminal, and
 * an n8n node to paste straight onto a canvas. Copying the curl includes the
 * real key; the screen shows it masked.
 */
export function ExportPanel({ request, call }: ExportPanelProps) {
  const n8n = toN8nNode(request, call);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Take it with you</CardTitle>
        <CardDescription>The same call, ready for a terminal or for n8n.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ExportBlock
          title="curl"
          hint="Paste into a terminal. The copied text carries your real key."
          shown={toCurl(request, { reveal: false })}
          copied={toCurl(request, { reveal: true })}
          copyLabel="Copy as curl"
        />
        <ExportBlock
          title="n8n HTTP Request node"
          hint="Copy, then paste onto an n8n canvas (Ctrl+V). Attach your Header Auth credential (X-API-Key) to the node afterwards; the key itself is not in the paste."
          shown={n8n}
          copied={n8n}
          copyLabel="Copy n8n node"
        />
      </CardContent>
    </Card>
  );
}

function ExportBlock({
  title,
  hint,
  shown,
  copied,
  copyLabel,
}: {
  title: string;
  hint: string;
  shown: string;
  copied: string;
  copyLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <CopyButton value={copied} label={copyLabel} successMessage="Copied" />
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
        {shown}
      </pre>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
