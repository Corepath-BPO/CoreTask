import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, type InterpolateOptions } from 'remotion';

import { CHECK_GREEN, LOGO_GREEN, MARK } from '../components/brand';

/*
 * Shared look for the product clips. Compositions are rendered two ways — live
 * in the page by @remotion/player, and to still images by the Remotion
 * renderer — so they import nothing from Next and style themselves inline.
 * Relative imports only: the renderer bundles without the site's `@/` alias.
 */

export const C = {
  ink: '#08080b',
  panel: '#121217',
  panel2: '#18181e',
  panel3: '#1f1f26',
  line: 'rgba(255,255,255,0.08)',
  line2: 'rgba(255,255,255,0.14)',
  fg: '#f4f4f6',
  muted: '#a1a1ab',
  faint: '#84848f',
  brand: '#85c854',
  brandSoft: 'rgba(133,200,84,0.14)',
  amber: '#f2b33d',
  rose: '#fb7185',
  sky: '#38bdf8',
  violet: '#a78bfa',
} as const;

// The page defines --font-geist through next/font; the renderer loads Geist by
// name (see index.ts), so both resolve to the same face.
export const FONT = "var(--font-geist, 'Geist'), ui-sans-serif, system-ui, sans-serif";
export const MONO = "var(--font-geist-mono, 'Geist Mono'), ui-monospace, monospace";

export const CLIP = { width: 1280, height: 800, fps: 30 } as const;

export const EASE = Easing.bezier(0.16, 1, 0.3, 1);

/** Clamped at both ends with the house ease: every keyframe in the clips. */
export const K: InterpolateOptions = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: EASE,
};

/** Clamped, linear — for lines drawing and counters. */
export const L: InterpolateOptions = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
};

export function Stage({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 700px at 70% 0%, rgba(133,200,84,0.07), transparent 60%), ${C.ink}`,
        fontFamily: FONT,
        color: C.fg,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        background: C.panel,
        border: `1px solid ${C.line2}`,
        borderRadius: 18,
        boxShadow: '0 40px 100px -40px rgba(0,0,0,0.9)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Avatar({
  initials,
  color,
  size = 30,
}: {
  initials: string;
  color: string;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size,
        background: `${color}26`,
        color,
        border: `1px solid ${color}55`,
        display: 'grid',
        placeItems: 'center',
        fontSize: size * 0.38,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

export function Pill({
  children,
  color,
  style,
}: {
  children: ReactNode;
  color: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 24,
        padding: '0 10px',
        borderRadius: 999,
        background: `${color}1f`,
        color,
        fontSize: 13,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function KeyTag({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint, letterSpacing: 0.2, ...style }}>
      {children}
    </span>
  );
}

/**
 * The CoreTask mark, `size` pixels tall. The check circle grows into the C as
 * `done` goes 0 → 1: the request is finished. `id` names the T's gradient and
 * must be unique within the frame.
 */
export function MarkGlyph({
  id,
  size,
  done = 1,
  color = C.fg,
}: {
  id: string;
  size: number;
  done?: number;
  color?: string;
}) {
  const scale = 0.35 + 0.65 * done;
  const [cx, cy] = MARK.circleCentre;
  const gradient = `glyph-blend-${id}`;
  return (
    <svg width={size * MARK.aspect} height={size} viewBox={MARK.viewBox}>
      <defs>
        <linearGradient
          id={gradient}
          gradientUnits="userSpaceOnUse"
          x1={MARK.blend.x1}
          x2={MARK.blend.x2}
          y1="0"
          y2="0"
        >
          <stop offset="0" stopColor={LOGO_GREEN} />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      <path fill={LOGO_GREEN} d={MARK.c} />
      <path fill={`url(#${gradient})`} d={MARK.t} />
      {/* Scaled about the circle's own centre. */}
      <g
        opacity={done}
        transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}
      >
        <path fill={CHECK_GREEN} d={MARK.circle} />
        <path fill="#FFFFFF" d={MARK.check} />
      </g>
    </svg>
  );
}

export type Point = [number, number];
export type Curve = [Point, Point, Point, Point];

export const curvePath = ([a, b, c, d]: Curve) =>
  `M ${a[0]} ${a[1]} C ${b[0]} ${b[1]}, ${c[0]} ${c[1]}, ${d[0]} ${d[1]}`;

/** A point on a cubic Bézier, for things that travel along a drawn path. */
export function curvePoint([p0, p1, p2, p3]: Curve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}
