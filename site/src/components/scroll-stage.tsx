'use client';

import { useScroll, type MotionValue } from 'framer-motion';
import { useRef, type ReactNode } from 'react';

import { useReducedMotionPreference } from './motion';
import { cx } from './ui';

/**
 * A section that pins to the screen while the page scrolls past it, handing
 * its children a 0 → 1 progress value for the pinned stretch. The section's
 * height sets how long the pin lasts.
 *
 * With reduced motion it is an ordinary section: nothing pins, and children
 * are told so, so they can show their finished state.
 */
export function ScrollStage({
  id,
  labelledBy,
  height,
  className,
  children,
}: {
  id: string;
  labelledBy: string;
  /** A Tailwind height class, e.g. `h-[300svh]`. */
  height: string;
  className?: string;
  children: (progress: MotionValue<number>, reduce: boolean) => ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotionPreference();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  return (
    <section
      id={id}
      ref={ref}
      aria-labelledby={labelledBy}
      className={cx('relative', reduce ? 'py-28' : height, className)}
    >
      {/* pt-16 keeps pinned content clear of the fixed header. */}
      <div
        className={
          reduce ? undefined : 'sticky top-0 flex h-svh items-center overflow-hidden pt-16'
        }
      >
        {children(scrollYProgress, reduce)}
      </div>
    </section>
  );
}
