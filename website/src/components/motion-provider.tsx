'use client';

import { MotionConfig } from 'framer-motion';
import Lenis from 'lenis';
import { useEffect, type ReactNode } from 'react';

/**
 * Smooth scrolling and the motion defaults for the whole page.
 *
 * Lenis eases the native scroll position rather than faking one, so
 * framer-motion's `useScroll`, anchors and the browser's own find-in-page all
 * keep working. Visitors who ask for reduced motion get the browser's own
 * scrolling and no transform animations.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ autoRaf: true, lerp: 0.11, anchors: { offset: -72 } });
    return () => lenis.destroy();
  }, []);

  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
