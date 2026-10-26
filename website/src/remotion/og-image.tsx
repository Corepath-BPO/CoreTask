import { AbsoluteFill, Img, staticFile } from 'remotion';

import { C, FONT, MarkGlyph, MONO } from './theme';

/**
 * The share card (1200 × 630) that link previews show. A still, rendered to
 * public/og.png by `pnpm assets`.
 */
export function OgImage() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(700px 520px at 82% 50%, rgba(133,200,84,0.20), transparent 65%), ${C.ink}`,
        fontFamily: FONT,
        color: C.fg,
        overflow: 'hidden',
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
          maskImage: 'radial-gradient(ellipse at 70% 50%, black 10%, transparent 70%)',
        }}
      />

      <Img
        src={staticFile('brand/coretask-logo-dark.svg')}
        style={{ position: 'absolute', left: 80, top: 64, height: 64 }}
      />

      <div style={{ position: 'absolute', left: 80, top: 196, width: 660 }}>
        <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 3, color: C.brand }}>
          PROJECT MANAGEMENT &amp; TICKETING
        </div>
        <div
          style={{
            marginTop: 22,
            fontSize: 70,
            fontWeight: 600,
            lineHeight: 1.0,
            letterSpacing: -2.6,
          }}
        >
          Where every request becomes <span style={{ color: C.brand }}>finished</span> work.
        </div>
      </div>

      <div style={{ position: 'absolute', left: 80, bottom: 64, fontSize: 22, color: C.muted }}>
        Capture · Plan · Automate · Track
      </div>

      <div
        style={{
          position: 'absolute',
          right: 120,
          top: 125,
          width: 230,
          height: 380,
          perspective: 900,
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            transform: 'rotateY(-24deg) rotateX(14deg)',
            filter:
              'drop-shadow(0 40px 60px rgba(0,0,0,0.8)) drop-shadow(0 0 50px rgba(0,240,6,0.3))',
          }}
        >
          <MarkGlyph size={380} done={1} />
        </div>
      </div>
    </AbsoluteFill>
  );
}
