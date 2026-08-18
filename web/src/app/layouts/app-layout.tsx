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
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 overflow-y-auto bg-background outline-none"
          >
            <div className="page-enter mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
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
