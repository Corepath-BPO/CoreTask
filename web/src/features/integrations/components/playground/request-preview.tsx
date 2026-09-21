import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { maskedHeaders, type PlaygroundRequest } from '../../lib/playground-calls';

interface RequestPreviewProps {
  request: PlaygroundRequest;
}

/** Exactly what Run will send, with the credential masked. Same bytes, different eyes. */
export function RequestPreview({ request }: RequestPreviewProps) {
  const headers = maskedHeaders(request.headers);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request</CardTitle>
        <CardDescription>What will be sent when you press Run.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="flex items-start gap-2">
          <Badge variant="outline" className="shrink-0 font-mono">
            {request.method}
          </Badge>
          <code className="min-w-0 break-all font-mono" data-testid="playground-url">
            {request.url}
          </code>
        </div>

        <dl className="space-y-1 font-mono">
          {Object.entries(headers).map(([name, value]) => (
            <div key={name} className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">{name}:</dt>
              <dd className="min-w-0 break-all">{value}</dd>
            </div>
          ))}
        </dl>

        {request.body !== null && (
          <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 font-mono leading-relaxed">
            {request.body}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
