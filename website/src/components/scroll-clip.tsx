'use client';

import { motion, useInView, useTransform, type MotionValue } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useCallback, useRef, useState } from 'react';

import { posterPath, type ClipId } from '@/remotion/clip-ids';

const ClipPlayer = dynamic(() => import('@/remotion/clip-player'), { ssr: false });

/**
 * A product clip in a 3D-tilted frame. The rendered poster (the clip's last
 * frame) is in the HTML from the start; the live, scroll-scrubbed player loads
 * as the section approaches and fades in over it.
 */
export function ScrollClip({
  id,
  label,
  progress,
  reduce,
  lean = 'left',
}: {
  id: ClipId;
  /** Describes the clip for screen readers and image search. */
  label: string;
  /** The clip's own 0 → 1 playhead. */
  progress: MotionValue<number>;
  reduce: boolean;
  lean?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { once: true, margin: '100% 0px 100% 0px' });
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  const sign = lean === 'left' ? -1 : 1;
  const rotateY = useTransform(progress, [0, 1], [sign * 16, sign * 3]);
  const rotateX = useTransform(progress, [0, 1], [9, 2]);

  return (
    <div ref={ref} style={{ perspective: 1800 }} className="relative">
      <motion.div
        style={reduce ? undefined : { rotateX, rotateY, transformStyle: 'preserve-3d' }}
        className="relative aspect-[1280/800] overflow-hidden rounded-[20px] border border-line-2 bg-ink shadow-[0_60px_140px_-50px_rgb(0_0_0/0.95),0_0_0_1px_rgb(255_255_255/0.03)]"
      >
        <img
          src={posterPath(id)}
          alt={label}
          width={1280}
          height={800}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full"
        />
        {near && !reduce && (
          <motion.div
            aria-hidden
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: ready ? 1 : 0 }}
            transition={{ duration: 0.4 }}
          >
            <ClipPlayer id={id} progress={progress} onReady={onReady} />
          </motion.div>
        )}
      </motion.div>
      {/* A soft green floor glow under the frame. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[10%] -bottom-10 h-20 rounded-[50%] bg-brand/20 blur-3xl"
      />
    </div>
  );
}
