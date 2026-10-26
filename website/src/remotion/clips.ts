import type { ComponentType } from 'react';

import type { ClipId } from './clip-ids';
import { ProgressRollup } from './progress-rollup';
import { RequestToTicket } from './request-to-ticket';
import { RuleRun } from './rule-run';
import { CLIP } from './theme';

/*
 * The product clips, shared by the page (scrubbed live in @remotion/player)
 * and the renderer (which turns each one's last frame into its poster).
 */

export type ClipDefinition = {
  component: ComponentType;
  durationInFrames: number;
  width: number;
  height: number;
  fps: number;
};

export const CLIPS: Record<ClipId, ClipDefinition> = {
  'request-to-ticket': { component: RequestToTicket, durationInFrames: 180, ...CLIP },
  'rule-run': { component: RuleRun, durationInFrames: 210, ...CLIP },
  'progress-rollup': { component: ProgressRollup, durationInFrames: 180, ...CLIP },
};
