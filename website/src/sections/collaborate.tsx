'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import { AtSign, Bell, Check, Image as ImageIcon, MoveRight } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { EASE, Tilt, useReducedMotionPreference } from '@/components/motion';
import { Container, PointGrid, SectionHeading } from '@/components/ui';
import { collaborate } from '@/content/site';

const PEOPLE = {
  MC: { name: 'Maya Chen', color: '#85c854' },
  LP: { name: 'Leo Park', color: '#f2b33d' },
  AR: { name: 'Ana Ruiz', color: '#38bdf8' },
} as const;

function Face({ who, size = 28 }: { who: keyof typeof PEOPLE; size?: number }) {
  const { color } = PEOPLE[who];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `${color}26`,
        color,
        boxShadow: `inset 0 0 0 1px ${color}55`,
      }}
    >
      {who}
    </span>
  );
}

/** One entry in the thread, appearing in turn once the panel is in view. */
function Entry({ index, children }: { index: number; children: ReactNode }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -15% 0px' }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.25 + index * 0.45 }}
    >
      {children}
    </motion.li>
  );
}

function TaskPanel() {
  return (
    <div className="rounded-[20px] border border-line-2 bg-panel p-5 shadow-[0_60px_140px_-50px_rgb(0_0_0/0.95)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[0.72rem] text-faint">Website relaunch</p>
          <p className="mt-1 text-lg font-semibold">Design the pricing page</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            <Face who="MC" size={24} />
            <Face who="AR" size={24} />
          </div>
          <span className="hidden text-[0.72rem] text-faint sm:inline">viewing</span>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3 border-y border-line py-4 text-[0.78rem]">
        <div>
          <dt className="text-faint">Assignee</dt>
          <dd className="mt-1.5 flex items-center gap-2 text-fg">
            <Face who="LP" size={20} /> Leo
          </dd>
        </div>
        <div>
          <dt className="text-faint">Due</dt>
          <dd className="mt-1.5 text-fg">Fri, Nov 6</dd>
        </div>
        <div>
          <dt className="text-faint">Approval</dt>
          <dd className="mt-1.5 text-amber">Requested</dd>
        </div>
      </dl>

      <ul className="mt-5 space-y-4 text-[0.86rem]">
        <Entry index={0}>
          <div className="flex gap-3">
            <Face who="MC" />
            <div>
              <p className="text-[0.78rem] text-faint">
                <span className="text-fg">Maya Chen</span> · 2h
              </p>
              <p className="mt-1 text-muted">
                <span className="rounded bg-brand/15 px-1 text-brand">@Leo Park</span> can we lead
                with annual pricing?
              </p>
            </div>
          </div>
        </Entry>
        <Entry index={1}>
          <div className="flex gap-3">
            <Face who="LP" />
            <div>
              <p className="text-[0.78rem] text-faint">
                <span className="text-fg">Leo Park</span> · 1h
              </p>
              <p className="mt-1 text-muted">Done — v3 is attached.</p>
              <span className="mt-2 inline-flex items-center gap-2 rounded-lg border border-line-2 bg-panel-2 px-2.5 py-1.5 text-[0.75rem] text-fg">
                <ImageIcon className="size-3.5 text-sky" /> pricing-v3.png
              </span>
            </div>
          </div>
        </Entry>
        <Entry index={2}>
          <p className="flex items-center gap-2 pl-10 text-[0.75rem] text-faint">
            <MoveRight className="size-3.5" /> Leo Park moved this task to Review
          </p>
        </Entry>
        <Entry index={3}>
          <div className="flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2.5">
            <span className="grid size-6 place-items-center rounded-full bg-brand text-ink">
              <Check className="size-3.5" strokeWidth={3} />
            </span>
            <p className="text-[0.84rem] text-fg">
              Ana Ruiz <span className="text-muted">approved this task</span>
            </p>
          </div>
        </Entry>
      </ul>
    </div>
  );
}

export function Collaborate() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotionPreference();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const nearY = useTransform(scrollYProgress, [0, 1], [90, -90]);
  const farY = useTransform(scrollYProgress, [0, 1], [40, -40]);

  return (
    <section
      id="collaborate"
      ref={ref}
      aria-labelledby="collaborate-title"
      className="relative overflow-x-clip py-28 lg:py-40"
    >
      <Container className="grid items-center gap-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <SectionHeading
            id="collaborate-title"
            eyebrow={collaborate.eyebrow}
            title={collaborate.title}
            lede={collaborate.lede}
          />
          <PointGrid points={collaborate.points} columns={2} className="mt-12" />
        </div>

        <div className="relative mx-auto w-full max-w-[540px]">
          <motion.div style={reduce ? undefined : { y: farY }}>
            <Tilt max={6} className="rounded-[20px]">
              <TaskPanel />
            </Tilt>
          </motion.div>

          {/* The mention picker, floating in front of the panel. */}
          <motion.div
            aria-hidden
            style={reduce ? undefined : { y: nearY }}
            className="glass absolute -top-10 -right-3 hidden w-56 rounded-2xl p-2 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)] sm:block lg:-right-10"
          >
            <p className="flex items-center gap-1.5 px-2 py-1 text-[0.72rem] text-faint">
              <AtSign className="size-3.5" /> le
            </p>
            <div className="mt-1 flex items-center gap-2.5 rounded-lg bg-white/[0.06] px-2 py-2 text-[0.8rem]">
              <Face who="LP" size={22} /> Leo Park
              <span className="ml-auto text-[0.68rem] text-faint">Design</span>
            </div>
            <div className="flex items-center gap-2.5 px-2 py-2 text-[0.8rem] text-muted">
              <span className="grid size-[22px] place-items-center rounded-full bg-white/10 text-[0.55rem]">
                LO
              </span>
              Lena Ortiz
              <span className="ml-auto text-[0.68rem] text-faint">Marketing</span>
            </div>
          </motion.div>

          {/* The notification Ana's approval sends. */}
          <motion.div
            aria-hidden
            style={reduce ? undefined : { y: nearY }}
            className="glass absolute -bottom-24 -left-4 hidden w-64 items-start gap-3 rounded-2xl p-3.5 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)] sm:flex lg:-left-14"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand/15 text-brand">
              <Bell className="size-4" />
            </span>
            <div className="text-[0.78rem]">
              <p className="text-fg">Ana Ruiz approved “Design the pricing page”</p>
              <p className="mt-1 text-faint">Inbox · just now</p>
            </div>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
