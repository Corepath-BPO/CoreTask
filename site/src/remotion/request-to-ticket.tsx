import { Check, FileText, Hash, Mail } from 'lucide-react';
import type { ReactNode } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import {
  Avatar,
  C,
  K,
  KeyTag,
  L,
  MarkGlyph,
  MONO,
  Panel,
  Pill,
  Stage,
  curvePath,
  curvePoint,
  type Curve,
  type Point,
} from './theme';

/*
 * Capture: an email, a Slack message and a form submission each travel into
 * CoreTask and land in the ticket queue as a keyed, assigned ticket.
 * 180 frames at 30 fps; the page scrubs it with the scroll position.
 */

type Source = {
  y: number;
  icon: ReactNode;
  label: string;
  who: string;
  text: string;
};

type Row = {
  key: string;
  title: string;
  type: string;
  typeColor: string;
  priority: string;
  priorityColor: string;
  who: string;
  whoColor: string;
  via?: string;
};

const SOURCES: Source[] = [
  {
    y: 130,
    icon: <Mail size={16} />,
    label: 'Email to project',
    who: 'Dana Whitfield',
    text: 'Laptop for Monday’s new hire?',
  },
  {
    y: 325,
    icon: <Hash size={16} />,
    label: 'Slack · #ops-help',
    who: 'Leo Park',
    text: 'The VPN dropped again. Anyone?',
  },
  {
    y: 520,
    icon: <FileText size={16} />,
    label: 'Intake form · IT access',
    who: 'Priya Shah',
    text: 'CRM access for 3 new hires',
  },
];

const NEW_ROWS: Row[] = [
  {
    key: 'CORE-1042',
    title: 'Laptop for Monday’s new hire',
    type: 'Request',
    typeColor: C.sky,
    priority: 'Medium',
    priorityColor: C.amber,
    who: 'SO',
    whoColor: C.violet,
    via: 'Email',
  },
  {
    key: 'CORE-1043',
    title: 'VPN drops every 20 minutes',
    type: 'Bug',
    typeColor: C.rose,
    priority: 'High',
    priorityColor: C.rose,
    who: 'AR',
    whoColor: C.sky,
    via: 'Slack',
  },
  {
    key: 'CORE-1044',
    title: 'CRM access for 3 new hires',
    type: 'Access',
    typeColor: C.amber,
    priority: 'Medium',
    priorityColor: C.amber,
    who: 'MC',
    whoColor: C.brand,
    via: 'Form',
  },
];

const OLD_ROWS: Row[] = [
  {
    key: 'CORE-1041',
    title: 'Printer on floor 2 is offline',
    type: 'Request',
    typeColor: C.sky,
    priority: 'Low',
    priorityColor: C.faint,
    who: 'SO',
    whoColor: C.violet,
  },
  {
    key: 'CORE-1040',
    title: 'Renew the SSL certificate',
    type: 'Task',
    typeColor: C.brand,
    priority: 'Medium',
    priorityColor: C.amber,
    who: 'AR',
    whoColor: C.sky,
  },
  {
    key: 'CORE-1039',
    title: 'Update the onboarding checklist',
    type: 'Task',
    typeColor: C.brand,
    priority: 'Low',
    priorityColor: C.faint,
    who: 'MC',
    whoColor: C.brand,
  },
];

const HUB: Point = [624, 400];
const QUEUE = { x: 776, y: 86, w: 448, h: 628 };
const ROW_TOP = QUEUE.y + 76;
const SLOT = 78;
const ENTRY: Point = [QUEUE.x, ROW_TOP + 35];

/** When source `i` starts travelling. */
const start = (i: number) => 24 + i * 42;

function legIn(i: number): Curve {
  const y = SOURCES[i].y + 75;
  return [
    [428, y],
    [505, y],
    [515, HUB[1]],
    [HUB[0] - 64, HUB[1]],
  ];
}

const LEG_OUT: Curve = [[HUB[0] + 64, HUB[1]], [736, HUB[1]], [736, ENTRY[1]], ENTRY];

function QueueRow({ row, y, appear }: { row: Row; y: number; appear: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 14,
        right: 14,
        top: y,
        height: 70,
        opacity: appear,
        translate: `${(1 - appear) * 24}px 0`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 14px 0 0',
        borderRadius: 12,
        background: row.via ? C.panel2 : 'transparent',
        border: `1px solid ${row.via ? C.line2 : C.line}`,
        overflow: 'hidden',
      }}
    >
      <div style={{ width: 3, alignSelf: 'stretch', background: row.typeColor }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <KeyTag>{row.key}</KeyTag>
          {row.via && (
            <Pill color={C.brand} style={{ height: 20, fontSize: 11, padding: '0 8px' }}>
              New · via {row.via}
            </Pill>
          )}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 16,
            fontWeight: 500,
            color: C.fg,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {row.title}
        </div>
      </div>
      <Pill color={row.priorityColor}>{row.priority}</Pill>
      <Avatar initials={row.who} color={row.whoColor} />
    </div>
  );
}

export function RequestToTicket() {
  const frame = useCurrentFrame();

  // Each new row opens its slot as its ticket arrives, pushing the rest down.
  const grow = NEW_ROWS.map((_, i) =>
    interpolate(frame, [start(i) + 28, start(i) + 40], [0, 1], K),
  );
  const order = [
    { row: NEW_ROWS[2], h: grow[2] },
    { row: NEW_ROWS[1], h: grow[1] },
    { row: NEW_ROWS[0], h: grow[0] },
    ...OLD_ROWS.map((row) => ({ row, h: 1 })),
  ];
  let offset = 0;
  const placed = order.map((item) => {
    const y = offset;
    offset += item.h * SLOT;
    return { ...item, y };
  });
  const open = OLD_ROWS.length + grow.reduce((sum, g) => sum + (g > 0.5 ? 1 : 0), 0);

  const intro = interpolate(frame, [0, 16], [0, 1], K);
  const hubPulse = NEW_ROWS.reduce(
    (max, _, i) =>
      Math.max(
        max,
        interpolate(frame, [start(i) + 12, start(i) + 17, start(i) + 26], [0, 1, 0], L),
      ),
    0,
  );
  const outro = interpolate(frame, [150, 165], [0, 1], K);

  return (
    <Stage>
      <div
        style={{
          position: 'absolute',
          left: 56,
          top: 84,
          fontFamily: MONO,
          fontSize: 13,
          letterSpacing: 2,
          color: C.faint,
          opacity: intro,
        }}
      >
        INCOMING
      </div>

      {/* Connectors, dim at rest and drawn in green as each request travels. */}
      <svg width={1280} height={800} style={{ position: 'absolute', inset: 0 }}>
        {SOURCES.map((_, i) => {
          const draw = interpolate(frame, [start(i), start(i) + 16], [0, 1], L);
          return (
            <g key={i}>
              <path
                d={curvePath(legIn(i))}
                stroke={C.line2}
                strokeWidth={2}
                fill="none"
                strokeDasharray="4 6"
                opacity={intro}
              />
              <path
                d={curvePath(legIn(i))}
                stroke={C.brand}
                strokeWidth={2}
                fill="none"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - draw}
                opacity={0.9}
              />
            </g>
          );
        })}
        <path
          d={curvePath(LEG_OUT)}
          stroke={C.line2}
          strokeWidth={2}
          fill="none"
          strokeDasharray="4 6"
          opacity={intro}
        />
        <path
          d={curvePath(LEG_OUT)}
          stroke={C.brand}
          strokeWidth={2}
          fill="none"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - interpolate(frame, [start(0) + 16, start(0) + 32], [0, 1], L)}
          opacity={0.9}
        />
      </svg>

      {SOURCES.map((source, i) => {
        const lit = interpolate(frame, [start(i), start(i) + 8], [0, 1], K);
        const captured = interpolate(frame, [start(i) + 32, start(i) + 40], [0, 1], K);
        return (
          <Panel
            key={source.label}
            style={{
              left: 56,
              top: source.y,
              width: 372,
              height: 150,
              padding: 20,
              background: C.panel,
              borderColor: lit > 0.5 ? 'rgba(133,200,84,0.55)' : C.line2,
              boxShadow: `0 0 ${40 * lit}px -10px rgba(133,200,84,${0.5 * lit}), 0 40px 100px -40px rgba(0,0,0,0.9)`,
              opacity: interpolate(frame, [i * 4, i * 4 + 14], [0, 1], K),
              translate: `${interpolate(frame, [i * 4, i * 4 + 14], [-24, 0], K)}px 0`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: C.faint,
                fontSize: 14,
              }}
            >
              {source.icon}
              {source.label}
            </div>
            <div style={{ marginTop: 14, fontSize: 14, color: C.muted }}>{source.who}</div>
            <div style={{ marginTop: 2, fontSize: 18, fontWeight: 500 }}>{source.text}</div>
            <div
              style={{
                position: 'absolute',
                right: 16,
                bottom: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: C.brand,
                opacity: captured,
              }}
            >
              <Check size={14} strokeWidth={3} /> Captured as {NEW_ROWS[i].key}
            </div>
          </Panel>
        );
      })}

      {/* The hub: CoreTask itself. */}
      <div
        style={{
          position: 'absolute',
          left: HUB[0] - 64,
          top: HUB[1] - 64,
          width: 128,
          height: 128,
          borderRadius: 32,
          display: 'grid',
          placeItems: 'center',
          background: C.panel2,
          border: `1px solid ${C.line2}`,
          boxShadow: `0 0 ${30 + 50 * hubPulse}px ${4 * hubPulse}px rgba(133,200,84,${0.15 + 0.35 * hubPulse})`,
          scale: 1 + hubPulse * 0.06,
          opacity: intro,
        }}
      >
        <MarkGlyph size={64} done={interpolate(frame, [start(0) + 18, start(0) + 30], [0, 1], K)} />
      </div>

      {/* Packets in flight. */}
      {NEW_ROWS.map((row, i) => {
        const s = start(i);
        const t1 = interpolate(frame, [s, s + 16], [0, 1], K);
        const t2 = interpolate(frame, [s + 16, s + 32], [0, 1], K);
        const inFlight = frame >= s && frame <= s + 32;
        const [x, y] = frame < s + 16 ? curvePoint(legIn(i), t1) : curvePoint(LEG_OUT, t2);
        return (
          <div
            key={row.key}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              translate: '-50% -50%',
              opacity: inFlight ? 1 : 0,
              padding: '6px 12px',
              borderRadius: 999,
              background: C.brand,
              color: C.ink,
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 600,
              boxShadow: '0 0 30px rgba(133,200,84,0.6)',
            }}
          >
            {row.key}
          </div>
        );
      })}

      <Panel
        style={{
          left: QUEUE.x,
          top: QUEUE.y,
          width: QUEUE.w,
          height: QUEUE.h,
          opacity: intro,
          translate: `${(1 - intro) * 30}px 0`,
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 18px',
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 600 }}>Ticket queue</div>
          <Pill color={C.brand}>Open · {open}</Pill>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 76, bottom: 0 }}>
          {placed.map(({ row, y, h }) => (
            <QueueRow key={row.key} row={row} y={y} appear={row.via ? h : 1} />
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 14,
            right: 14,
            bottom: 14,
            height: 52,
            borderRadius: 12,
            background: '#16201a',
            border: '1px solid rgba(133,200,84,0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 16px',
            fontSize: 15,
            color: C.fg,
            opacity: outro,
            translate: `0 ${(1 - outro) * 16}px`,
          }}
        >
          <Check size={18} color={C.brand} strokeWidth={3} />3 requests in · 3 assigned · nothing
          lost
        </div>
      </Panel>
    </Stage>
  );
}
