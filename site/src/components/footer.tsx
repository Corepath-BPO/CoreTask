import { nav, site } from '@/content/site';

import { Lockup } from './brand';
import { Container } from './ui';

export function Footer() {
  return (
    <footer className="relative border-t border-line py-14">
      <Container className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Lockup className="h-6 w-auto" />
          <p className="mt-4 text-[0.92rem] leading-relaxed text-muted">
            Project management and ticketing software for teams that want every request tracked,
            planned and finished in one place.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-14 gap-y-3 text-[0.92rem]">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-muted transition-colors hover:text-fg"
            >
              {item.label}
            </a>
          ))}
          <a href={site.earlyAccessHref} className="text-brand transition-colors hover:text-fg">
            Early access
          </a>
        </nav>
      </Container>
      <Container className="mt-12 flex flex-col justify-between gap-3 text-[0.82rem] text-faint sm:flex-row">
        <p>© {new Date().getFullYear()} CoreTask. All rights reserved.</p>
        <p>Made for teams who finish what they start.</p>
      </Container>
    </footer>
  );
}
