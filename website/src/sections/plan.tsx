'use client';

import {
  LayoutGroup,
  motion,
  useMotionValueEvent,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { CalendarDays, ChartGantt, Diamond, List, SquareKanban } from 'lucide-react';
import { useRef, useState } from 'react';

import { Reveal } from '@/components/motion';
import { ScrollStage } from '@/components/scroll-stage';
import { Container, PointGrid, cx } from '@/components/ui';
import { plan } from '@/content/site';

/*
 * Plan: one set of tasks, four views. Scrolling steps through List, Board,
 * Timeline and Calendar, and each task flies from its place in one view to its
 * place in the next — the point being that it is the same work throughout.
 */

type Task = {
  id: string;
  title: string;
  section: 'To do' | 'In progress' | 'Review';
  who: string;
  color: string;
  due: string;
  /** Day of November 2026. */
  start: number;
  end: number;
  priority: 'High' | 'Medium' | 'Low';
  milestone?: boolean;
};

const TASKS: Task[] = [
  {
    id: 'launch-post',
    title: 'Write the launch announcement',
    section: 'To do',
    who: 'MC',
    color: '#85c854',
    due: 'Nov 4',
    start: 2,
    end: 4,
    priority: 'Medium',
  },
  {
    id: 'pricing',
    title: 'Design the pricing page',
    section: 'In progress',
    who: 'LP',
    color: '#f2b33d',
    due: 'Nov 6',
    start: 3,
    end: 6,
    priority: 'High',
  },
  {
    id: 'blog',
    title: 'Migrate blog posts',
    section: 'In progress',
    who: 'AR',
    color: '#38bdf8',
    due: 'Nov 9',
    start: 4,
    end: 9,
    priority: 'Low',
  },
  {
    id: 'analytics',
    title: 'Set up analytics events',
    section: 'To do',
    who: 'SO',
    color: '#a78bfa',
    due: 'Nov 10',
    start: 6,
    end: 10,
    priority: 'Medium',
  },
  {
    id: 'qa',
    title: 'QA on mobile',
    section: 'Review',
    who: 'PS',
    color: '#fb7185',
    due: 'Nov 12',
    start: 9,
    end: 12,
    priority: 'High',
  },
  {
    id: 'go-live',
    title: 'Go live',
    section: 'Review',
    who: 'MC',
    color: '#85c854',
    due: 'Nov 13',
    start: 13,
    end: 13,
    priority: 'High',
    milestone: true,
  },
];

const SECTIONS = ['To do', 'In progress', 'Review'] as const;
const PRIORITY_COLOR = { High: '#fb7185', Medium: '#f2b33d', Low: '#84848f' } as const;
// Timeline and calendar span Mon 2 – Fri 13 November 2026.
const FIRST_DAY = 2;
const DAYS = 12;
const ICONS = [List, SquareKanban, ChartGantt, CalendarDays];

const spring = { type: 'spring', stiffness: 210, damping: 28, mass: 0.9 } as const;

function Avatar({ who, color }: { who: string; color: string }) {
  return (
    <motion.span
      layout="position"
      className="grid size-6 shrink-0 place-items-center rounded-full text-[0.6rem] font-semibold"
      style={{ background: `${color}26`, color, boxShadow: `inset 0 0 0 1px ${color}55` }}
    >
      {who}
    </motion.span>
  );
}

function Title({ task, wrap, className }: { task: Task; wrap?: boolean; className?: string }) {
  return (
    <motion.span layout="position" className={cx(wrap ? 'line-clamp-2' : 'truncate', className)}>
      {task.title}
    </motion.span>
  );
}

function ListView() {
  return (
    <div className="text-[0.82rem]">
      <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-line px-4 pb-2 text-[0.72rem] text-faint sm:grid-cols-[1fr_90px_80px_80px]">
        <span>Task name</span>
        <span className="hidden sm:block">Assignee</span>
        <span className="hidden sm:block">Due date</span>
        <span>Priority</span>
      </div>
      {TASKS.map((task) => (
        <motion.div
          key={task.id}
          layoutId={task.id}
          transition={spring}
          className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-line bg-panel px-4 py-2.5 sm:grid-cols-[1fr_90px_80px_80px]"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <motion.span
              layout="position"
              className="size-3.5 shrink-0 rounded-full border-[1.5px]"
              style={{ borderColor: task.color }}
            />
            <Title task={task} className="text-fg" />
          </span>
          <span className="hidden sm:block">
            <Avatar who={task.who} color={task.color} />
          </span>
          <motion.span layout="position" className="hidden text-muted sm:block">
            {task.due}
          </motion.span>
          <motion.span layout="position" style={{ color: PRIORITY_COLOR[task.priority] }}>
            {task.priority}
          </motion.span>
        </motion.div>
      ))}
    </div>
  );
}

function BoardView() {
  return (
    <div className="grid h-full grid-cols-3 gap-2 px-3 sm:gap-3 sm:px-4">
      {SECTIONS.map((section) => (
        <div key={section} className="min-w-0 rounded-xl bg-white/[0.025] p-2 sm:p-2.5">
          <p className="mb-2 px-1 text-[0.72rem] text-faint">
            {section} · {TASKS.filter((t) => t.section === section).length}
          </p>
          <div className="space-y-2">
            {TASKS.filter((t) => t.section === section).map((task) => (
              <motion.div
                key={task.id}
                layoutId={task.id}
                transition={spring}
                className="rounded-lg border border-line-2 bg-panel-2 p-2.5 text-[0.8rem] sm:p-3"
              >
                <Title task={task} wrap className="text-fg" />
                <motion.div
                  layout="position"
                  className="mt-2.5 flex items-center justify-between gap-2"
                >
                  <span className="text-[0.7rem]" style={{ color: PRIORITY_COLOR[task.priority] }}>
                    {task.priority}
                  </span>
                  <Avatar who={task.who} color={task.color} />
                </motion.div>
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineView() {
  return (
    <div className="px-3 text-[0.78rem] sm:px-4">
      <div className="grid grid-cols-[minmax(0,150px)_1fr] gap-3 border-b border-line pb-2 text-[0.68rem] text-faint">
        <span className="hidden sm:block">Task</span>
        <div
          className="col-span-2 grid sm:col-span-1"
          style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}
        >
          {Array.from({ length: DAYS }, (_, i) => (
            <span key={i} className="text-center">
              {FIRST_DAY + i}
            </span>
          ))}
        </div>
      </div>
      {TASKS.map((task) => (
        <div
          key={task.id}
          className="grid grid-cols-[minmax(0,150px)_1fr] items-center gap-3 py-[7px]"
        >
          <span className="hidden truncate text-muted sm:block">{task.title}</span>
          <div
            className="col-span-2 grid sm:col-span-1"
            style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}
          >
            {task.milestone ? (
              <motion.div
                layoutId={task.id}
                transition={spring}
                className="mx-auto grid size-7 place-items-center"
                style={{ gridColumn: `${task.start - FIRST_DAY + 1}` }}
              >
                <Diamond className="size-5 fill-brand text-brand" />
              </motion.div>
            ) : (
              <motion.div
                layoutId={task.id}
                transition={spring}
                className="flex h-7 items-center gap-2 overflow-hidden rounded-md px-2"
                style={{
                  gridColumn: `${task.start - FIRST_DAY + 1} / ${task.end - FIRST_DAY + 2}`,
                  background: `${task.color}33`,
                  boxShadow: `inset 0 0 0 1px ${task.color}66`,
                }}
              >
                <Avatar who={task.who} color={task.color} />
                <Title task={task} className="text-[0.72rem] text-fg sm:hidden" />
              </motion.div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CalendarView() {
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="px-3 sm:px-4">
      <div className="grid grid-cols-7 gap-1.5 pb-1.5 text-[0.68rem] text-faint">
        {weekdays.map((d) => (
          <span key={d} className="px-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 14 }, (_, i) => {
          const day = FIRST_DAY + i;
          const due = TASKS.filter((t) => t.end === day);
          const weekend = i % 7 >= 5;
          return (
            <div
              key={day}
              className={cx(
                'h-[92px] min-w-0 rounded-lg border border-line p-1.5 sm:h-[118px]',
                weekend ? 'bg-white/[0.01]' : 'bg-white/[0.03]',
              )}
            >
              <span className="text-[0.68rem] text-faint">{day}</span>
              {due.map((task) => (
                <motion.div
                  key={task.id}
                  layoutId={task.id}
                  transition={spring}
                  className="mt-1 flex items-center gap-1.5 overflow-hidden rounded-md px-1.5 py-1 text-[0.7rem]"
                  style={{
                    background: `${task.color}2b`,
                    boxShadow: `inset 0 0 0 1px ${task.color}55`,
                  }}
                >
                  <Title task={task} className="text-fg" />
                </motion.div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const VIEWS = [ListView, BoardView, TimelineView, CalendarView];

function Stage({ progress, reduce }: { progress: MotionValue<number>; reduce: boolean }) {
  const [view, setView] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  useMotionValueEvent(progress, 'change', (v) => {
    if (!reduce) setView(Math.min(3, Math.max(0, Math.floor((v - 0.04) * 4.4))));
  });
  const rotateX = useTransform(progress, [0, 0.15, 0.85, 1], [14, 4, 4, -4]);
  const View = VIEWS[view];

  // In the pinned layout a tab scrolls the page to its view, so the scroll
  // position and the view never disagree; otherwise it just switches.
  function select(index: number) {
    const section = stage.current?.closest('section');
    if (reduce || !section) {
      setView(index);
      return;
    }
    const top = section.getBoundingClientRect().top + window.scrollY;
    const travel = section.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + travel * ((index + 0.5) / 4.4 + 0.04), behavior: 'smooth' });
  }

  return (
    <Container className="w-full">
      <div ref={stage}>
        <Reveal>
          <p className="eyebrow">{plan.eyebrow}</p>
        </Reveal>
        <Reveal delay={0.05}>
          <h2 id="plan-title" className="headline mt-4 max-w-5xl">
            {plan.title}
          </h2>
        </Reveal>
      </div>
      <div className="mt-5 grid items-center gap-5 lg:grid-cols-[1fr_auto]">
        <Reveal delay={0.1}>
          <p className="lede max-w-2xl">{plan.lede}</p>
        </Reveal>
        <div
          role="group"
          aria-label="Project views"
          className="glass flex w-fit gap-1 rounded-full p-1"
        >
          {plan.views.map((label, i) => {
            const Icon = ICONS[i];
            return (
              <button
                key={label}
                type="button"
                aria-pressed={view === i}
                onClick={() => select(i)}
                className={cx(
                  'relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.82rem] transition-colors',
                  view === i ? 'text-ink' : 'text-muted hover:text-fg',
                )}
              >
                {view === i && (
                  <motion.span
                    layoutId="plan-tab"
                    transition={spring}
                    className="absolute inset-0 rounded-full bg-brand"
                  />
                )}
                <Icon aria-hidden className="relative hidden size-3.5 sm:block" />
                <span className="relative">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6" style={{ perspective: 1600 }}>
        <motion.div
          style={reduce ? undefined : { rotateX, transformOrigin: '50% 0%' }}
          className="overflow-hidden rounded-[20px] border border-line-2 bg-panel shadow-[0_60px_140px_-50px_rgb(0_0_0/0.95)]"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="size-3 rounded-[4px] bg-sky" />
              <span className="text-[0.9rem] font-medium">Website relaunch</span>
            </div>
            <div className="flex -space-x-1.5">
              {['MC', 'LP', 'AR', 'SO'].map((who, i) => (
                <span
                  key={who}
                  className="grid size-6 place-items-center rounded-full border-2 border-panel text-[0.55rem] font-semibold text-ink"
                  style={{ background: ['#85c854', '#f2b33d', '#38bdf8', '#a78bfa'][i] }}
                >
                  {who}
                </span>
              ))}
            </div>
          </div>
          {/* Aria-hidden: the tasks are scenery; the tab buttons above are the interface. */}
          <div
            aria-hidden
            className="h-[clamp(260px,40svh,400px)] overflow-hidden pt-4 sm:h-[clamp(300px,46svh,400px)]"
          >
            <LayoutGroup>
              <View />
            </LayoutGroup>
          </div>
        </motion.div>
      </div>
    </Container>
  );
}

export function Plan() {
  return (
    <div>
      <ScrollStage id="plan" labelledBy="plan-title" height="h-[360svh]">
        {(progress, reduce) => <Stage progress={progress} reduce={reduce} />}
      </ScrollStage>
      <Container className="pb-28 lg:pb-36">
        <PointGrid points={plan.points} />
      </Container>
    </div>
  );
}
