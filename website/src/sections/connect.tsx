'use client';

import { useAnimationFrame, useScroll } from 'framer-motion';
import {
  Braces,
  CalendarSync,
  FileSpreadsheet,
  Hash,
  KeyRound,
  Mail,
  MessageCircle,
  MessagesSquare,
  Upload,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { useRef } from 'react';

import { Mark } from '@/components/brand';
import { useReducedMotionPreference } from '@/components/motion';
import { Container, SectionHeading } from '@/components/ui';
import { connect } from '@/content/site';

/*
 * The tools CoreTask talks to, orbiting the mark on two tilted rings. Names
 * and generic icons only: third-party logos are their owners' to grant.
 */

const ICONS: Record<(typeof connect.apps)[number], LucideIcon> = {
  Slack: Hash,
  'Microsoft Teams': Users,
  'Google Chat': MessageCircle,
  Discord: MessagesSquare,
  Email: Mail,
  'Calendar feeds': CalendarSync,
  'REST API': Braces,
  Webhooks: Webhook,
  'OAuth apps': KeyRound,
  'Asana import': Upload,
  'CSV export': FileSpreadsheet,
};

const INNER = connect.apps.slice(0, 6);
const OUTER = connect.apps.slice(6);

type Ring = { names: readonly string[]; rx: number; ry: number; speed: number; phase: number };

const RINGS: Ring[] = [
  { names: INNER, rx: 0.3, ry: 0.16, speed: 0.12, phase: 0 },
  { names: OUTER, rx: 0.46, ry: 0.27, speed: -0.08, phase: 0.6 },
];

const CHIPS = RINGS.flatMap((ring) => ring.names.map((name, index) => ({ ring, name, index })));

/** Where a chip sits on its ring at `angle`, as percentages of the stage. */
function place(ring: Ring, index: number, angle: number) {
  const a =
    angle * ring.speed * Math.PI * 2 + ring.phase + (index / ring.names.length) * Math.PI * 2;
  const depth = (Math.sin(a) + 1) / 2; // 0 at the back, 1 at the front
  return {
    left: 50 + Math.cos(a) * ring.rx * 100,
    top: 50 + Math.sin(a) * ring.ry * 100,
    depth,
  };
}

function chipStyle(ring: Ring, index: number, angle: number) {
  const { left, top, depth } = place(ring, index, angle);
  // Rounded so the server's HTML and the client's first render agree exactly.
  return {
    left: `${left.toFixed(2)}%`,
    top: `${top.toFixed(2)}%`,
    opacity: (0.35 + depth * 0.65).toFixed(3),
    transform: `translate(-50%, -50%) scale(${(0.78 + depth * 0.26).toFixed(3)})`,
    zIndex: String(Math.round(depth * 20)),
  };
}

function Chip({ name }: { name: string }) {
  const Icon = ICONS[name as keyof typeof ICONS];
  return (
    <>
      <Icon aria-hidden className="size-4 text-brand" />
      {name}
    </>
  );
}

export function Connect() {
  const ref = useRef<HTMLElement>(null);
  const chips = useRef<(HTMLLIElement | null)[]>([]);
  const reduce = useReducedMotionPreference();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });

  // Written straight to the DOM each frame: eleven chips re-rendering through
  // React sixty times a second would be wasted work.
  useAnimationFrame((time) => {
    if (reduce) return;
    const angle = time / 1000 / 6 + scrollYProgress.get() * 1.5;
    CHIPS.forEach(({ ring, index }, slot) => {
      const el = chips.current[slot];
      if (el) Object.assign(el.style, chipStyle(ring, index, angle));
    });
  });

  return (
    <section
      id="integrations"
      ref={ref}
      aria-labelledby="integrations-title"
      className="relative overflow-x-clip py-28 lg:py-40"
    >
      <Container>
        <SectionHeading
          id="integrations-title"
          eyebrow={connect.eyebrow}
          title={connect.title}
          lede={connect.lede}
          align="center"
          className="max-w-4xl"
        />

        {reduce ? (
          <ul className="mx-auto mt-14 flex max-w-3xl flex-wrap justify-center gap-3">
            {connect.apps.map((name) => (
              <li
                key={name}
                className="glass flex items-center gap-2 rounded-full px-4 py-2 text-[0.88rem]"
              >
                <Chip name={name} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="relative mx-auto mt-6 aspect-[16/11] w-full max-w-[1000px] sm:aspect-[16/7]">
            {/* The rings themselves, drawn as tilted ellipses. */}
            {RINGS.map((ring) => (
              <div
                key={ring.rx}
                aria-hidden
                className="absolute rounded-[50%] border border-line-2"
                style={{
                  left: `${50 - ring.rx * 100}%`,
                  top: `${50 - ring.ry * 100}%`,
                  width: `${ring.rx * 200}%`,
                  height: `${ring.ry * 200}%`,
                }}
              />
            ))}
            <div className="absolute top-1/2 left-1/2 z-10 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-3xl border border-line-2 bg-panel shadow-[0_0_80px_-10px_rgb(133_200_84/0.45)] sm:size-28">
              <Mark id="orbit" className="h-10 w-auto text-fg sm:h-12" title="CoreTask" />
            </div>
            <ul aria-label="Integrations">
              {CHIPS.map(({ ring, name, index }, slot) => (
                <li
                  key={name}
                  ref={(el) => {
                    chips.current[slot] = el;
                  }}
                  style={chipStyle(ring, index, 0)}
                  className="glass absolute flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.78rem] whitespace-nowrap text-fg will-change-transform sm:px-4 sm:py-2 sm:text-[0.88rem]"
                >
                  <Chip name={name} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Container>
    </section>
  );
}
