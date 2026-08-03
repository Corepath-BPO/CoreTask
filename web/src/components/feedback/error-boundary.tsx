import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { env } from '@/app/config/env';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence for render-time crashes.
 *
 * Class component by necessity — React exposes no hook equivalent of
 * `componentDidCatch`.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Swap for the error-reporting client when one is wired up.
    console.error('Unhandled render error', error, info.componentStack);
  }

  private readonly reset = () => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <TriangleAlert className="size-6 text-destructive" aria-hidden="true" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">
              This screen failed to render. Your work is safe — try again, or reload the page.
            </p>
          </div>

          {/* The message can carry internals, so it is shown in development only. */}
          {env.isDev && (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
              {error.message}
            </pre>
          )}

          <div className="flex justify-center gap-2">
            <Button onClick={this.reset} variant="outline">
              <RefreshCw />
              Try again
            </Button>
            <Button onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      </div>
    );
  }
}
