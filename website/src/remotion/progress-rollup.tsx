import { Check, Target } from 'lucide-react';
import { interpolate, useCurrentFrame } from 'remotion';

import { Avatar, C, K, L, MONO, Panel, Pill, Stage } from './theme';

/*
 * Track: a goal's progress fills from its connected projects, a burn-up chart
 * draws, and the workload view catches someone over capacity — then a task
 * moves to a teammate with room.
 * 180 frames at 30 fps; the page scrubs it with the scroll position.
 */

const PROJECTS = [
  { name: 'Portal backend', value: 82 },
  { name: 'Design system', value: 64 },
  { name: 'Onboarding content', value: 45 },
];

const CHART = { x: 700, y: 160, w: 480, h: 220, max: 60 };
const SCOPE = [40, 42, 48, 48, 52, 52];
const DONE = [4, 12, 21, 29, 35, 41];

const WORKLOAD = [
  { initials: 'MC', name: 'Maya', color: C.brand, from: 70, to: 70 },
  { initials: 'LP', name: 'Leo', color: C.amber, from: 120, to: 85 },
  { initials: 'AR', name: 'Ana', color: C.sky, from: 40, to: 75 },
  { initials: 'SO', name: 'Sam', color: C.violet, from: 65, to: 65 },
];

const toChart = (values: number[]) =>
  values.map((v, i) => [
    CHART.x + (i / (values.length - 1)) * CHART.w,
    CHART.y + CHART.h - (v / CHART.max) * CHART.h,
  ]);

const polyline = (points: number[][]) => points.map(([x, y]) => `${x},${y}`).join(' ');

function CardTitle({ children }: { children: string }) {
  return <div style={{ fontSize: 16, fontWeight: 600, color: C.fg }}>{children}</div>;
}

export function ProgressRollup() {
  const frame = useCurrentFrame();
  const intro = interpolate(frame, [0, 14], [0, 1], K);
  const goal = interpolate(frame, [12, 100], [0, 68], K);
  const onTrack = interpolate(frame, [96, 106], [0, 1], K);
  const draw = interpolate(frame, [30, 120], [0, 1], L);
  const move = interpolate(frame, [120, 146], [0, 1], K);
  const settle = interpolate(frame, [134, 152], [0, 1], K);
  const rebalanced = interpolate(frame, [150, 160], [0, 1], K);

  const ring = 2 * Math.PI * 70;
  const done = toChart(DONE);
  const scope = toChart(SCOPE);
  const card = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 14], [0, 1], K),
    translate: `0 ${interpolate(frame, [delay, delay + 14], [20, 0], K)}px`,
  });

  return (
    <Stage>
      <div
        style={{
          position: 'absolute',
          left: 62,
          top: 46,
          fontSize: 15,
          color: C.muted,
          opacity: intro,
        }}
      >
        Goals <span style={{ color: C.faint }}>›</span>{' '}
        <span style={{ color: C.fg, fontWeight: 600 }}>Q4 2026</span>
      </div>

      {/* The goal, rolled up from its projects. */}
      <Panel style={{ left: 60, top: 90, width: 560, height: 250, padding: 26, ...card(0) }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.faint, fontSize: 13 }}
        >
          <Target size={15} /> Company goal
        </div>
        <div style={{ marginTop: 12, fontSize: 26, fontWeight: 600, lineHeight: 1.15, width: 300 }}>
          Launch the new client portal
        </div>
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 14,
            color: C.muted,
          }}
        >
          <Avatar initials="MC" color={C.brand} size={26} /> Maya Chen · Q4 2026
        </div>
        <div style={{ marginTop: 18 }}>
          <Pill color={C.brand} style={{ opacity: onTrack, scale: 0.85 + 0.15 * onTrack }}>
            <Check size={13} strokeWidth={3} /> On track
          </Pill>
        </div>
        <svg width={170} height={170} style={{ position: 'absolute', right: 26, top: 40 }}>
          <circle cx={85} cy={85} r={70} stroke={C.panel3} strokeWidth={12} fill="none" />
          <circle
            cx={85}
            cy={85}
            r={70}
            stroke={C.brand}
            strokeWidth={12}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={ring}
            strokeDashoffset={ring * (1 - goal / 100)}
            transform="rotate(-90 85 85)"
          />
          <text x={85} y={92} textAnchor="middle" fill={C.fg} fontSize={32} fontWeight={600}>
            {Math.round(goal)}%
          </text>
        </svg>
      </Panel>

      <Panel style={{ left: 60, top: 370, width: 560, height: 340, padding: 26, ...card(6) }}>
        <CardTitle>Connected projects</CardTitle>
        {PROJECTS.map((project, i) => {
          const value = interpolate(frame, [20 + i * 10, 90 + i * 10], [0, project.value], K);
          return (
            <div key={project.name} style={{ marginTop: i === 0 ? 30 : 34 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15 }}>
                <span>{project.name}</span>
                <span style={{ fontFamily: MONO, color: C.muted }}>{Math.round(value)}%</span>
              </div>
              <div style={{ marginTop: 10, height: 10, borderRadius: 10, background: C.panel3 }}>
                <div
                  style={{
                    width: `${value}%`,
                    height: '100%',
                    borderRadius: 10,
                    background: `linear-gradient(90deg, rgba(133,200,84,0.55), ${C.brand})`,
                  }}
                />
              </div>
            </div>
          );
        })}
        <div style={{ position: 'absolute', left: 26, bottom: 24, fontSize: 13, color: C.faint }}>
          The goal’s progress rolls up from these projects automatically.
        </div>
      </Panel>

      {/* Burn-up: work done climbing towards the scope. */}
      <Panel style={{ left: 660, top: 90, width: 560, height: 330, padding: 26, ...card(10) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <CardTitle>Burn-up · client portal</CardTitle>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: C.faint }}>
            <span style={{ color: C.brand }}>● Completed</span>
            <span>┄ Scope</span>
          </div>
        </div>
      </Panel>
      <svg
        width={1280}
        height={800}
        style={{ position: 'absolute', inset: 0, opacity: card(10).opacity }}
      >
        <defs>
          <linearGradient id="burnup-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={C.brand} stopOpacity={0.28} />
            <stop offset="100%" stopColor={C.brand} stopOpacity={0} />
          </linearGradient>
          <clipPath id="burnup-reveal">
            <rect x={CHART.x - 10} y={0} width={(CHART.w + 20) * draw} height={800} />
          </clipPath>
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1={CHART.x}
            x2={CHART.x + CHART.w}
            y1={CHART.y + (i * CHART.h) / 3}
            y2={CHART.y + (i * CHART.h) / 3}
            stroke={C.line}
          />
        ))}
        <polyline
          points={polyline(scope)}
          fill="none"
          stroke={C.faint}
          strokeWidth={2}
          strokeDasharray="6 6"
        />
        <g clipPath="url(#burnup-reveal)">
          <polygon
            points={`${polyline(done)} ${CHART.x + CHART.w},${CHART.y + CHART.h} ${CHART.x},${CHART.y + CHART.h}`}
            fill="url(#burnup-fill)"
          />
          <polyline
            points={polyline(done)}
            fill="none"
            stroke={C.brand}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          {done.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={4.5} fill={C.ink} stroke={C.brand} strokeWidth={2.5} />
          ))}
        </g>
        {SCOPE.map((_, i) => (
          <text
            key={i}
            x={CHART.x + (i / (SCOPE.length - 1)) * CHART.w}
            y={CHART.y + CHART.h + 26}
            textAnchor="middle"
            fill={C.faint}
            fontSize={12}
            fontFamily={MONO}
          >
            W{i + 1}
          </text>
        ))}
      </svg>

      {/* Workload: someone is over capacity, until a task moves. */}
      <Panel style={{ left: 660, top: 450, width: 560, height: 260, padding: 26, ...card(16) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <CardTitle>Workload · this week</CardTitle>
          <Pill color={C.brand} style={{ opacity: rebalanced }}>
            <Check size={13} strokeWidth={3} /> Rebalanced
          </Pill>
        </div>
        {WORKLOAD.map((person, i) => {
          const grown = interpolate(frame, [60 + i * 6, 100 + i * 6], [0, 1], K);
          const load = (person.from + (person.to - person.from) * settle) * grown;
          const over = load > 100;
          return (
            <div
              key={person.name}
              style={{
                marginTop: i === 0 ? 22 : 12,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Avatar initials={person.initials} color={person.color} size={26} />
              <span style={{ width: 44, fontSize: 14, color: C.muted }}>{person.name}</span>
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  height: 12,
                  borderRadius: 12,
                  background: C.panel3,
                }}
              >
                <div
                  style={{
                    width: `${(load / 130) * 100}%`,
                    height: '100%',
                    borderRadius: 12,
                    background: over ? C.rose : C.brand,
                  }}
                />
                {/* Capacity: 100% of the 130% scale. */}
                <div
                  style={{
                    position: 'absolute',
                    left: `${(100 / 130) * 100}%`,
                    top: -5,
                    bottom: -5,
                    width: 2,
                    background: C.fg,
                    opacity: 0.5,
                  }}
                />
              </div>
              <span
                style={{
                  width: 44,
                  textAlign: 'right',
                  fontFamily: MONO,
                  fontSize: 13,
                  color: over ? C.rose : C.muted,
                }}
              >
                {Math.round(load)}%
              </span>
            </div>
          );
        })}
      </Panel>

      {/* The task that moves from Leo to Ana. */}
      <div
        style={{
          position: 'absolute',
          left: 900,
          top: 560 + move * 38,
          padding: '6px 12px',
          borderRadius: 999,
          background: C.panel2,
          border: `1px solid ${C.line2}`,
          fontSize: 13,
          color: C.fg,
          boxShadow: '0 10px 30px -10px rgba(0,0,0,0.9)',
          opacity: interpolate(frame, [114, 122, 150, 160], [0, 1, 1, 0], L),
          scale: 1 + 0.08 * Math.sin(move * Math.PI),
        }}
      >
        QA on mobile · 6 h
      </div>
    </Stage>
  );
}
