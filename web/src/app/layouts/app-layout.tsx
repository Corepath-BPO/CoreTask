import { Outlet } from '@tanstack/react-router';

import { SocketProvider } from '@/app/providers/socket-provider';
import { ErrorBoundary } from '@/components/feedback/error-boundary';
import { Sidebar } from '@/components/navigation/sidebar';
import { Topbar } from '@/components/navigation/topbar';

/** Authenticated shell: sidebar, top bar, and the routed content area. */
export function AppLayout() {
  return (
    <SocketProvider>
      <div className="flex h-dvh overflow-hidden bg-background">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />

          {/* Skip link target; `tabIndex={-1}` makes the region focusable
              programmatically without adding it to the tab order. */}
          {/* `relative` so a full-bleed page (portfolio detail) can pin itself
              to this area with `absolute inset-0` and manage its own scroll. */}
          <main
            id="main-content"
            tabIndex={-1}
            className="relative flex-1 overflow-y-auto outline-none"
          >
            {/* Full width, as Asana lays its pages: the content starts at the
                sidebar rather than floating in a centered column. */}
            <div className="w-full px-4 py-6 sm:px-6">
              {/* Scoped per route: a crash in one page must not take the shell
                  down with it, or the user loses their way out. */}
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </SocketProvider>
  );
}
