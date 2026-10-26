import { QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from '@/lib/api/query-client';
import { useTheme } from '@/stores/theme.store';

import { AuthProvider } from './auth-provider';

/**
 * Composition root for cross-cutting context.
 *
 * Order matters: data access (Query) wraps session restoration (Auth), which
 * wraps anything that reads the session.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  // Mounted here so the OS theme listener is attached exactly once.
  useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
