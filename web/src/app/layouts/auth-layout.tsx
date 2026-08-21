import { Outlet } from '@tanstack/react-router';

import { env } from '@/app/config/env';
import { BrandMark } from '@/components/navigation/sidebar';

/** Split layout for /login and /register. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh bg-background">
      <div className="relative flex w-full flex-col justify-center overflow-hidden px-6 py-12 lg:w-[46%] lg:px-16">
        <div className="pointer-events-none absolute -left-28 -top-28 size-72 rounded-full bg-primary/8 blur-3xl" />
        <div className="mx-auto w-full max-w-sm space-y-8">
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="text-base font-semibold tracking-[-0.01em]">{env.appName}</span>
          </div>

          <Outlet />
        </div>
      </div>

      {/* Decorative panel: hidden below lg rather than shrunk, so small screens
          give the whole viewport to the form. */}
      <aside
        aria-hidden="true"
        className="relative hidden flex-1 overflow-hidden border-l bg-sidebar lg:block"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_16%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_42%)]" />
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-[linear-gradient(to_top,color-mix(in_oklch,var(--primary)_7%,transparent),transparent)]" />

        <div className="relative flex h-full flex-col justify-center px-16">
          {/* The full lockup gets its one legible showing here — at this width
              the tagline still reads, which it never would in the sidebar. */}
          <img
            src="/logo-full.png"
            alt="CoreTask: plan, track, achieve"
            width={224}
            height={191}
            className="mb-10 w-56 rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
          />

          <blockquote className="max-w-md space-y-6">
            <p className="text-2xl font-medium leading-snug tracking-tight">
              Every project, ticket and deadline your team is carrying, in one place, with the
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
