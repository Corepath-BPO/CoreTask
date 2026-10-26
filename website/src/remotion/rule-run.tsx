import {
  ArrowDownToLine,
  Check,
  Flag,
  Hash,
  MessageSquareReply,
  Sparkles,
  UserRound,
  Zap,
} from 'lucide-react';
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
 * Automate: a ticket arrives, a rule fires, "Check with AI" decides it is
 * urgent, and the Yes branch sets the priority, assigns the on-call person and
 * posts to Slack — while the No branch is skipped.
 * 210 frames at 30 fps; the page scrubs it with the scroll position.
 */

const line = (a: Point, b: Point): Curve => [
  a,
  [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
  [a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3],
  b,
];

const EDGES = {
  ticket: line([400, 190], [490, 172]),
  trigger: line([640, 214], [640, 270]),
  yes: [
    [640, 370],
    [640, 410],
    [395, 400],
    [395, 440],
  ] as Curve,
  no: [
    [640, 370],
    [640, 410],
    [885, 400],
    [885, 440],
  ] as Curve,
  yes2: line([395, 516], [395, 535]),
  yes3: line([395, 611], [395, 630]),
  no2: line([885, 516], [885, 535]),
};

/** Edge name, and the frames over which the run travels along it. */
const RUN: [keyof typeof EDGES, number, number][] = [
  ['ticket', 30, 40],
  ['trigger', 42, 52],
  ['yes', 88, 100],
  ['yes2', 110, 118],
  ['yes3', 128, 136],
];

function Node({
  x,
  y,
  w = 330,
  h = 76,
  icon,
  kicker,
  title,
  lit,
  done,
  dim = 0,
  children,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  icon: ReactNode;
  kicker: string;
  title: ReactNode;
  lit: number;
  done?: number;
  dim?: number;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 14,
        background: lit > 0.5 ? '#16201a' : C.panel2,
        border: `1px solid ${lit > 0.5 ? 'rgba(133,200,84,0.6)' : C.line2}`,
        boxShadow: `0 0 ${36 * lit}px -8px rgba(133,200,84,${0.55 * lit})`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 16px',
        opacity: 1 - dim * 0.6,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          display: 'grid',
          placeItems: 'center',
          background: lit > 0.5 ? C.brand : C.panel3,
          color: lit > 0.5 ? C.ink : C.muted,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, color: C.faint }}>
          {kicker}
        </div>
        <div style={{ marginTop: 3, fontSize: 16, fontWeight: 500, color: C.fg }}>{title}</div>
        {children}
      </div>
      {done !== undefined && (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 24,
            background: C.brand,
            color: C.ink,
            display: 'grid',
            placeItems: 'center',
            opacity: done,
            scale: 0.6 + 0.4 * done,
          }}
        >
          <Check size={14} strokeWidth={3} />
        </div>
      )}
    </div>
  );
}

export function RuleRun() {
  const frame = useCurrentFrame();
  const intro = interpolate(frame, [0, 14], [0, 1], K);
  const at = (f: number, span = 8) => interpolate(frame, [f, f + span], [0, 1], K);

  const thinking = frame >= 52 && frame < 86;
  const dots = '.'.repeat(1 + (Math.floor(frame / 5) % 3));
  const answered = at(86);
  const skipped = at(100);
  const ran = at(170, 12);

  const token = RUN.find(([, from, to]) => frame >= from && frame <= to);
  const tokenAt = token
    ? curvePoint(EDGES[token[0]], interpolate(frame, [token[1], token[2]], [0, 1], K))
    : null;

  return (
    <Stage>
      <Panel
        style={{
          left: 40,
          top: 40,
          width: 1200,
          height: 720,
          background: C.ink,
          opacity: intro,
          scale: 0.98 + 0.02 * intro,
        }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 22px',
            borderBottom: `1px solid ${C.line}`,
            background: C.panel,
          }}
        >
          <div style={{ fontSize: 15, color: C.muted }}>
            Rules <span style={{ color: C.faint }}>›</span>{' '}
            <span style={{ color: C.fg, fontWeight: 600 }}>Triage new tickets</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Pill color={C.brand} style={{ opacity: ran }}>
              Ran just now
            </Pill>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                color: C.muted,
              }}
            >
              On
              <div
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 20,
                  background: C.brand,
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    right: 2,
                    top: 2,
                    width: 16,
                    height: 16,
                    borderRadius: 16,
                    background: C.ink,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        {/* Dot grid, the builder's canvas. */}
        <div
          style={{
            position: 'absolute',
            inset: '56px 0 0 0',
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />
      </Panel>

      <svg width={1280} height={800} style={{ position: 'absolute', inset: 0, opacity: intro }}>
        {(Object.keys(EDGES) as (keyof typeof EDGES)[]).map((name) => {
          const run = RUN.find(([edge]) => edge === name);
          const draw = run ? interpolate(frame, [run[1], run[2]], [0, 1], L) : 0;
          return (
            <g key={name}>
              <path
                d={curvePath(EDGES[name])}
                stroke={C.line2}
                strokeWidth={2}
                fill="none"
                strokeDasharray="5 6"
              />
              {run && (
                <path
                  d={curvePath(EDGES[name])}
                  stroke={C.brand}
                  strokeWidth={2.5}
                  fill="none"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - draw}
                />
              )}
            </g>
          );
        })}
      </svg>

      <div
        style={{
          position: 'absolute',
          left: 488,
          top: 384,
          fontFamily: MONO,
          fontSize: 12,
          letterSpacing: 1.5,
          color: answered > 0.5 ? C.brand : C.faint,
        }}
      >
        YES
      </div>
      <div
        style={{
          position: 'absolute',
          left: 762,
          top: 384,
          fontFamily: MONO,
          fontSize: 12,
          letterSpacing: 1.5,
          color: C.faint,
        }}
      >
        NO
      </div>

      {/* The ticket that sets it all off. */}
      <div
        style={{
          position: 'absolute',
          left: 70,
          top: 130,
          width: 330,
          height: 132,
          borderRadius: 16,
          background: C.panel,
          border: `1px solid ${C.line2}`,
          boxShadow: '0 30px 80px -30px rgba(0,0,0,0.9)',
          padding: 18,
          opacity: at(12, 14),
          translate: `${(1 - at(12, 14)) * -30}px 0`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <KeyTag>CORE-1057</KeyTag>
          <Pill color={C.sky} style={{ height: 20, fontSize: 11 }}>
            New ticket
          </Pill>
        </div>
        <div style={{ marginTop: 8, fontSize: 17, fontWeight: 500, lineHeight: 1.3 }}>
          Payroll export fails for every user
        </div>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, height: 28 }}>
          <Pill color={C.rose} style={{ opacity: at(106), scale: 0.8 + 0.2 * at(106) }}>
            <Flag size={12} /> High
          </Pill>
          <div
            style={{
              opacity: at(124),
              scale: 0.8 + 0.2 * at(124),
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Avatar initials="SO" color={C.violet} size={26} />
            <span style={{ fontSize: 13, color: C.muted }}>Sam Okafor</span>
          </div>
        </div>
      </div>

      <Node
        x={490}
        y={130}
        w={300}
        h={84}
        icon={<Zap size={18} />}
        kicker="WHEN"
        title="A ticket is reported"
        lit={at(38, 6)}
      />
      <Node
        x={490}
        y={270}
        w={300}
        h={100}
        icon={<Sparkles size={18} />}
        kicker="CHECK WITH AI"
        title="Is this urgent?"
        lit={at(52, 6)}
      >
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            height: 18,
            color: answered > 0.5 ? C.brand : C.faint,
          }}
        >
          {answered > 0.5
            ? 'Yes — it affects every user'
            : thinking
              ? `Reading the ticket${dots}`
              : ' '}
        </div>
      </Node>

      <Node
        x={230}
        y={440}
        icon={<Flag size={18} />}
        kicker="SET PRIORITY"
        title="High"
        lit={at(100, 6)}
        done={at(104, 6)}
      />
      <Node
        x={230}
        y={535}
        icon={<UserRound size={18} />}
        kicker="ASSIGN TO"
        title="Sam Okafor · on call"
        lit={at(118, 6)}
        done={at(122, 6)}
      />
      <Node
        x={230}
        y={630}
        icon={<Hash size={18} />}
        kicker="POST TO SLACK"
        title="#it-urgent"
        lit={at(136, 6)}
        done={at(140, 6)}
      />

      <Node
        x={720}
        y={440}
        icon={<ArrowDownToLine size={18} />}
        kicker="MOVE TO SECTION"
        title="Backlog"
        lit={0}
        dim={skipped}
      />
      <Node
        x={720}
        y={535}
        icon={<MessageSquareReply size={18} />}
        kicker="REPLY"
        title="Thanks — we’ll take a look"
        lit={0}
        dim={skipped}
      />
      <div
        style={{
          position: 'absolute',
          left: 720,
          top: 622,
          fontFamily: MONO,
          fontSize: 12,
          letterSpacing: 1.5,
          color: C.faint,
          opacity: skipped,
        }}
      >
        SKIPPED · NOT URGENT PATH
      </div>

      {/* What the team sees in Slack. */}
      <div
        style={{
          position: 'absolute',
          left: 850,
          top: 130,
          width: 350,
          borderRadius: 16,
          background: C.panel,
          border: `1px solid ${C.line2}`,
          boxShadow: '0 30px 80px -30px rgba(0,0,0,0.9)',
          padding: 16,
          opacity: at(142, 12),
          translate: `0 ${(1 - at(142, 12)) * 18}px`,
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.faint }}
        >
          <Hash size={14} /> it-urgent
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: C.panel3,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <MarkGlyph id="slack" size={17} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>CoreTask</div>
            <div style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>
              CORE-1057 needs attention: Payroll export fails for every user. Assigned to Sam.
            </div>
          </div>
        </div>
      </div>

      {tokenAt && (
        <div
          style={{
            position: 'absolute',
            left: tokenAt[0],
            top: tokenAt[1],
            width: 14,
            height: 14,
            borderRadius: 14,
            translate: '-50% -50%',
            background: C.brand,
            boxShadow: '0 0 18px 6px rgba(133,200,84,0.55)',
          }}
        />
      )}
    </Stage>
  );
}
