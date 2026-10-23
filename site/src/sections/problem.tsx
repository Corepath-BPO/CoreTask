'use client';

import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { Hash, Mail, MessageCircle, Sheet, Ticket } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { Reveal, useReducedMotionPreference } from '@/components/motion';
import { Container, cx } from '@/components/ui';
import { problem } from '@/content/site';

type Fragment = {
  key: string;
  className: string;
  depth: number;
  tilt: number;
  drift: [number, number];
  body: ReactNode;
};

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'w-[250px] rounded-2xl border border-line-2 bg-panel-2/90 p-4 text-left shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)] backdrop-blur',
        className,
      )}
    >
      {children}
    </div>
  );
}

const FRAGMENTS: Fragment[] = [
  {
    key: 'email',
    className: 'left-[3%] top-[13%]',
    depth: 1.2,
    tilt: -8,
    drift: [-60, -30],
    body: (
      <Card>
        <div className="flex items-center gap-2 text-xs text-faint">
          <Mail className="size-3.5" /> Inbox · 38 unread
        </div>
        <p className="mt-3 text-[0.8rem] text-muted">Dana Whitfield</p>
        <p className="text-sm font-medium text-fg">Laptop for Monday’s new hire?</p>
        <p className="mt-1 line-clamp-2 text-xs text-faint">
          Hi — just checking this reached the right person. She starts Monday…
        </p>
        <p className="mt-3 text-[0.7rem] text-amber">3 days ago · no reply</p>
      </Card>
    ),
  },
  {
    key: 'chat',
    className: 'right-[3%] top-[11%]',
    depth: 0.8,
    tilt: 7,
    drift: [70, -20],
    body: (
      <Card>
        <div className="flex items-center gap-1.5 text-xs text-faint">
          <Hash className="size-3.5" /> ops-help
        </div>
        <div className="mt-3 flex gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sky/20 text-[0.65rem] font-semibold text-sky">
            LP
          </span>
          <div>
            <p className="text-[0.8rem] font-medium text-fg">Leo Park</p>
            <p className="text-xs text-muted">
              Can someone look at the VPN thing? It dropped again.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[0.7rem] text-faint">12 replies · nobody assigned</p>
      </Card>
    ),
  },
  {
    key: 'sheet',
    className: 'left-[6%] bottom-[9%]',
    depth: 0.9,
    tilt: 6,
    drift: [-50, 40],
    body: (
      <Card className="w-[270px]">
        <div className="flex items-center gap-2 text-xs text-faint">
          <Sheet className="size-3.5" /> Q4-launch-plan_v7_FINAL.xlsx
        </div>
        <div className="mt-3 grid grid-cols-[1.4fr_0.8fr_1fr] gap-px overflow-hidden rounded-md bg-line text-[0.68rem]">
          {[
            ['Task', 'Owner', 'Status'],
            ['Pricing page', '??', 'In progress?'],
            ['Blog migration', 'Ana', 'Blocked'],
            ['Analytics', '', ''],
          ].map((row, r) =>
            row.map((cell, c) => (
              <span
                key={`${r}-${c}`}
                className={cx(
                  'bg-panel px-2 py-1.5',
                  r === 0 ? 'text-faint' : 'text-muted',
                  cell === '??' && 'text-rose',
                )}
              >
                {cell || '—'}
              </span>
            )),
          )}
        </div>
      </Card>
    ),
  },
  {
    key: 'note',
    className: 'right-[8%] bottom-[11%]',
    depth: 1.3,
    tilt: -5,
    drift: [60, 50],
    body: (
      <div className="w-[190px] rotate-2 rounded-sm bg-[#f5d76e] p-4 text-[#3b3110] shadow-[0_30px_60px_-25px_rgb(0_0_0/0.9)]">
        <p className="font-mono text-[0.75rem] leading-snug">
          Call the vendor about the invoice!!
          <br />
          (who has the PO?)
        </p>
      </div>
    ),
  },
  {
    key: 'dm',
    className: 'left-[1%] top-[46%] hidden xl:block',
    depth: 0.6,
    tilt: 4,
    drift: [-80, 0],
    body: (
      <Card className="w-[230px]">
        <div className="flex items-center gap-2 text-xs text-faint">
          <MessageCircle className="size-3.5" /> Direct message
        </div>
        <p className="mt-2 text-xs text-muted">
          Did anyone pick up the access request from Tuesday?
        </p>
        <p className="mt-2 text-[0.7rem] text-faint">Seen</p>
      </Card>
    ),
  },
  {
    key: 'ticket',
    className: 'right-[1%] top-[47%] hidden xl:block',
    depth: 1,
    tilt: -6,
    drift: [80, 10],
    body: (
      <Card className="w-[230px]">
        <div className="flex items-center gap-2 text-xs text-faint">
          <Ticket className="size-3.5" /> Old help desk
        </div>
        <p className="mt-2 text-sm text-fg">#2231 · Printer on floor 2</p>
        <p className="mt-1 text-[0.7rem] text-amber">Waiting on someone · 9 days</p>
      </Card>
    ),
  },
];

function FloatingFragment({
  fragment,
  progress,
}: {
  fragment: Fragment;
  progress: MotionValue<number>;
}) {
  const { depth, tilt, drift } = fragment;
  // `progress` runs 0 → 1 while the section is pinned: the fragments float,
  // then scatter outwards and fade as the resolve line arrives.
  const y = useTransform(progress, [0, 1], [70 * depth, -150 * depth]);
  const x = useTransform(progress, [0.3, 1], [0, drift[0] * depth * 1.8]);
  const extraY = useTransform(progress, [0.3, 1], [0, drift[1] * depth * 1.8]);
  const rotateY = useTransform(progress, [0, 1], [tilt * 1.4, -tilt * 1.4]);
  const rotateX = useTransform(progress, [0, 1], [10, -10]);
  const opacity = useTransform(progress, [0, 0.45, 0.8], [1, 1, 0.12]);
  const translateY = useTransform([y, extraY], ([a, b]: number[]) => a + b);

  return (
    <motion.div
      aria-hidden
      className={cx('absolute', fragment.className)}
      style={{
        x,
        y: translateY,
        rotateX,
        rotateY,
        rotateZ: tilt * 0.4,
        opacity,
        z: depth * 60,
      }}
    >
      {fragment.body}
    </motion.div>
  );
}

export function Problem() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotionPreference();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const resolveOpacity = useTransform(scrollYProgress, [0.55, 0.75], [0, 1]);
  const resolveY = useTransform(scrollYProgress, [0.55, 0.75], [20, 0]);

  if (reduce) {
    return (
      <section id="problem" ref={ref} aria-labelledby="problem-title" className="py-28">
        <Container className="text-center">
          <p className="eyebrow">{problem.eyebrow}</p>
          <h2 id="problem-title" className="headline mx-auto mt-4 max-w-4xl">
            {problem.title}
          </h2>
          <p className="lede mx-auto mt-5 max-w-2xl">{problem.lede}</p>
          <p className="mt-10 text-2xl font-medium text-brand">{problem.resolve}</p>
        </Container>
      </section>
    );
  }

  return (
    <section id="problem" ref={ref} aria-labelledby="problem-title" className="relative h-[220svh]">
      <div className="sticky top-0 h-svh overflow-hidden" style={{ perspective: 1200 }}>
        <div className="absolute inset-0 hidden sm:block" style={{ transformStyle: 'preserve-3d' }}>
          {FRAGMENTS.map((fragment) => (
            <FloatingFragment key={fragment.key} fragment={fragment} progress={scrollYProgress} />
          ))}
        </div>

        <Container className="relative z-10 flex h-full flex-col items-center justify-center-safe pt-20 pb-6 text-center">
          <Reveal>
            <p className="eyebrow">{problem.eyebrow}</p>
          </Reveal>
          <Reveal delay={0.05}>
            <h2 id="problem-title" className="headline mt-4 max-w-[17ch] sm:max-w-3xl">
              {problem.title}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="lede mx-auto mt-5 max-w-xl">{problem.lede}</p>
          </Reveal>
          <motion.p
            style={{ opacity: resolveOpacity, y: resolveY }}
            className="mt-10 inline-flex items-center gap-3 text-xl font-medium text-fg sm:text-2xl"
          >
            <span aria-hidden className="h-px w-10 bg-brand" />
            {problem.resolve}
            <span aria-hidden className="h-px w-10 bg-brand" />
          </motion.p>
        </Container>
      </div>
    </section>
  );
}
