'use client';

import { motion, useInView, useScroll, useTransform } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';

import { Mark } from '@/components/brand';
import { EASE, useReducedMotionPreference } from '@/components/motion';
import { ButtonLink, Container } from '@/components/ui';
import { hero, site } from '@/content/site';

// three.js is the heaviest thing on the page, so it never blocks the headline:
// the text paints first and the scene streams in behind it.
const MarkScene = dynamic(() => import('@/three/mark-scene'), { ssr: false });

/** The static mark, for reduced motion and for browsers without WebGL. */
function StillMark() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-[16svh] lg:items-center lg:justify-end lg:pt-0 lg:pr-[9%]">
      <Mark className="h-48 w-auto text-fg drop-shadow-[0_0_60px_rgb(0_240_6/0.22)] sm:h-60 lg:h-80" />
    </div>
  );
}

const [before, after] = hero.title.split(hero.accent) as [string, string];

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotionPreference();
  const inView = useInView(ref, { margin: '0px 0px 200px 0px' });
  const [ready, setReady] = useState(false);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  const textY = useTransform(scrollYProgress, [0.55, 1], [0, -90]);
  const textOpacity = useTransform(scrollYProgress, [0.62, 0.95], [1, 0]);
  const cueOpacity = useTransform(scrollYProgress, [0, 0.06], [1, 0]);

  return (
    <section
      id="top"
      ref={ref}
      aria-labelledby="hero-title"
      className={reduce ? 'relative' : 'relative h-[230svh]'}
    >
      <div className={reduce ? 'relative min-h-svh' : 'sticky top-0 h-svh overflow-hidden'}>
        <div aria-hidden className="grid-bg pointer-events-none absolute inset-0 opacity-60" />
        <div
          aria-hidden
          className="pointer-events-none absolute top-[10%] right-[-10%] size-[70vmax] rounded-full bg-[radial-gradient(circle,rgb(133_200_84/0.13),transparent_60%)] lg:top-[-5%] lg:right-[-15%]"
        />

        {reduce ? (
          <StillMark />
        ) : (
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: ready ? 1 : 0 }}
            transition={{ duration: 1.2, ease: EASE }}
          >
            <MarkScene
              progress={scrollYProgress}
              active={inView}
              fallback={<StillMark />}
              onReady={() => setReady(true)}
            />
          </motion.div>
        )}

        {/* Bottom fade so the text keeps its contrast over the scene on phones. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink via-ink/70 to-transparent lg:hidden"
        />

        <Container className="relative z-10 flex h-full min-h-svh items-end-safe pt-24 pb-20 lg:items-center-safe lg:pb-10">
          <motion.div
            style={reduce ? undefined : { y: textY, opacity: textOpacity }}
            className="max-w-[640px]"
          >
            <motion.a
              href={site.earlyAccessHref}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
              className="glass hidden items-center gap-2 rounded-full px-3 py-1.5 text-[0.8rem] text-muted transition-colors hover:text-fg sm:inline-flex"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
              {hero.note}
            </motion.a>

            <h1 id="hero-title" className="sm:mt-6">
              <span className="eyebrow block">{hero.eyebrow}</span>{' '}
              <span className="display mt-4 block">
                {before}
                <span className="text-brand">{hero.accent}</span>
                {after}
              </span>
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.35 }}
              className="lede mt-5 max-w-[540px] max-sm:text-[1rem] sm:mt-6"
            >
              {hero.lede}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.5 }}
              className="mt-9 flex flex-wrap items-center gap-3"
            >
              <ButtonLink href={site.earlyAccessHref}>{hero.primary}</ButtonLink>
              <ButtonLink href="#problem" variant="ghost">
                {hero.secondary}
              </ButtonLink>
            </motion.div>
          </motion.div>
        </Container>

        {!reduce && (
          <motion.div
            aria-hidden
            style={{ opacity: cueOpacity }}
            className="pointer-events-none absolute bottom-7 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[0.7rem] tracking-[0.2em] text-faint uppercase lg:flex"
          >
            Scroll
            <span className="relative h-10 w-px overflow-hidden bg-line-2">
              <motion.span
                className="absolute inset-x-0 top-0 h-1/2 bg-brand"
                animate={{ y: ['-100%', '200%'] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              />
            </span>
          </motion.div>
        )}
      </div>
    </section>
  );
}
