'use client';

import { Player, type PlayerRef } from '@remotion/player';
import type { MotionValue } from 'framer-motion';
import { useEffect, useRef } from 'react';

import type { ClipId } from './clip-ids';
import { CLIPS } from './clips';

/**
 * A Remotion clip whose playhead is the scroll position: `progress` 0 → 1
 * maps to the first → last frame, so scrolling scrubs the clip back and forth.
 * Loaded only when its section is near, so @remotion/player never weighs on
 * the first paint.
 *
 * Remotion needs a paid Company License for organisations of more than three
 * people (remotion.dev/license); `acknowledgeRemotionLicense` records that
 * this site is used under one.
 */
export default function ClipPlayer({
  id,
  progress,
  onReady,
}: {
  id: ClipId;
  progress: MotionValue<number>;
  onReady: () => void;
}) {
  const player = useRef<PlayerRef>(null);
  const clip = CLIPS[id];

  useEffect(() => {
    const last = clip.durationInFrames - 1;
    const seek = (value: number) =>
      player.current?.seekTo(Math.round(Math.min(1, Math.max(0, value)) * last));
    seek(progress.get());
    onReady();
    return progress.on('change', seek);
  }, [clip, progress, onReady]);

  return (
    <Player
      ref={player}
      component={clip.component}
      durationInFrames={clip.durationInFrames}
      fps={clip.fps}
      compositionWidth={clip.width}
      compositionHeight={clip.height}
      style={{ width: '100%', height: '100%' }}
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      spaceKeyToPlayOrPause={false}
      initiallyMuted
      acknowledgeRemotionLicense
    />
  );
}
