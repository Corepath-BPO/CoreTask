import { Outlet } from '@tanstack/react-router';

import { env } from '@/app/config/env';
import { BrandMark } from '@/components/navigation/sidebar';

/** Split layout for /login and /register. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh">
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 lg:px-16">
        <div className="mx-auto w-full max-w-sm space-y-8">
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="text-base font-semibold">{env.appName}</span>
          </div>

          <Outlet />
        </div>
      </div>

      {/* Decorative panel: hidden below lg rather than shrunk, so small screens
          give the whole viewport to the form. */}
      <aside
        aria-hidden="true"
        className="relative hidden w-1/2 overflow-hidden border-l bg-muted/40 lg:block"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,var(--color-primary)/12%,transparent_55%)]" />

        <div className="relative flex h-full flex-col justify-center px-16">
          <blockquote className="max-w-md space-y-6">
            <p className="text-2xl font-medium leading-snug tracking-tight">
              Every project, ticket and deadline your team is carrying — in one place, with the
              context that explains them.
            </p>
            <footer className="text-sm text-muted-foreground">
              Tasks, tickets, projects, real-time collaboration and audit-ready activity history.
            </footer>
          </blockquote>

          <dl className="mt-12 grid max-w-md grid-cols-3 gap-6">
            {[
              { value: 'Board', label: 'Kanban & list views' },
              { value: 'Live', label: 'Real-time updates' },
              { value: 'Audit', label: 'Full activity trail' },
            ].map((item) => (
              <div key={item.value}>
                <dt className="text-sm font-semibold">{item.value}</dt>
                <dd className="text-xs text-muted-foreground">{item.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}
