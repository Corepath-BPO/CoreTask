'use client';

import { motion, useMotionValueEvent, useTransform, type MotionValue } from 'framer-motion';
import { useState } from 'react';

import { Reveal } from '@/components/motion';
import { ScrollClip } from '@/components/scroll-clip';
import { ScrollStage } from '@/components/scroll-stage';
import { Container, PointGrid, cx } from '@/components/ui';
import type { ClipId } from '@/remotion/clip-ids';

type Copy = {
  eyebrow: string;
  title: string;
  lede: string;
  points: readonly { title: string; body: string }[];
};

/**
 * One chapter of the story told by a product clip: the copy on one side, the
 * clip on the other, pinned while scrolling scrubs the clip from start to end.
 * The supporting points follow underneath in normal flow.
 */
export function ClipSection({
  id,
  copy,
  clip,
  clipLabel,
  steps,
  flip = false,
}: {
  id: string;
  copy: Copy;
  clip: ClipId;
  clipLabel: string;
  /** Short labels for the clip's beats, lit in turn as it plays. */
  steps: readonly string[];
  flip?: boolean;
}) {
  const titleId = `${id}-title`;

  return (
    <div>
      <ScrollStage id={id} labelledBy={titleId} height="h-[290svh]">
        {(progress, reduce) => (
          <Stage
            progress={progress}
            reduce={reduce}
            titleId={titleId}
            copy={copy}
            clip={clip}
            clipLabel={clipLabel}
            steps={steps}
            flip={flip}
          />
        )}
      </ScrollStage>
      <Container className="relative pb-28 lg:pb-36">
        <PointGrid points={copy.points} />
      </Container>
    </div>
  );
}

function Stage({
  progress,
  reduce,
  titleId,
  copy,
  clip,
  clipLabel,
  steps,
  flip,
}: {
  progress: MotionValue<number>;
  reduce: boolean;
  titleId: string;
  copy: Copy;
  clip: ClipId;
  clipLabel: string;
  steps: readonly string[];
  flip: boolean;
}) {
  // The clip plays across the middle of the pin, so it holds its first and
  // last frames for a moment at either end.
  const playhead = useTransform(progress, [0.06, 0.86], [0, 1], { clamp: true });
  const [step, setStep] = useState(0);
  useMotionValueEvent(playhead, 'change', (v) =>
    setStep(Math.min(steps.length - 1, Math.floor(v * steps.length))),
  );
  const bar = useTransform(playhead, [0, 1], ['0%', '100%']);

  return (
    <Container
      className={cx(
        'grid items-center gap-10 lg:gap-16',
        flip ? 'lg:grid-cols-[1.25fr_0.75fr]' : 'lg:grid-cols-[0.75fr_1.25fr]',
      )}
    >
      <div className={cx(flip && 'lg:order-2')}>
        <Reveal>
          <p className="eyebrow">{copy.eyebrow}</p>
        </Reveal>
        <Reveal delay={0.05}>
          <h2 id={titleId} className="headline mt-4">
            {copy.title}
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="lede mt-5">{copy.lede}</p>
        </Reveal>
        {!reduce && (
          <div aria-hidden className="mt-8 hidden sm:block">
            <div className="flex gap-5 font-mono text-[0.72rem] tracking-[0.12em] uppercase">
              {steps.map((label, i) => (
                <span
                  key={label}
                  className={cx(
                    'transition-colors duration-300',
                    i === step ? 'text-brand' : i < step ? 'text-muted' : 'text-faint',
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-3 h-px w-full max-w-sm bg-line-2">
              <motion.div className="h-px bg-brand" style={{ width: bar }} />
            </div>
          </div>
        )}
      </div>
      <div className={cx(flip && 'lg:order-1')}>
        <ScrollClip
          id={clip}
          label={clipLabel}
          progress={playhead}
          reduce={reduce}
          lean={flip ? 'right' : 'left'}
        />
      </div>
    </Container>
  );
}
