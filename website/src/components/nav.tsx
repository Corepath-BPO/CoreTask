'use client';

import { motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { useState } from 'react';

import { nav, site } from '@/content/site';

import { Lockup } from './brand';
import { cx } from './ui';

export function Nav() {
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > 24));

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
      className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5"
    >
      <div
        className={cx(
          'mx-auto flex h-14 max-w-[1240px] items-center justify-between gap-6 rounded-full border px-4 transition-[background,border-color,box-shadow] duration-500 sm:px-5',
          solid
            ? 'border-line bg-ink/70 shadow-[0_10px_40px_-20px_rgb(0_0_0/0.9)] backdrop-blur-xl'
            : 'border-transparent',
        )}
      >
        <a href="#top" aria-label="CoreTask, back to top" className="shrink-0">
          <Lockup className="h-[22px] w-auto" />
        </a>
        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="rounded-full px-3.5 py-2 text-[0.88rem] text-muted transition-colors hover:text-fg"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={site.signInHref}
            className="rounded-full px-3.5 py-2 text-[0.85rem] font-medium whitespace-nowrap text-muted transition-colors hover:text-fg"
          >
            Sign in
          </a>
          <a
            href={site.earlyAccessHref}
            className="inline-flex h-9 items-center rounded-full bg-fg px-4 text-[0.85rem] font-medium whitespace-nowrap text-ink transition-colors hover:bg-white"
          >
            <span className="sm:hidden">Early access</span>
            <span className="hidden sm:inline">Request early access</span>
          </a>
        </div>
      </div>
    </motion.header>
  );
}
