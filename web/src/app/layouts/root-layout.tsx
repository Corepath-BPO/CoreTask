import { Outlet } from '@tanstack/react-router';

/**
 * Outermost route component.
 *
 * Waiting for the session restore is `AppRouter`'s job, not this one's — by the
 * time any route component renders, routing has already been decided.
 */
export function RootLayout() {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Outlet />
    </>
  );
}
