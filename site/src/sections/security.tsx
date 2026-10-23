import {
  Eye,
  Fingerprint,
  History,
  KeyRound,
  RefreshCcw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import { Reveal, Tilt } from '@/components/motion';
import { Container, SectionHeading } from '@/components/ui';
import { security } from '@/content/site';

const ICONS: LucideIcon[] = [Eye, RefreshCcw, Fingerprint, KeyRound, History, ShieldCheck];

export function Security() {
  return (
    <section id="security" aria-labelledby="security-title" className="relative py-28 lg:py-40">
      <div
        aria-hidden
        className="grid-bg pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
      />
      <Container className="relative">
        <SectionHeading
          id="security-title"
          eyebrow={security.eyebrow}
          title={security.title}
          lede={security.lede}
          className="max-w-3xl"
        />
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {security.items.map((item, i) => {
            const Icon = ICONS[i];
            return (
              <li key={item.title}>
                <Reveal delay={(i % 3) * 0.07} className="h-full">
                  <Tilt max={6} className="h-full rounded-2xl">
                    <div className="h-full rounded-2xl border border-line-2 bg-panel/80 p-6">
                      <span className="grid size-10 place-items-center rounded-xl bg-brand/12 text-brand">
                        <Icon aria-hidden className="size-5" />
                      </span>
                      <h3 className="mt-5 text-[1.05rem] font-medium">{item.title}</h3>
                      <p className="mt-2 text-[0.92rem] leading-relaxed text-muted">{item.body}</p>
                    </div>
                  </Tilt>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
